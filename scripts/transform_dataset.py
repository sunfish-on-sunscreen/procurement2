"""Deterministic supplier-scorecard transformer (two-file, schema-clean).

This script is the sole source of truth for all derived supplier scores. It
reads the RAW workbook (``procurement_data_raw.xlsx``) — operational
measurements only, with **no** derived score columns — computes the full
scorecard, and writes the ENRICHED workbook (``procurement_data.xlsx``) that the
import route reads. The two files are committed separately:

    procurement_data_raw.xlsx   (input)  — raw operational inputs, source of truth
    procurement_data.xlsx       (output) — raw inputs + computed scores, imported

PER-PERIOD scores (P2): the enriched SupplierMetrics sheet now carries ONE row
per active supplier-period (a `period` column = invoice-year), not one row per
supplier. The purchase-derived inputs (spend, #POs, avg PO value, lead/cycle
time, OTD %, 3-way-match %) are RE-AGGREGATED per period from the actual
per-period Purchase rows; the soft survey inputs (defect rate, complaints, RFx
rate, response time, single-source) and identity are held CONSTANT across
periods at the supplier's snapshot value (there is no per-period source for
them). The five sub-scores + composite are then computed per period from those
inputs, so delivery + process (45% of the composite) vary by year while the
rest stays flat. This is fully deterministic (no rng) and fabricates nothing.
A supplier-period with zero purchase activity gets NO row.

Period grouping uses ``(payment_date or pr_date).year`` — the same key the
import route tags purchases with (COALESCE(paymentDate, prDate)) — so the
transformer's per-period groups line up exactly with the DB periods.

Pipeline (fully deterministic — no rng):
  1. Expand metrics to one row per active supplier-period with per-period
     purchase-derived inputs + constant soft inputs.
  2. Five sub-scores (quality/delivery/service/process) from inputs with
     FIXED industry bounds.
  3. risk_score: deterministic 100 - weighted(country, complaints, single-source),
     higher = safer.
  4. composite_score (weights 0.25/0.25/0.15/0.20/0.15).
  5. Drop the obsolete Purchases.automation_period column if present.

Strict input validation (Decision C): the raw workbook must NOT contain any of
the derived score columns. If found, the run aborts with a clear message.

The old-vs-new diff (scripts/score_rebuild_diff.json) compares the new output
against the PREVIOUS enriched workbook if one exists AND it already carries the
per-period `period` column; otherwise (first per-period run) the diff is skipped.

Usage:  python scripts/transform_dataset.py
"""

import json
import os
import sys
import numpy as np
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
RAW_XLSX = os.path.join(HERE, "..", "data", "raw", "procurement_data_raw.xlsx")  # input
XLSX = os.path.join(HERE, "..", "data", "raw", "procurement_data.xlsx")  # output (imported)


# The derived columns this transformer COMPUTES — they must NOT appear in the
# raw input workbook (Decision C). Kept in sync with SCORE_COLS below.
DERIVED_COLS = [
    "quality_score", "delivery_score", "service_score", "process_score",
    "risk_score", "composite_score",
]

# Composite weights (Batch 3a spec).
WEIGHTS = {
    "quality_score": 0.25,
    "delivery_score": 0.25,
    "service_score": 0.15,
    "process_score": 0.20,
    "risk_score": 0.15,
}
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


SCORE_COLS = [
    "quality_score", "delivery_score", "service_score",
    "process_score", "risk_score", "composite_score",
]

# Identity + soft survey inputs carried CONSTANT across a supplier's periods
# (no per-period source); the purchase-derived inputs are recomputed per period.
IDENTITY_COLS = [
    "supplier_id", "supplier_name", "country", "category",
    "product_description",
]
SOFT_COLS = [
    "defect_rate_pct", "complaint_count_annual", "rfx_response_rate_pct",
    "avg_response_time_days", "single_source_risk",
]
# Output column order for the enriched SupplierMetrics sheet.
OUT_COLS = (
    IDENTITY_COLS
    + ["period"]
    + [
        "total_spend_usd", "num_pos", "avg_po_value_usd", "avg_lead_time_days",
        "avg_cycle_time_days", "on_time_delivery_pct", "three_way_match_pct",
    ]
    + SOFT_COLS
    + SCORE_COLS
)


def build_period_metrics(metrics, purchases):
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
        npos = int(len(g))
        spend = float(g["total_value_usd"].sum())
        row = {"supplier_id": sid}
        for c in IDENTITY_COLS:
            if c != "supplier_id":
                row[c] = snap[c]
        row["period"] = int(year)
        row["total_spend_usd"] = round(spend, 2)
        row["num_pos"] = npos
        row["avg_po_value_usd"] = round(spend / npos, 2) if npos else 0.0
        row["avg_lead_time_days"] = round(float(g["po_to_delivery_days"].mean()), 2)
        row["avg_cycle_time_days"] = round(float(g["total_cycle_days"].mean()), 2)
        row["on_time_delivery_pct"] = round(float(g["on_time_delivery"].mean()) * 100, 2)
        row["three_way_match_pct"] = round(float(g["three_way_match_pass"].mean()) * 100, 2)
        for c in SOFT_COLS:
            row[c] = snap[c]
        rows.append(row)

    out = pd.DataFrame(rows)
    # Preserve original dtypes for the integer-ish columns.
    out["complaint_count_annual"] = out["complaint_count_annual"].astype(int)
    out["single_source_risk"] = out["single_source_risk"].astype(int)
    return out


def compute_scores(m, roster_cat_counts):
    """Add the six derived score columns IN PLACE-ish (returns m). Fixed bounds;
    fully deterministic. Identical formulas to the snapshot rebuild — just now
    applied to per-period inputs. `roster_cat_counts` = category -> full-roster
    supplier count (all known suppliers, active or not), used for the D9-note
    roster-based concentration term in risk_score."""
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


def _buckets(deltas):
    b = {"<1": 0, "1-5": 0, "5-10": 0, "10-25": 0, ">25": 0}
    for d in deltas:
        a = abs(d)
        if a < 1:
            b["<1"] += 1
        elif a < 5:
            b["1-5"] += 1
        elif a < 10:
            b["5-10"] += 1
        elif a <= 25:
            b["10-25"] += 1
        else:
            b[">25"] += 1
    return b


def build_diff(old, new):
    """Per-(supplier, period) old-vs-new score diff for human review (Decision F).
    Both frames carry a `period` column; the key is supplier_id + period."""
    key = lambda df: df["supplier_id"].astype(str) + "@" + df["period"].astype(str)
    oi = old.assign(_k=key(old)).set_index("_k")
    ni = new.assign(_k=key(new)).set_index("_k")
    per = []
    for k in ni.index:
        if k not in oi.index:
            continue  # supplier-period new this run — no baseline to diff
        row = {
            "supplier_id": ni.loc[k, "supplier_id"],
            "period": int(ni.loc[k, "period"]),
            "supplier_name": ni.loc[k, "supplier_name"],
        }
        for c in SCORE_COLS:
            ov, nv = float(oi.loc[k, c]), float(ni.loc[k, c])
            row[c] = {"old": ov, "new": nv, "delta": round(nv - ov, 2)}
        per.append(row)
    if not per:
        return None
    summary, top5 = {}, {}
    for c in SCORE_COLS:
        deltas = [r[c]["delta"] for r in per]
        summary[c] = {
            "changed": sum(1 for d in deltas if abs(d) >= 0.01),
            "mean_abs": round(sum(abs(d) for d in deltas) / len(deltas), 2),
            "max_abs": round(max(abs(d) for d in deltas), 2),
            "buckets": _buckets(deltas),
        }
        top5[c] = sorted(
            [{"supplier_name": r["supplier_name"], "old": r[c]["old"], "new": r[c]["new"], "delta": r[c]["delta"]} for r in per],
            key=lambda x: abs(x["delta"]), reverse=True,
        )[:5]
    return {"summary": summary, "top5": top5, "per_supplier": per}


def print_diff_summary(diff):
    print("\n==================== SCORE REBUILD DIFF ====================")
    for c, s in diff["summary"].items():
        print(f"  {c:16} changed={s['changed']:2}/{len(diff['per_supplier'])}  mean|d|={s['mean_abs']:6}  max|d|={s['max_abs']:6}  {s['buckets']}")
    for c in SCORE_COLS:
        print(f"\n  Top 5 shifts - {c}:")
        for t in diff["top5"][c]:
            print(f"    {t['supplier_name'][:30]:30} {t['old']:6} -> {t['new']:6}  (d {t['delta']:+.2f})")
    print("============================================================")


def summarize(label, series):
    print(
        f"  {label}: min={series.min():.1f} max={series.max():.1f} "
        f"mean={series.mean():.1f} std={series.std():.1f}"
    )


def main():
    # FULLY DETERMINISTIC (no rng). Read the RAW input workbook (operational
    # inputs only); all derived scores are computed here and written to the
    # ENRICHED output workbook.
    sheets = pd.read_excel(RAW_XLSX, sheet_name=None)  # ordered dict of all sheets
    suppliers = sheets["Suppliers"]
    metrics = sheets["SupplierMetrics"]
    purchases = sheets["Purchases"]

    # Strict input validation (Decision C): the raw workbook must carry only raw
    # inputs — reject any derived score columns rather than silently overwriting.
    present = [c for c in DERIVED_COLS if c in metrics.columns]
    if present:
        raise SystemExit(
            "xlsx contains derived score columns that should not be present. "
            "These are computed by the transformer. Remove columns: "
            + ", ".join(present)
        )

    print(
        f"Loaded {len(suppliers)} suppliers, {len(metrics)} metric rows "
        f"from {os.path.basename(RAW_XLSX)} (raw inputs only)."
    )

    # Diff baseline = the PREVIOUS enriched output, read BEFORE we overwrite it.
    # Requires the per-period `period` column; the first per-period run (whose
    # baseline is the old one-row-per-supplier output) has no comparable key,
    # so the diff is skipped.
    need = ["supplier_id", "period", "supplier_name", *SCORE_COLS]
    old_scores = None
    if os.path.exists(XLSX):
        try:
            prev = pd.read_excel(XLSX, sheet_name="SupplierMetrics")
            if all(c in prev.columns for c in need):
                old_scores = prev[need].copy()
        except Exception:
            old_scores = None

    # --- 1. Expand to one row per active supplier-period ------------------- #
    # Purchase-derived inputs aggregated per period; soft + identity constant.
    metrics = build_period_metrics(metrics, purchases)
    print(
        f"  expanded to {len(metrics)} supplier-period rows "
        f"({metrics['supplier_id'].nunique()} suppliers x "
        f"{sorted(metrics['period'].unique().tolist())})"
    )

    # --- 2-4. Sub-scores + risk + composite, FIXED bounds (Decision B/C) --- #
    # Bounds rationale (see methodology doc):
    #   defect_rate 0-10% (Toyota near-zero; >1% investigate; 10% unacceptable)
    #   complaint_count 0-10 (>10/yr = severe relationship issue)
    #   lead_time 0-60 days (60-day lead = poor); response_time 0-14 days (2-wk SLA)
    #   OTD / rfx_rate / 3-way-match are percentages (0-100) by definition.
    # risk_score: deterministic 100 - weighted(country, complaints, single-source),
    # higher = safer; single_source_risk read as an existing 0/1 field.
    # D9-note: full-roster category sizes from the Suppliers master sheet (all
    # known suppliers, active or not) — the SAME roster basis A1 uses in
    # compute_analyses.py, so the composite's concentration signal and Kraljic's
    # supply_concentration agree.
    roster_cat_counts = (
        suppliers.groupby("category")["supplier_id"].nunique().to_dict()
    )
    roster_cat_counts = {str(k): int(v) for k, v in roster_cat_counts.items()}
    print(
        f"  roster category sizes: {len(roster_cat_counts)} categories, "
        f"{sum(roster_cat_counts.values())} suppliers (full roster)"
    )
    metrics = compute_scores(metrics, roster_cat_counts)
    metrics = metrics[OUT_COLS].copy()

    # --- 5. (Batch 5) Drop Purchases.automation_period -------------------- #
    if "automation_period" in purchases.columns:
        purchases = purchases.drop(columns=["automation_period"])
        print("  dropped Purchases.automation_period")
    else:
        print("  Purchases.automation_period already absent (no-op)")

    print("AFTER:")
    summarize("risk_score", metrics["risk_score"])
    print(
        "  single_source_risk flagged:",
        int(metrics["single_source_risk"].sum()),
        f"({metrics['single_source_risk'].mean() * 100:.0f}%)",
    )
    summarize("composite_score", metrics["composite_score"])

    # --- Rebuild diff + review gate (Decision F) -------------------------- #
    diff = build_diff(old_scores, metrics) if old_scores is not None else None
    if diff is not None:
        print_diff_summary(diff)
        diff_path = os.path.join(HERE, "score_rebuild_diff.json")
        with open(diff_path, "w") as f:
            json.dump(diff, f, indent=2)
        print(f"\nFull diff saved to {diff_path} (new output vs previous enriched output)")
    else:
        print("\nNo comparable previous output to diff against — fresh computation.")
    # Confirmation gate: interactive prompt for humans; auto-proceed when piped.
    if sys.stdin.isatty():
        if input("\nContinue with overwrite? [y/N] ").strip().lower() != "y":
            print("Aborted — no values written.")
            return
    else:
        print("\n[non-interactive] Would prompt 'Continue with overwrite? [y/N]' - proceeding.")

    # --- Write back (preserve sheet order) -------------------------------- #
    sheets["Suppliers"] = suppliers
    sheets["SupplierMetrics"] = metrics
    sheets["Purchases"] = purchases
    with pd.ExcelWriter(XLSX, engine="openpyxl") as writer:
        for name, df in sheets.items():
            df.to_excel(writer, sheet_name=name, index=False)
    print(f"Wrote {XLSX}")


if __name__ == "__main__":
    main()
