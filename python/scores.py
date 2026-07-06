"""Shared, pure supplier-score computation (Stage 1 of the backend-scoring rebuild).

This module is the SINGLE SOURCE OF TRUTH for the derived supplier scores. The
formulas were extracted VERBATIM from ``scripts/transform_dataset.py`` (which now
imports them from here) so the offline transformer and the future server-side
import path compute identical values.

Everything here is PURE and deterministic — functions take DataFrames / dicts in
and return computed values out. No file I/O, no DB, no ``rng``. Fixed industry
bounds (not population min/max) so scores are stable when data changes.

Derived fields (per active supplier-period):
  quality  = mean(norm_low(defect_rate,0,10), norm_low(complaints,0,10))
  delivery = mean(norm_high(otd_pct,0,100), norm_low(avg_lead_time,0,60))
  service  = mean(norm_low(avg_response_time,0,14), norm_high(rfx_rate,0,100))
  process  = norm_high(three_way_match_pct,0,100)
  risk     = 100 - (0.4*country_distance + 0.3*min(complaints*10,100)
                    + 0.3*concentration_0_100(roster_alternatives))   [D9]
  composite = 0.25*quality + 0.25*delivery + 0.15*service + 0.20*process + 0.15*risk
All rounded to 2 decimals.
"""

import numpy as np
import pandas as pd

# Composite weights (Batch 3a spec).
WEIGHTS = {
    "quality_score": 0.25,
    "delivery_score": 0.25,
    "service_score": 0.15,
    "process_score": 0.20,
    "risk_score": 0.15,
}

SCORE_COLS = [
    "quality_score", "delivery_score", "service_score",
    "process_score", "risk_score", "composite_score",
]

# Identity + soft survey inputs carried CONSTANT across a supplier's periods
# (no per-period source); the purchase-derived inputs are recomputed per period.
IDENTITY_COLS = [
    "supplier_id", "supplier_name", "country", "category",
]
SOFT_COLS = [
    "defect_rate_pct", "complaint_count_annual", "rfx_response_rate_pct",
    "avg_response_time_days", "single_source_risk",
]


# --- Score helpers (methodology rebuild) ---------------------------------- #
# Geographic supply risk, coarse tiers 0 (safest) … 100 (riskiest) (Decision C).
def country_distance_score(code: str) -> float:
    c = str(code).strip().upper()
    if c in ("ID", "INDONESIA"):
        return 0.0
    if c in ("SG", "MY", "TH", "VN", "PH"):  # ASEAN regional
        return 30.0
    if c in ("CN", "JP", "KR", "AU", "IN"):  # Asia-Pacific
        return 60.0
    return 100.0  # other international


# Roster-based supply concentration (D9-note). This MIRRORS the Kraljic
# supply-risk `_CONC` step curve in python/compute_analyses.py
# (compute_supply_risk): points on the # of OTHER suppliers in the same category
# across the FULL roster (all known suppliers, active or not). There it maxes at
# 50 (single source); here the composite's risk_score concentration term lives on
# a 0-100 axis (it replaces the old single_source_risk*100 term), so we scale the
# same curve x2. Endpoints reconcile with the old flag: 0 alternatives (true
# single source) -> 100 (== old single_source_risk=1), >=5 alternatives -> 0
# (== old single_source_risk=0); the middle is now graded instead of binary, and
# it uses the SAME roster signal Kraljic uses so composite and Kraljic agree.
_CONC_POINTS = {0: 50.0, 1: 35.0, 2: 22.0, 3: 12.0, 4: 5.0}


def concentration_0_100(other_in_category: int) -> float:
    """Roster-based supply concentration on the composite's 0-100 axis."""
    return _CONC_POINTS.get(int(other_in_category), 0.0) * 2.0


# Fixed-bound min-max normalization, clamped to [0,100] so inputs outside the
# documented bounds can't produce negative or >100 scores (Decision B/D).
def norm_high(value: float, lo: float, hi: float) -> float:
    """Higher input → higher score."""
    return float(np.clip((float(value) - lo) / (hi - lo), 0.0, 1.0) * 100.0)


def norm_low(value: float, lo: float, hi: float) -> float:
    """Lower input → higher score."""
    return float(np.clip((hi - float(value)) / (hi - lo), 0.0, 1.0) * 100.0)


def roster_category_counts(suppliers: pd.DataFrame) -> dict:
    """Full-roster supplier count per category (all known suppliers, active or
    not) from the Suppliers master sheet — the roster basis A1 (Kraljic) and the
    D9 composite concentration term share. `suppliers` must carry `category` +
    `supplier_id`."""
    counts = suppliers.groupby("category")["supplier_id"].nunique().to_dict()
    return {str(k): int(v) for k, v in counts.items()}


def _aggregate_purchase_group(g: pd.DataFrame) -> dict:
    """Purchase-derived operational aggregates over ONE group of POs (snake_case
    columns). The SINGLE definition of these formulas, shared by
    build_period_metrics (grouped by supplier-period) and build_window_metrics
    (grouped by supplier over an arbitrary filtered window) — so the window
    aggregation can never drift from the per-period one. Returned in the stable
    column order both builders rely on."""
    npos = int(len(g))
    spend = float(g["total_value_usd"].sum())
    return {
        "total_spend_usd": round(spend, 2),
        "num_pos": npos,
        "avg_po_value_usd": round(spend / npos, 2) if npos else 0.0,
        "avg_lead_time_days": round(float(g["po_to_delivery_days"].mean()), 2),
        "avg_cycle_time_days": round(float(g["total_cycle_days"].mean()), 2),
        "on_time_delivery_pct": round(float(g["on_time_delivery"].mean()) * 100, 2),
        "three_way_match_pct": round(float(g["three_way_match_pass"].mean()) * 100, 2),
    }


def build_period_metrics(metrics: pd.DataFrame, purchases: pd.DataFrame) -> pd.DataFrame:
    """Expand the per-supplier snapshot into one row per active supplier-period.

    Purchase-derived inputs are re-aggregated per period (payment-year, with a
    pr_date fallback — mirrors the import route's period tag); soft + identity
    inputs are carried constant from the supplier's snapshot row. Aggregation
    formulas reproduce the snapshot definitions exactly, so summing across all
    of a supplier's periods reconciles with the original snapshot."""
    soft_by_sid = metrics.set_index("supplier_id")

    pu = purchases.copy()
    pay = pd.to_datetime(pu["payment_date"], errors="coerce")
    pr = pd.to_datetime(pu["pr_date"], errors="coerce")
    pu["period"] = pay.fillna(pr).dt.year.astype("Int64")

    rows = []
    for (sid, year), g in pu.groupby(["supplier_id", "period"], sort=True):
        if pd.isna(sid) or pd.isna(year) or sid not in soft_by_sid.index:
            continue  # purchase with no matching supplier metric — skip
        snap = soft_by_sid.loc[sid]  # supplier_id is now the index, not a column
        row = {"supplier_id": sid}
        for c in IDENTITY_COLS:
            if c != "supplier_id":
                row[c] = snap[c]
        row["period"] = int(year)
        row.update(_aggregate_purchase_group(g))  # shared aggregation formulas
        for c in SOFT_COLS:
            row[c] = snap[c]
        rows.append(row)

    out = pd.DataFrame(rows)
    # Preserve original dtypes for the integer-ish columns.
    out["complaint_count_annual"] = out["complaint_count_annual"].astype(int)
    out["single_source_risk"] = out["single_source_risk"].astype(int)
    return out


def compute_scores(m: pd.DataFrame, roster_cat_counts: dict) -> pd.DataFrame:
    """Add the six derived score columns IN PLACE-ish (returns m). Fixed bounds;
    fully deterministic. `roster_cat_counts` = category -> full-roster supplier
    count (all known suppliers, active or not), used for the D9-note roster-based
    concentration term in risk_score."""
    m["quality_score"] = np.round([
        (norm_low(r["defect_rate_pct"], 0, 10) + norm_low(r["complaint_count_annual"], 0, 10)) / 2
        for _, r in m.iterrows()
    ], 2)
    m["delivery_score"] = np.round([
        (norm_high(r["on_time_delivery_pct"], 0, 100) + norm_low(r["avg_lead_time_days"], 0, 60)) / 2
        for _, r in m.iterrows()
    ], 2)
    m["service_score"] = np.round([
        (norm_low(r["avg_response_time_days"], 0, 14) + norm_high(r["rfx_response_rate_pct"], 0, 100)) / 2
        for _, r in m.iterrows()
    ], 2)
    m["process_score"] = np.round([
        norm_high(r["three_way_match_pct"], 0, 100) for _, r in m.iterrows()
    ], 2)
    new_risk = []
    for _, r in m.iterrows():
        country = country_distance_score(r.get("country", ""))
        complaint = min(float(r["complaint_count_annual"]) * 10.0, 100.0)
        # D9-note: roster-based concentration (same signal Kraljic uses) instead
        # of the discredited single_source_risk flag. Count OTHER suppliers in the
        # same category across the FULL roster; single-source (0 others) -> 100.
        cat = str(r.get("category", ""))
        other_in_category = max(0, int(roster_cat_counts.get(cat, 1)) - 1)
        concentration = concentration_0_100(other_in_category)
        risk = 100.0 - (0.4 * country + 0.3 * complaint + 0.3 * concentration)
        new_risk.append(float(np.clip(risk, 0, 100)))
    m["risk_score"] = np.round(new_risk, 2)
    m["composite_score"] = np.round(
        sum(m[col] * w for col, w in WEIGHTS.items()), 2
    )
    return m


# camelCase (DB "Purchase") -> snake_case (engine) column names. compute_analyses
# loads Purchase via SELECT * (camelCase); a Stage-2 caller normalizes the frame
# with rename_purchase_columns() before calling build_window_metrics, so the
# engine stays snake_case-only (one boundary, not renames scattered everywhere).
_PURCHASE_CAMEL_TO_SNAKE = {
    "supplierExternalId": "supplier_id",
    "totalValueUsd": "total_value_usd",
    "poToDeliveryDays": "po_to_delivery_days",
    "totalCycleDays": "total_cycle_days",
    "onTimeDelivery": "on_time_delivery",
    "threeWayMatchPass": "three_way_match_pass",
    "paymentDate": "payment_date",
    "prDate": "pr_date",
}


def rename_purchase_columns(purchases: pd.DataFrame) -> pd.DataFrame:
    """Normalize a DB (camelCase) Purchase frame to the snake_case columns the
    score engine reads. `rename` ignores absent keys, so this is a safe no-op on
    an already-snake_case frame (e.g. the raw-xlsx path). The single camel/snake
    boundary adapter — keeps build_window_metrics / build_period_metrics
    snake_case-only."""
    return purchases.rename(columns=_PURCHASE_CAMEL_TO_SNAKE)


def build_window_metrics(
    metrics: pd.DataFrame, purchases: pd.DataFrame, roster_cat_counts: dict
) -> pd.DataFrame:
    """Per-supplier SCORED metrics aggregated over the ENTIRE passed-in purchase
    set — i.e. build_period_metrics with the period dimension collapsed to
    whatever window the caller has already filtered `purchases` to (a single
    year, a range, any filter). The purchase-derived inputs (delivery / process /
    spend) re-aggregate over those POs via the SHARED _aggregate_purchase_group;
    soft + identity inputs are carried constant from `metrics`; then
    compute_scores produces the 6 scores.

    There is no `period` column — the window IS the period. Because the
    aggregation and scoring reuse the exact same code build_period_metrics uses, a
    SINGLE-YEAR window reproduces that year's build_period_metrics row
    byte-for-byte (locked in test_scores). `metrics` / `purchases` are snake_case;
    DB (camelCase) callers pass purchases through rename_purchase_columns() first.
    """
    soft_by_sid = metrics.set_index("supplier_id")
    rows = []
    for sid, g in purchases.groupby("supplier_id", sort=True):
        if pd.isna(sid) or sid not in soft_by_sid.index:
            continue  # purchase with no matching supplier metric — skip
        snap = soft_by_sid.loc[sid]
        row = {"supplier_id": sid}
        for c in IDENTITY_COLS:
            if c != "supplier_id":
                row[c] = snap[c]
        row.update(_aggregate_purchase_group(g))  # shared aggregation formulas
        for c in SOFT_COLS:
            row[c] = snap[c]
        rows.append(row)

    out = pd.DataFrame(rows)
    # Preserve original dtypes for the integer-ish columns (mirror build_period_metrics).
    out["complaint_count_annual"] = out["complaint_count_annual"].astype(int)
    out["single_source_risk"] = out["single_source_risk"].astype(int)
    return compute_scores(out, roster_cat_counts)
