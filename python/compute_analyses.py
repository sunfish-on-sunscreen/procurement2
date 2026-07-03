#!/usr/bin/env python3
"""Compute the 4 fixed procurement analyses over a DATE RANGE.

Two modes:
  Mode A (cache):   --period-id <id>
      Looks up the period's start/end dates, computes, and UPSERTs each analysis
      into AnalysisResult (one row per analysisType per period).
  Mode B (on-the-fly):  --start-date YYYY-MM-DD --end-date YYYY-MM-DD
      Computes over the date span and prints a single JSON object
      {spend_overview, abc, cycle_time, performance_spend, kraljic,
      recommendations} to STDOUT. No DB writes.

Data is filtered by Purchase payment date — COALESCE(paymentDate, prDate) — so a
period's compute covers exactly the rows tagged to it at import. Suppliers and
metrics are derived from the suppliers that appear in the filtered purchases.
Progress logs go to STDERR so Mode B's stdout stays pure JSON.

Methodology is FIXED (ABC 80/95, Mann-Whitney U, Kraljic median split) per scope.
"""

import os
import sys
import json
import uuid
import argparse
import warnings
import traceback

warnings.filterwarnings("ignore")

import numpy as np
import pandas as pd
from dotenv import load_dotenv
import psycopg2

from scipy.stats import mannwhitneyu


def log(msg):
    print(msg, file=sys.stderr, flush=True)


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def load_env():
    here = os.path.dirname(os.path.abspath(__file__))
    load_dotenv(os.path.join(here, "..", ".env"))


def get_dsn():
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set in the environment / .env")
    return url.split("?")[0]  # strip Prisma's ?schema=public for libpq


def num(value, ndigits=4):
    if value is None:
        return None
    try:
        if pd.isna(value):
            return None
    except (TypeError, ValueError):
        pass
    if isinstance(value, (np.integer, int)) and not isinstance(value, bool):
        return int(value)
    if isinstance(value, (np.floating, float)):
        f = float(value)
        if np.isnan(f) or np.isinf(f):
            return None
        return round(f, ndigits)
    if isinstance(value, (np.bool_, bool)):
        return bool(value)
    return value


def json_default(obj):
    if isinstance(obj, np.integer):
        return int(obj)
    if isinstance(obj, np.floating):
        return float(obj)
    if isinstance(obj, np.bool_):
        return bool(obj)
    if isinstance(obj, np.ndarray):
        return obj.tolist()
    raise TypeError(f"Type not serializable: {type(obj)}")


def _df(conn, query, params):
    with conn.cursor() as cur:
        cur.execute(query, params)
        columns = [d[0] for d in cur.description]
        rows = cur.fetchall()
    return pd.DataFrame(rows, columns=columns).infer_objects()


def load_frames(conn, start_ts, end_ts):
    """Load purchases in [start_ts, end_ts] plus the suppliers/metrics for the
    suppliers that appear in those purchases (deduped across periods)."""
    # Filter by PAYMENT date (when cash actually leaves), falling back to PR date
    # for any row without a payment. This mirrors the period TAG assigned at
    # import (paymentDate ?? prDate), so a period's compute covers exactly the
    # rows tagged to it.
    purchases = _df(
        conn,
        'SELECT * FROM "Purchase" '
        'WHERE COALESCE("paymentDate", "prDate") >= %s '
        'AND COALESCE("paymentDate", "prDate") <= %s',
        (start_ts, end_ts),
    )
    if len(purchases) == 0:
        suppliers = _df(conn, 'SELECT * FROM "Supplier" WHERE false', ())
        metrics = _df(conn, 'SELECT * FROM "SupplierMetric" WHERE false', ())
        return suppliers, purchases, metrics

    supplier_ids = tuple(sorted(set(purchases["supplierExternalId"].tolist())))
    suppliers = _df(
        conn,
        'SELECT DISTINCT ON ("externalId") * FROM "Supplier" '
        'WHERE "externalId" IN %s ORDER BY "externalId"',
        (supplier_ids,),
    )
    # Per-period (P2): SupplierMetric now holds one row per supplier-period.
    # Pick the row(s) whose period falls inside [start_ts, end_ts]. In Mode A the
    # window IS one period's bounds, so exactly that period's metrics load. In
    # Mode B (range) several periods qualify; DISTINCT ON keeps the LATEST one
    # per supplier (period scores trend, latest = current snapshot for the
    # range's spend/Kraljic analyses; the panel computes a true range composite
    # separately).
    metrics = _df(
        conn,
        'SELECT DISTINCT ON (m."supplierExternalId") m.* '
        'FROM "SupplierMetric" m '
        'JOIN "ReportingPeriod" rp ON rp.id = m."periodId" '
        'WHERE m."supplierExternalId" IN %s '
        'AND rp."startDate" >= %s AND rp."endDate" <= %s '
        'ORDER BY m."supplierExternalId", rp."startDate" DESC',
        (supplier_ids, start_ts, end_ts),
    )
    return suppliers, purchases, metrics


# --------------------------------------------------------------------------- #
# a) Spend overview
# --------------------------------------------------------------------------- #
def spend_overview(purchases, suppliers, metrics):
    total_spend = purchases["totalValueUsd"].sum()
    cat = purchases.groupby("category")["totalValueUsd"].sum().sort_values(ascending=False)
    by_category = [{"category": str(c), "total": num(t)} for c, t in cat.head(8).items()]
    if len(cat) > 8:
        by_category.append({"category": "Other", "total": num(cat.iloc[8:].sum())})

    sup = (
        purchases.groupby(["supplierExternalId", "supplierName"])["totalValueUsd"]
        .sum().sort_values(ascending=False).head(10)
    )
    top_suppliers = [
        {"supplier_id": str(s), "supplier_name": str(n), "total": num(t)}
        for (s, n), t in sup.items()
    ]

    # Per-category top suppliers (visibility-only drill-down for the Overview
    # chart's category filter). Same {supplier_name, total} shape as the overall
    # top_suppliers so the frontend feeds them to the same chart. Up to 10 per
    # category, fewer if the category has fewer suppliers (no zero-padding).
    cat_sup = (
        purchases.groupby(["category", "supplierExternalId", "supplierName"])[
            "totalValueUsd"
        ]
        .sum()
        .reset_index()
    )
    top_suppliers_by_category = {}
    for c, grp in cat_sup.groupby("category"):
        rows = grp.sort_values("totalValueUsd", ascending=False).head(10)
        top_suppliers_by_category[str(c)] = [
            {
                "supplier_id": str(r["supplierExternalId"]),
                "supplier_name": str(r["supplierName"]),
                "total": num(r["totalValueUsd"]),
            }
            for _, r in rows.iterrows()
        ]

    # Spend is bucketed by PAYMENT date (matches the period tag). Rows without a
    # payment date are excluded from the trend only — they still count toward
    # every other aggregation above.
    pm = purchases.copy()
    pm["_pay"] = pd.to_datetime(pm["paymentDate"], errors="coerce")
    pm = pm.dropna(subset=["_pay"])
    pm["month"] = pm["_pay"].dt.strftime("%Y-%m")
    mt = pm.groupby("month")["totalValueUsd"].sum().sort_index()
    mc = pm.groupby("month").size()
    monthly_trend = [
        {"month": str(m), "total": num(t), "po_count": int(mc[m])}
        for m, t in mt.items()
    ]

    return {
        "total_spend": num(total_spend),
        "total_pos": int(len(purchases)),
        "active_suppliers": int(purchases["supplierExternalId"].nunique()),
        "avg_cycle_time": num(purchases["totalCycleDays"].mean()),
        "by_category": by_category,
        "top_suppliers": top_suppliers,
        "top_suppliers_by_category": top_suppliers_by_category,
        "monthly_trend": monthly_trend,
    }


# --------------------------------------------------------------------------- #
# b) ABC / Pareto  (fixed thresholds 0.80 / 0.95)
# --------------------------------------------------------------------------- #
def abc_analysis(purchases, suppliers, metrics):
    spend = (
        purchases.groupby(["supplierExternalId", "supplierName"], as_index=False)["totalValueUsd"]
        .sum().rename(columns={"totalValueUsd": "total"})
        .sort_values("total", ascending=False).reset_index(drop=True)
    )
    spend["rank"] = spend.index + 1
    grand = spend["total"].sum()
    spend["pct"] = spend["total"] / grand if grand else 0.0
    spend["cumulative_pct"] = spend["pct"].cumsum()

    def classify(c):
        if c <= 0.80:
            return "A"
        if c <= 0.95:
            return "B"
        return "C"

    spend["abc_class"] = spend["cumulative_pct"].apply(classify)

    classifications = [
        {
            "supplier_id": str(r["supplierExternalId"]),
            "supplier_name": str(r["supplierName"]),
            "total": num(r["total"]),
            "rank": int(r["rank"]),
            "pct": num(r["pct"], 6),
            "cumulative_pct": num(r["cumulative_pct"], 6),
            "abc_class": r["abc_class"],
        }
        for _, r in spend.iterrows()
    ]

    summary = {}
    for cls in ["A", "B", "C"]:
        sub = spend[spend["abc_class"] == cls]
        st = sub["total"].sum()
        summary[cls] = {
            "n": int(len(sub)),
            "total_spend": num(st),
            "pct_of_spend": num((st / grand) if grand else 0.0, 6),
        }

    return {
        "thresholds": [0.80, 0.95],
        "classifications": classifications,
        "summary": summary,
    }


# --------------------------------------------------------------------------- #
# c) Cycle time — process-health monitoring + date-driven period comparison
#    Metric = total_cycle_days. Replaces the old pre/post "automation impact"
#    test (the automation_period label was removed in Batch 5). Emits ongoing
#    monitoring (monthly trend + 3-mo rolling average, distribution, stage
#    decomposition, per-Kraljic-quadrant descriptives, Z-score anomalies) plus
#    a Mann-Whitney U comparison between the two halves of the selected period
#    (a fixed midpoint split).
# --------------------------------------------------------------------------- #
def _coalesced_date(purchases):
    """Payment date when present, else PR date — mirrors the period tag."""
    pay = pd.to_datetime(purchases["paymentDate"], errors="coerce")
    pr = pd.to_datetime(purchases["prDate"], errors="coerce")
    return pay.fillna(pr)


def _desc_stats(values):
    """mean/median/IQR descriptives over a numeric series (NaNs dropped)."""
    a = pd.to_numeric(pd.Series(values), errors="coerce").dropna()
    if len(a) == 0:
        return {"mean": None, "median": None, "p25": None, "p75": None, "n": 0}
    return {
        "mean": num(a.mean()),
        "median": num(a.median()),
        "p25": num(a.quantile(0.25)),
        "p75": num(a.quantile(0.75)),
        "n": int(len(a)),
    }


def _effect_label(r):
    a = abs(r)
    if a < 0.1:
        return "negligible"
    if a < 0.3:
        return "small"
    if a < 0.5:
        return "medium"
    return "large"


def _comparison_block(a_vals, b_vals, a_bounds, b_bounds):
    """Two-sided Mann-Whitney U + rank-biserial r between two cycle-day samples.
    a_bounds/b_bounds are (start_str, end_str). <10 in either group -> skip the
    test (insufficient_data) but still report bounds, n, and medians."""
    a = pd.to_numeric(pd.Series(a_vals), errors="coerce").dropna().to_numpy()
    b = pd.to_numeric(pd.Series(b_vals), errors="coerce").dropna().to_numpy()
    block = {
        "period_a": {"start": a_bounds[0], "end": a_bounds[1], "n": int(len(a))},
        "period_b": {"start": b_bounds[0], "end": b_bounds[1], "n": int(len(b))},
        "mannwhitney_u": None,
        "p_value": None,
        "rank_biserial_r": None,
        "effect_size_label": None,
        "median_a": num(np.median(a)) if len(a) else None,
        "median_b": num(np.median(b)) if len(b) else None,
        "insufficient_data": len(a) < 10 or len(b) < 10,
    }
    if block["insufficient_data"]:
        return block
    u_stat, p_value = mannwhitneyu(a, b, alternative="two-sided")
    r_rb = 1 - (2 * u_stat) / (len(a) * len(b))
    block.update(
        {
            "mannwhitney_u": float(u_stat),
            "p_value": float(p_value),
            "rank_biserial_r": num(r_rb),
            "effect_size_label": _effect_label(r_rb),
        }
    )
    return block


def cycle_time_analysis(
    purchases, suppliers, metrics, range_start, range_end
):
    p = purchases.copy()
    p["_date"] = _coalesced_date(p)
    cycle = pd.to_numeric(p["totalCycleDays"], errors="coerce")
    p["_cycle"] = cycle

    # --- monthly trend + trailing 3-month rolling average ---------------- #
    pm = p.dropna(subset=["_date"]).copy()
    pm["month"] = pm["_date"].dt.strftime("%Y-%m")
    grp = pm.groupby("month")["_cycle"]
    monthly = grp.mean().sort_index()
    medians = grp.median()
    counts = grp.size()
    monthly_trend = [
        {
            "month": str(m),
            "avg_cycle_days": num(v),
            "median_cycle_days": num(medians[m]),
            "po_count": int(counts[m]),
        }
        for m, v in monthly.items()
    ]
    roll = monthly.rolling(window=3).mean().dropna()
    rolling_avg_trend = [
        {"month": str(m), "rolling_3mo": num(v)} for m, v in roll.items()
    ]

    # --- overall distribution ------------------------------------------- #
    c = cycle.dropna()
    if len(c):
        q1, q3 = float(c.quantile(0.25)), float(c.quantile(0.75))
        distribution = {
            "median": num(c.median()),
            "p25": num(q1),
            "p75": num(q3),
            "iqr": num(q3 - q1),
            "min": num(c.min()),
            "max": num(c.max()),
            "mean": num(c.mean()),
            "n": int(len(c)),
        }
    else:
        distribution = {
            "median": None, "p25": None, "p75": None, "iqr": None,
            "min": None, "max": None, "mean": None, "n": 0,
        }

    # --- stage decomposition (single population) ------------------------ #
    stage_breakdown = {
        "pr_to_po": _desc_stats(p["prToPoDays"]),
        "po_to_delivery": _desc_stats(p["poToDeliveryDays"]),
        "delivery_to_invoice": _desc_stats(p["deliveryToInvoiceDays"]),
        "invoice_to_payment": _desc_stats(p["invoiceToPaymentDays"]),
    }

    # --- Z-score anomalies (cycle time > 2σ above the mean) ------------- #
    # One-sided: slow outliers are the operational concern (right-skewed data,
    # so z < -2 effectively never occurs). Top 15 by z, descending.
    anomalies = []
    mean_c = float(c.mean()) if len(c) else 0.0
    std_c = float(c.std(ddof=1)) if len(c) > 1 else 0.0
    if std_c > 0:
        pz = p.copy()
        pz["_z"] = (pz["_cycle"] - mean_c) / std_c
        flagged = pz[pz["_z"] > 2].sort_values("_z", ascending=False).head(15)
        for _, r in flagged.iterrows():
            d = r["_date"]
            anomalies.append(
                {
                    "po_id": str(r["poId"]),
                    "supplier_id": str(r["supplierExternalId"]),
                    "supplier_name": str(r["supplierName"]),
                    "invoice_date": d.strftime("%Y-%m-%d") if pd.notna(d) else None,
                    "cycle_days": int(r["_cycle"]) if pd.notna(r["_cycle"]) else None,
                    "z_score": num(r["_z"], 2),
                }
            )

    # --- period comparison (default midpoint split of the selected period) ---- #
    start_ts = pd.to_datetime(range_start)
    end_ts = pd.to_datetime(range_end)
    mid = (start_ts + (end_ts - start_ts) / 2).normalize()
    a_start, a_end = start_ts.normalize(), mid
    b_start, b_end = mid + pd.Timedelta(days=1), end_ts.normalize()

    def _between(s, e):
        return p[(p["_date"] >= s) & (p["_date"] <= e + pd.Timedelta(hours=23, minutes=59, seconds=59))]

    fmt = lambda t: t.strftime("%Y-%m-%d")
    period_comparison = _comparison_block(
        _between(a_start, a_end)["_cycle"],
        _between(b_start, b_end)["_cycle"],
        (fmt(a_start), fmt(a_end)),
        (fmt(b_start), fmt(b_end)),
    )

    # --- per-Kraljic-quadrant descriptives (single population) ---------- #
    quad_map = {}
    if suppliers is not None and metrics is not None and len(suppliers):
        risk_map, _c, _components = compute_supply_risk(p, suppliers, metrics)
        spend_raw = p.groupby("supplierExternalId")["totalValueUsd"].sum()
        log_spend_map = {sid: float(np.log1p(v)) for sid, v in spend_raw.items()}
        krj_sids = [s for s in log_spend_map if s in risk_map]
        if krj_sids:
            quad_map, _sm, _rm = assign_kraljic_quadrants(
                {s: log_spend_map[s] for s in krj_sids},
                {s: risk_map[s] for s in krj_sids},
            )

    pq = p.copy()
    pq["quadrant"] = pq["supplierExternalId"].map(quad_map)
    cycle_by_quadrant = {}
    match_raw = {}
    for q in ["Strategic", "Leverage", "Bottleneck", "Routine"]:
        sub = pq[pq["quadrant"] == q]
        cycle_by_quadrant[q] = _desc_stats(sub["_cycle"])
        n_pos = int(len(sub))
        pass_rate = (
            num(sub["threeWayMatchPass"].astype(bool).mean() * 100) if n_pos else None
        )
        match_raw[q] = {"pass_rate_pct": pass_rate, "n": n_pos}

    # is_worst = the quadrant with the LOWEST pass rate among those with POs.
    candidates = [
        (q, m["pass_rate_pct"])
        for q, m in match_raw.items()
        if m["n"] > 0 and m["pass_rate_pct"] is not None
    ]
    worst_q = min(candidates, key=lambda x: x[1])[0] if candidates else None
    three_way_match_by_quadrant = {
        q: {**m, "is_worst": (q == worst_q)} for q, m in match_raw.items()
    }

    return {
        "metric": "total_cycle_days",
        "monthly_trend": monthly_trend,
        "rolling_avg_trend": rolling_avg_trend,
        "distribution": distribution,
        "stage_breakdown": stage_breakdown,
        "anomalies": anomalies,
        "period_comparison": period_comparison,
        "cycle_by_quadrant": cycle_by_quadrant,
        "three_way_match_by_quadrant": three_way_match_by_quadrant,
    }


# --------------------------------------------------------------------------- #
# d) Performance vs Spend diagnostic  (median split on log_spend x performance)
#    Crosses spend volume against the supplier compositeScore and tags each
#    supplier with its PERIOD-ACCURATE Kraljic quadrant (recomputed here via the
#    same helpers kraljic_analysis uses) for cross-reference colouring.
# --------------------------------------------------------------------------- #
def performance_spend_analysis(purchases, suppliers, metrics):
    spend_raw = purchases.groupby("supplierExternalId")["totalValueUsd"].sum()
    total_spend_map = {sid: float(v) for sid, v in spend_raw.items()}
    log_spend_map = {sid: float(np.log1p(v)) for sid, v in spend_raw.items()}

    # Period-accurate Kraljic quadrant (mirrors kraljic_analysis's setup).
    risk_map, _comp, _components = compute_supply_risk(purchases, suppliers, metrics)
    krj_sids = [s for s in log_spend_map if s in risk_map]
    quad_map, _sm, _rm = assign_kraljic_quadrants(
        {s: log_spend_map[s] for s in krj_sids},
        {s: risk_map[s] for s in krj_sids},
    )

    sup_meta = (
        suppliers.rename(columns={"externalId": "supplierExternalId"})
        .drop_duplicates("supplierExternalId")
        .set_index("supplierExternalId")
    )
    comp_score = (
        metrics.drop_duplicates("supplierExternalId").set_index("supplierExternalId")
        if len(metrics)
        else pd.DataFrame()
    )

    def name_of(s):
        return str(sup_meta.loc[s, "supplierName"]) if s in sup_meta.index else s

    def perf_of(s):
        if len(comp_score) and s in comp_score.index:
            v = comp_score.loc[s, "compositeScore"]
            return float(v) if pd.notna(v) else None
        return None

    empty = {
        "suppliers": [],
        "zone_profiles": [],
        "axis_thresholds": {"spend_median": 0, "performance_median": 0},
        "top_critical_issues": [],
        "top_hidden_gems": [],
        "performance_by_quadrant": {},
    }

    # Suppliers needing both spend AND a performance score (and a quadrant).
    sids = [s for s in krj_sids if perf_of(s) is not None]
    if not sids:
        return empty

    spend_med = float(np.median([log_spend_map[s] for s in sids]))
    perf_med = float(np.median([perf_of(s) for s in sids]))

    def zone_of(s):
        hi_spend = log_spend_map[s] > spend_med
        hi_perf = perf_of(s) > perf_med
        if hi_spend and hi_perf:
            return "Stars"
        if hi_spend and not hi_perf:
            return "Critical Issues"
        if not hi_spend and hi_perf:
            return "Hidden Gems"
        return "Long Tail"

    rows = [
        {
            "supplier_id": s,
            "supplier_name": name_of(s),
            "log_spend": num(log_spend_map[s]),
            "total_spend_usd": num(total_spend_map[s]),
            "performance_score": num(perf_of(s)),
            "kraljic_quadrant": quad_map[s],
            "zone": zone_of(s),
        }
        for s in sids
    ]

    grand_total = sum(total_spend_map[s] for s in sids) or 1.0
    zone_profiles = []
    for z in ["Stars", "Critical Issues", "Hidden Gems", "Long Tail"]:
        members = [s for s in sids if zone_of(s) == z]
        tot = sum(total_spend_map[s] for s in members)
        perfs = [perf_of(s) for s in members]
        zone_profiles.append(
            {
                "zone": z,
                "n_suppliers": len(members),
                "total_spend_usd": num(tot),
                "pct_of_total_spend": num((tot / grand_total) * 100),
                "avg_performance": num(np.mean(perfs)) if perfs else None,
            }
        )

    top_critical_issues = sorted(
        [r for r in rows if r["zone"] == "Critical Issues"],
        key=lambda r: r["total_spend_usd"],
        reverse=True,
    )[:5]
    top_hidden_gems = sorted(
        [r for r in rows if r["zone"] == "Hidden Gems"],
        key=lambda r: r["performance_score"],
        reverse=True,
    )[:5]

    performance_by_quadrant = {}
    for q in ["Strategic", "Leverage", "Bottleneck", "Routine"]:
        qmembers = [s for s in sids if quad_map[s] == q]
        performance_by_quadrant[q] = (
            num(np.mean([perf_of(s) for s in qmembers])) if qmembers else 0
        )

    return {
        "suppliers": rows,
        "zone_profiles": zone_profiles,
        "axis_thresholds": {
            "spend_median": num(spend_med),
            "performance_median": num(perf_med),
        },
        "top_critical_issues": top_critical_issues,
        "top_hidden_gems": top_hidden_gems,
        "performance_by_quadrant": performance_by_quadrant,
    }


# cycle_time, kraljic and recommendations are computed separately in main()
# because they need extra arguments beyond the (purchases, suppliers, metrics)
# signature this loop uses.
ANALYSES = [
    ("spend_overview", spend_overview),
    ("abc", abc_analysis),
    ("performance_spend", performance_spend_analysis),
]


# --------------------------------------------------------------------------- #
# d) Kraljic matrix  (supply-risk score + quadrant assignment)
# --------------------------------------------------------------------------- #
# ASEAN ISO alpha-2 codes (data stores codes, not names).
# Import-friction tiers reflect Indonesia's TRADE-AGREEMENT coverage (AFTA, RCEP)
# — i.e. how easy/cheap it is to import from that origin — NOT geographic distance.
AFTA_CODES = {"MY", "SG", "TH", "VN", "PH", "BN", "MM", "LA", "KH"}  # ASEAN free-trade area
RCEP_NON_ASEAN = {"JP", "KR", "CN", "AU", "NZ"}  # RCEP partners outside ASEAN


def _import_friction_points(country):
    """Import friction (0..25) by trade-agreement coverage. Complete + robust: any
    unmapped / unknown / empty code falls through to the explicit safe default (25)
    so this can never error or return None — it feeds the Kraljic supply-risk Y-axis.
      ID                     -> 0   (domestic)
      AFTA / ASEAN           -> 8
      RCEP non-ASEAN         -> 16
      everything else / unknown -> 25
    """
    c = str(country).strip().upper()
    if c in ("ID", "IDN", "INDONESIA"):
        return 0.0
    if c in AFTA_CODES:
        return 8.0
    if c in RCEP_NON_ASEAN:
        return 16.0
    return 25.0


def _cost_premium_points(purchases):
    """Period-scoped cost premium (0..25) per supplier, from Purchase prices.

    For each item, the benchmark is the spend-weighted average unit price across
    ALL suppliers selling it within the period (item_avg = sum(price*qty)/sum(qty)).
    A supplier's premium on an item = its own spend-weighted avg unit price / item_avg
    - 1, COUNTED only when that supplier x item has >= 2 POs (n=1 excluded as noise)
    AND the item has >= 2 suppliers (single-source items have no benchmark -> neutral).
    The supplier's overall premium is the spend-weighted average of its qualifying
    item premiums (weight = the supplier's spend on each item); points =
    clip(premium * 62.5, 0, 25) (+8% -> 5, +20% -> 12.5, +40%+ -> 25; at/below market
    -> 0, never negative). Suppliers with no qualifying items -> 0 (returned absent).
    """
    if purchases is None or len(purchases) == 0:
        return {}
    p = purchases[["supplierExternalId", "itemDescription", "unitPriceUsd", "quantity"]].copy()
    p["spend"] = p["unitPriceUsd"].astype(float) * p["quantity"].astype(float)
    p["qty"] = p["quantity"].astype(float)

    # supplier x item: total spend, qty, PO count, spend-weighted avg unit price.
    g = (
        p.groupby(["itemDescription", "supplierExternalId"])
        .agg(spend=("spend", "sum"), qty=("qty", "sum"), po=("unitPriceUsd", "size"))
        .reset_index()
    )
    g = g[g["qty"] > 0].copy()
    g["avg_price"] = g["spend"] / g["qty"]

    # item benchmark: spend-weighted avg unit price across all suppliers of the item.
    item = (
        g.groupby("itemDescription")
        .agg(item_spend=("spend", "sum"), item_qty=("qty", "sum"), n_sup=("supplierExternalId", "nunique"))
        .reset_index()
    )
    item = item[item["item_qty"] > 0].copy()
    item["item_avg"] = item["item_spend"] / item["item_qty"]
    g = g.merge(item[["itemDescription", "item_avg", "n_sup"]], on="itemDescription", how="inner")

    g["premium"] = g["avg_price"] / g["item_avg"] - 1.0
    # qualifying rows: supplier has >=2 POs of the item AND the item is benchmarkable.
    qual = g[(g["po"] >= 2) & (g["n_sup"] >= 2)]

    out = {}
    for sid, grp in qual.groupby("supplierExternalId"):
        wsum = float(grp["spend"].sum())
        if wsum <= 0:
            continue
        prem = float((grp["premium"] * grp["spend"]).sum() / wsum)
        out[sid] = float(np.clip(prem * 62.5, 0.0, 25.0))
    return out


def compute_supply_risk(purchases, suppliers, metrics):
    """Return (risk_map, competition_map, components_map) over the supplier set.

    risk = supply_concentration(0-50) + cost_premium(0-25)
         + import_friction(0/8/16/25), clipped to [0,100].
    `purchases` is the period/range-scoped Purchase frame — it drives the
    period-scoped cost_premium benchmark. supply_concentration MERGES the former
    single_source (a stored flag that contradicted the roster for ~91% of flagged
    suppliers) and category_competition into ONE roster-derived component, so it
    can never disagree with the actual supplier set. `metrics` is no longer read
    here (the singleSourceRisk flag is dropped from supply risk; its use in the
    performance composite's risk_score is separate and unchanged).
    """
    sup = suppliers.rename(columns={"externalId": "supplierExternalId"}).drop_duplicates(
        "supplierExternalId"
    )
    df = sup[["supplierExternalId", "category", "country"]].copy()

    # OTHER suppliers in the same category (this period-scoped supplier set).
    cat_size = df.groupby("category")["supplierExternalId"].transform("size")
    df["other_in_category"] = (cat_size - 1).astype(int)

    # 1. supply concentration (0-50): step curve on the # of category alternatives,
    #    merging single-source status + competition into one roster-derived measure.
    #    0 other (true single source) -> 50, 1 -> 35, 2 -> 22, 3 -> 12, 4 -> 5, >=5 -> 0.
    _CONC = {0: 50.0, 1: 35.0, 2: 22.0, 3: 12.0, 4: 5.0}
    c_conc = df["other_in_category"].map(lambda o: _CONC.get(int(o), 0.0)).astype(float)
    # 2. cost premium (0-25): period-scoped, benchmarked vs item spend-weighted avg.
    prem_map = _cost_premium_points(purchases)
    c_premium = df["supplierExternalId"].map(prem_map).fillna(0.0).astype(float)
    # 3. import friction (0/8/16/25): Indonesia trade-agreement coverage.
    c_friction = df["country"].apply(_import_friction_points).astype(float)

    risk = np.clip(c_conc.values + c_premium.values + c_friction.values, 0, 100)

    risk_map = {sid: float(r) for sid, r in zip(df["supplierExternalId"], risk)}
    competition_map = {
        sid: int(o) for sid, o in zip(df["supplierExternalId"], df["other_in_category"])
    }
    # Per-supplier breakdown of the three risk components (raw, unrounded). The
    # supply-risk score is exactly their sum — the clip above is a no-op since the
    # components max at 50 + 25 + 25 = 100 — so a 2dp display total reconciles with
    # the 2dp component bars (see kraljic_analysis's emit).
    components_map = {
        sid: {
            "supply_concentration": float(cc),
            "cost_premium": float(cp),
            "import_friction": float(cf),
        }
        for sid, cc, cp, cf in zip(
            df["supplierExternalId"],
            c_conc.values,
            c_premium.values,
            c_friction.values,
        )
    }
    return risk_map, competition_map, components_map


def assign_kraljic_quadrants(spend_map, risk_map):
    """Median split on log_spend (x) and supply_risk (y) as the crossing point."""
    sids = list(spend_map.keys())
    spend_med = float(np.median([spend_map[s] for s in sids])) if sids else 0.0
    risk_med = float(np.median([risk_map[s] for s in sids])) if sids else 0.0
    quad = {}
    for s in sids:
        hi_spend = spend_map[s] > spend_med
        hi_risk = risk_map[s] > risk_med
        if hi_spend and hi_risk:
            quad[s] = "Strategic"
        elif hi_spend and not hi_risk:
            quad[s] = "Leverage"
        elif not hi_spend and hi_risk:
            quad[s] = "Bottleneck"
        else:
            quad[s] = "Routine"
    return quad, spend_med, risk_med


def kraljic_analysis(purchases, suppliers, metrics):
    """Build the KraljicResult and return (result, risk_map, comp_map, quad_map)."""
    spend_raw = purchases.groupby("supplierExternalId")["totalValueUsd"].sum()
    total_spend_map = {sid: float(v) for sid, v in spend_raw.items()}
    spend_map = {sid: float(np.log1p(v)) for sid, v in spend_raw.items()}

    risk_map, comp_map, components_map = compute_supply_risk(purchases, suppliers, metrics)

    # Only suppliers with both spend (purchases) and a computed risk.
    sids = [s for s in spend_map if s in risk_map]
    spend_map = {s: spend_map[s] for s in sids}
    risk_map = {s: risk_map[s] for s in sids}
    comp_map = {s: comp_map.get(s, 0) for s in sids}

    quad_map, spend_med, risk_med = assign_kraljic_quadrants(spend_map, risk_map)

    sup_meta = (
        suppliers.rename(columns={"externalId": "supplierExternalId"})
        .drop_duplicates("supplierExternalId")
        .set_index("supplierExternalId")
    )
    comp_score = (
        metrics.drop_duplicates("supplierExternalId").set_index("supplierExternalId")
        if len(metrics)
        else pd.DataFrame()
    )

    def name_of(s):
        return str(sup_meta.loc[s, "supplierName"]) if s in sup_meta.index else s

    def perf_of(s):
        if len(comp_score) and s in comp_score.index:
            v = comp_score.loc[s, "compositeScore"]
            return float(v) if pd.notna(v) else None
        return None

    def risk_breakdown(s):
        """4 components + their 2dp sum. The total IS the sum of the rounded
        components, so the detail panel's Supply-risk breakdown bars reconcile
        exactly with the supply_risk_score plotted on the scatter (no drift)."""
        c = components_map.get(s, {})
        cc = round(float(c.get("supply_concentration", 0.0)), 2)
        cp = round(float(c.get("cost_premium", 0.0)), 2)
        cf = round(float(c.get("import_friction", 0.0)), 2)
        return round(cc + cp + cf, 2), {
            "supply_concentration": cc,
            "cost_premium": cp,
            "import_friction": cf,
        }

    quadrant_assignments = []
    for s in sids:
        risk_total, risk_components = risk_breakdown(s)
        quadrant_assignments.append(
            {
                "supplier_id": s,
                "supplier_name": name_of(s),
                "log_spend": num(spend_map[s]),
                "supply_risk_score": risk_total,
                "risk_components": risk_components,
                "quadrant": quad_map[s],
            }
        )

    grand_total = sum(total_spend_map[s] for s in sids) or 1.0
    quadrant_profiles = []
    for q in ["Strategic", "Leverage", "Bottleneck", "Routine"]:
        members = [s for s in sids if quad_map[s] == q]
        tot = sum(total_spend_map[s] for s in members)
        perfs = [perf_of(s) for s in members if perf_of(s) is not None]
        quadrant_profiles.append(
            {
                "quadrant": q,
                "n_suppliers": len(members),
                "total_spend": num(tot),
                "pct_of_total_spend": num((tot / grand_total) * 100),
                "avg_performance_score": num(np.mean(perfs)) if perfs else None,
                "median_risk": num(np.median([risk_map[s] for s in members])) if members else None,
                "median_spend": num(np.median([spend_map[s] for s in members])) if members else None,
            }
        )

    result = {
        "quadrant_assignments": quadrant_assignments,
        "quadrant_profiles": quadrant_profiles,
        "axis_thresholds": {"spend_median": num(spend_med), "risk_median": num(risk_med)},
    }
    return result, risk_map, comp_map, quad_map


# --------------------------------------------------------------------------- #
# f) Recommendations engine  (synthesizes all 4 analyses into ranked actions)
#    Self-contained: recomputes its own intermediate data via the shared 11A
#    helpers so it never depends on execution order. All impact scores are
#    normalized to [0, 100] so the global ranking is comparable across the 5
#    categories, while each remains proportional to its category's key metric.
# --------------------------------------------------------------------------- #
def recommendations_analysis(purchases, suppliers, metrics, period_label=""):
    from datetime import datetime, timezone

    spend_raw = purchases.groupby("supplierExternalId")["totalValueUsd"].sum()
    total_spend_map = {sid: float(v) for sid, v in spend_raw.items()}
    log_spend_map = {sid: float(np.log1p(v)) for sid, v in spend_raw.items()}
    max_log = max(log_spend_map.values()) if log_spend_map else 1.0

    risk_map, comp_map, _components = compute_supply_risk(purchases, suppliers, metrics)
    krj_sids = [s for s in log_spend_map if s in risk_map]
    if krj_sids:
        quad_map, _sm, _rm = assign_kraljic_quadrants(
            {s: log_spend_map[s] for s in krj_sids},
            {s: risk_map[s] for s in krj_sids},
        )
    else:
        quad_map = {}

    sup_meta = (
        suppliers.rename(columns={"externalId": "supplierExternalId"})
        .drop_duplicates("supplierExternalId")
        .set_index("supplierExternalId")
    )
    m = (
        metrics.drop_duplicates("supplierExternalId").set_index("supplierExternalId")
        if len(metrics)
        else pd.DataFrame()
    )

    def name_of(s):
        return str(sup_meta.loc[s, "supplierName"]) if s in sup_meta.index else s

    def country_of(s):
        return (
            str(sup_meta.loc[s, "country"])
            if s in sup_meta.index and "country" in sup_meta.columns
            else ""
        )

    def perf_of(s):
        if len(m) and s in m.index and pd.notna(m.loc[s, "compositeScore"]):
            return float(m.loc[s, "compositeScore"])
        return None

    def single_source_of(s):
        if (
            len(m)
            and s in m.index
            and "singleSourceRisk" in m.columns
            and pd.notna(m.loc[s, "singleSourceRisk"])
        ):
            return float(m.loc[s, "singleSourceRisk"])
        return 0.0

    def spend_norm(s):
        return (log_spend_map[s] / max_log * 100.0) if max_log > 0 else 0.0

    def usd(v):
        return f"${v:,.0f}"

    # Suppliers with spend + performance + a quadrant (zone universe).
    sids = [s for s in krj_sids if perf_of(s) is not None]
    spend_med = float(np.median([log_spend_map[s] for s in sids])) if sids else 0.0
    perf_med = float(np.median([perf_of(s) for s in sids])) if sids else 0.0

    def zone_of(s):
        hi_spend = log_spend_map[s] > spend_med
        hi_perf = perf_of(s) > perf_med
        if hi_spend and hi_perf:
            return "Stars"
        if hi_spend and not hi_perf:
            return "Critical Issues"
        if not hi_spend and hi_perf:
            return "Hidden Gems"
        return "Long Tail"

    recs = []

    # CATEGORY 1: critical-issues engagement (top 5 by spend).
    crit = sorted(
        [s for s in sids if zone_of(s) == "Critical Issues"],
        key=lambda s: total_spend_map[s],
        reverse=True,
    )[:5]
    for s in crit:
        gap = max(0.0, perf_med - perf_of(s))
        recs.append({
            "type": "critical_issues_engagement",
            "action": "engage",
            "supplier_id": s,
            "supplier_name": name_of(s),
            "reasoning": (
                f"High-spend supplier with concerning performance. Spend exposure "
                f"{usd(total_spend_map[s])}, performance score {perf_of(s):.1f} "
                f"(below {perf_med:.1f} median). Kraljic quadrant: {quad_map.get(s)}. "
                f"Initiate supplier development engagement or identify alternatives."
            ),
            "impact_score": num(min(100.0, 0.7 * spend_norm(s) + 0.3 * min(100.0, gap * 2))),
            "total_spend_usd": num(total_spend_map[s]),
            "performance_score": num(perf_of(s)),
            "kraljic_quadrant": quad_map.get(s),
        })

    # CATEGORY 2: hidden-gems promotion (top 5 by performance).
    gems = sorted(
        [s for s in sids if zone_of(s) == "Hidden Gems"],
        key=lambda s: perf_of(s),
        reverse=True,
    )[:5]
    denom = (100.0 - perf_med) or 1.0
    for s in gems:
        surplus = max(0.0, perf_of(s) - perf_med)
        recs.append({
            "type": "hidden_gems_promotion",
            "action": "promote",
            "supplier_id": s,
            "supplier_name": name_of(s),
            "reasoning": (
                f"High-performance supplier (score {perf_of(s):.1f}) with currently "
                f"small spend exposure ({usd(total_spend_map[s])}). Strong candidate "
                f"for expanded scope — evaluate for an expanded share of wallet."
            ),
            "impact_score": num(min(100.0, surplus / denom * 100.0)),
            "total_spend_usd": num(total_spend_map[s]),
            "performance_score": num(perf_of(s)),
        })

    # CATEGORY 3: bottleneck risk mitigation (top 5 by supply risk).
    bottleneck = sorted(
        [s for s in sids if quad_map.get(s) == "Bottleneck"],
        key=lambda s: risk_map.get(s, 0.0),
        reverse=True,
    )[:5]
    for s in bottleneck:
        ss = single_source_of(s)
        ctry = country_of(s)
        recs.append({
            "type": "bottleneck_risk",
            "action": "mitigate",
            "supplier_id": s,
            "supplier_name": name_of(s),
            "reasoning": (
                f"Low-spend supplier ({usd(total_spend_map[s])}) with high supply risk "
                f"(score {risk_map[s]:.1f}). Single-source: {'yes' if ss >= 1 else 'no'}, "
                f"Country: {ctry or 'n/a'}, Category alternatives: {comp_map.get(s, 0)}. "
                f"Develop alternative suppliers, build inventory buffers, or explore "
                f"standardization."
            ),
            "impact_score": num(min(100.0, risk_map[s])),
            "supply_risk_score": num(risk_map[s]),
            "country": ctry,
            "total_spend_usd": num(total_spend_map[s]),
        })

    # CATEGORY 4: process improvement (non-supplier-specific; up to 3).
    pq = purchases.copy()
    pq["quadrant"] = pq["supplierExternalId"].map(quad_map)
    fails = []
    for q in ["Strategic", "Leverage", "Bottleneck", "Routine"]:
        sub = pq[pq["quadrant"] == q]
        n = len(sub)
        if n:
            fails.append((q, float((~sub["threeWayMatchPass"].astype(bool)).sum() / n * 100), n))
    proc = []
    if fails:
        wq = max(fails, key=lambda x: x[1])
        proc.append({
            "type": "process_improvement",
            "action": "improve",
            "scope": f"Quadrant: {wq[0]} compliance",
            "reasoning": (
                f"3-way match failure rate is {wq[1]:.1f}% in the {wq[0]} quadrant "
                f"({wq[2]} POs) — the weakest match compliance among quadrants."
            ),
            "impact_score": num(min(100.0, wq[1])),
        })
    # Internal P2P process stages only. PO→Delivery is physical supplier lead
    # time (not an internal process stage), so it is excluded from the process
    # friction flag to avoid a non-actionable false positive.
    stage_cols = [
        ("prToPoDays", "PR to PO"),
        ("deliveryToInvoiceDays", "Delivery to Invoice"),
        ("invoiceToPaymentDays", "Invoice to Payment"),
    ]
    for col, label in stage_cols:
        v = pd.to_numeric(purchases[col], errors="coerce").dropna()
        if len(v) and v.mean() > 8:
            proc.append({
                "type": "process_improvement",
                "action": "improve",
                "scope": f"Stage: {label}",
                "reasoning": (
                    f"{label} averages {v.mean():.1f} days — a slow internal "
                    f"process stage worth investigating."
                ),
                "impact_score": num(min(100.0, v.mean() / 18.0 * 100.0)),
            })
    recs.extend(proc[:3])

    recs.sort(key=lambda r: r["impact_score"] if r["impact_score"] is not None else 0.0, reverse=True)

    by_category = {
        "critical_issues_engagement": 0,
        "hidden_gems_promotion": 0,
        "bottleneck_risk": 0,
        "process_improvement": 0,
    }
    for r in recs:
        by_category[r["type"]] = by_category.get(r["type"], 0) + 1

    return {
        "period_label": period_label,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "recommendations": recs,
        "summary_stats": {
            "total_recommendations": len(recs),
            "by_category": by_category,
            "highest_impact": recs[0] if recs else None,
        },
    }


def writeback_supplier_metrics(conn, risk_map, comp_map, quad_map):
    """Mode A only: denormalize the latest computed risk/quadrant onto SupplierMetric."""
    with conn.cursor() as cur:
        for sid, quadrant in quad_map.items():
            cur.execute(
                'UPDATE "SupplierMetric" '
                'SET "supplyRiskScore" = %s, "kraljicQuadrant" = %s, "categoryCompetition" = %s '
                'WHERE "supplierExternalId" = %s',
                (
                    float(round(risk_map.get(sid, 0.0), 2)),
                    quadrant,
                    int(comp_map.get(sid, 0)),
                    sid,
                ),
            )
    conn.commit()


# --------------------------------------------------------------------------- #
# Persistence (Mode A)
# --------------------------------------------------------------------------- #
def upsert(conn, period_id, analysis_type, result):
    payload = json.dumps(result, default=json_default, allow_nan=False)
    new_id = "c" + uuid.uuid4().hex
    with conn.cursor() as cur:
        cur.execute(
            """
            INSERT INTO "AnalysisResult" ("id", "periodId", "analysisType", "resultJson", "computedAt")
            VALUES (%s, %s, %s, %s::jsonb, NOW())
            ON CONFLICT ("periodId", "analysisType")
            DO UPDATE SET "resultJson" = EXCLUDED."resultJson", "computedAt" = NOW()
            """,
            (new_id, period_id, analysis_type, payload),
        )
    conn.commit()


def get_period_dates(conn, period_id):
    with conn.cursor() as cur:
        cur.execute(
            'SELECT "startDate", "endDate", "name" FROM "ReportingPeriod" WHERE id = %s',
            (period_id,),
        )
        row = cur.fetchone()
    if not row:
        raise RuntimeError(f"ReportingPeriod {period_id} not found")
    return row[0], row[1], row[2]


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main():
    parser = argparse.ArgumentParser(description="Compute procurement analyses.")
    parser.add_argument("--period-id", help="Mode A: compute + upsert for a period")
    parser.add_argument("--start-date", help="Mode B: range start (YYYY-MM-DD)")
    parser.add_argument("--end-date", help="Mode B: range end (YYYY-MM-DD)")
    args = parser.parse_args()

    if args.period_id:
        mode = "A"
    elif args.start_date and args.end_date:
        mode = "B"
    else:
        log("ERROR: pass --period-id OR both --start-date and --end-date")
        sys.exit(2)

    load_env()
    dsn = get_dsn()
    conn = None
    try:
        conn = psycopg2.connect(dsn)

        if mode == "A":
            start_ts, end_ts, period_name = get_period_dates(conn, args.period_id)
            log(f"Mode A: period '{period_name}' ({start_ts} .. {end_ts})")
        else:
            start_ts = f"{args.start_date} 00:00:00"
            end_ts = f"{args.end_date} 23:59:59"
            log(f"Mode B: range {start_ts} .. {end_ts}")

        suppliers, purchases, metrics = load_frames(conn, start_ts, end_ts)
        log(
            f"Loaded {len(suppliers)} suppliers, {len(purchases)} purchases, "
            f"{len(metrics)} metrics"
        )
        if len(purchases) == 0:
            log("ERROR: no purchases in range; nothing to compute.")
            sys.exit(1)

        results = {}
        for name, fn in ANALYSES:
            try:
                log(f"Computing {name}...")
                results[name] = fn(purchases, suppliers, metrics)
            except Exception as exc:  # noqa: BLE001
                log(f"FAILED {name}: {exc}")
                traceback.print_exc(file=sys.stderr)
                results[name] = None

        # Kraljic is computed separately: it returns supplier-level maps used for
        # the Mode A SupplierMetric writeback in addition to the result payload.
        kraljic_writeback = None
        try:
            log("Computing kraljic...")
            kr_result, risk_map, comp_map, quad_map = kraljic_analysis(
                purchases, suppliers, metrics
            )
            results["kraljic"] = kr_result
            kraljic_writeback = (risk_map, comp_map, quad_map)
        except Exception as exc:  # noqa: BLE001
            log(f"FAILED kraljic: {exc}")
            traceback.print_exc(file=sys.stderr)
            results["kraljic"] = None

        # Recommendations synthesize all analyses; computed separately because
        # they need a human-readable period label (not available in the ANALYSES
        # 3-arg loop signature).
        period_label = period_name if mode == "A" else f"{args.start_date} – {args.end_date}"
        try:
            log("Computing recommendations...")
            results["recommendations"] = recommendations_analysis(
                purchases, suppliers, metrics, period_label
            )
        except Exception as exc:  # noqa: BLE001
            log(f"FAILED recommendations: {exc}")
            traceback.print_exc(file=sys.stderr)
            results["recommendations"] = None

        # Cycle time: monitoring + a default midpoint-split period comparison.
        # Computed separately because it needs the period bounds.
        try:
            log("Computing cycle_time...")
            results["cycle_time"] = cycle_time_analysis(
                purchases, suppliers, metrics, start_ts, end_ts
            )
        except Exception as exc:  # noqa: BLE001
            log(f"FAILED cycle_time: {exc}")
            traceback.print_exc(file=sys.stderr)
            results["cycle_time"] = None

        all_types = [n for n, _ in ANALYSES] + [
            "kraljic",
            "recommendations",
            "cycle_time",
        ]

        if mode == "A":
            succeeded = 0
            for name in all_types:
                if results.get(name) is not None:
                    upsert(conn, args.period_id, name, results[name])
                    succeeded += 1
            # Denormalize risk/quadrant onto SupplierMetric (latest period wins).
            if kraljic_writeback is not None:
                writeback_supplier_metrics(conn, *kraljic_writeback)
            log(
                f"Done. {succeeded}/{len(all_types)} analyses upserted for period {args.period_id}."
            )
            sys.exit(0 if succeeded == len(all_types) else 1)
        else:
            # Mode B: pure JSON to stdout.
            print(json.dumps(results, default=json_default, allow_nan=False))
            sys.exit(0)

    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        log(f"FATAL: {exc}")
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
    finally:
        if conn is not None:
            conn.close()


if __name__ == "__main__":
    main()
