#!/usr/bin/env python3
"""Compute the 4 fixed procurement analyses over a DATE RANGE.

Two modes:
  Mode A (cache):   --period-id <id>
      Looks up the period's start/end dates, computes, and UPSERTs each analysis
      into AnalysisResult (one row per analysisType per period).
  Mode B (on-the-fly):  --start-date YYYY-MM-DD --end-date YYYY-MM-DD
      Computes over the date span and prints a single JSON object
      {spend_overview, abc, hypothesis, performance_spend, kraljic} to STDOUT.
      No DB writes.

Data is filtered by Purchase.prDate (periodId on rows is decorative). Suppliers
and metrics are derived from the suppliers that appear in the filtered purchases.
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
    purchases = _df(
        conn,
        'SELECT * FROM "Purchase" WHERE "prDate" >= %s AND "prDate" <= %s',
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
    metrics = _df(
        conn,
        'SELECT DISTINCT ON ("supplierExternalId") * FROM "SupplierMetric" '
        'WHERE "supplierExternalId" IN %s ORDER BY "supplierExternalId"',
        (supplier_ids,),
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
    top_suppliers = [{"supplier_name": str(n), "total": num(t)} for (_s, n), t in sup.items()]

    pm = purchases.copy()
    pm["month"] = pd.to_datetime(pm["poDate"]).dt.strftime("%Y-%m")
    mt = pm.groupby("month")["totalValueUsd"].sum().sort_index()
    monthly_trend = [{"month": str(m), "total": num(t)} for m, t in mt.items()]

    return {
        "total_spend": num(total_spend),
        "total_pos": int(len(purchases)),
        "active_suppliers": int(purchases["supplierExternalId"].nunique()),
        "avg_cycle_time": num(purchases["totalCycleDays"].mean()),
        "by_category": by_category,
        "top_suppliers": top_suppliers,
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
    tier_map = dict(zip(suppliers["externalId"], suppliers["tier"])) if len(suppliers) else {}
    spend["tier"] = spend["supplierExternalId"].map(tier_map).fillna("Unknown")

    classifications = [
        {
            "supplier_id": str(r["supplierExternalId"]),
            "supplier_name": str(r["supplierName"]),
            "tier": str(r["tier"]),
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

    ct = pd.crosstab(spend["tier"], spend["abc_class"])
    crosstab = {str(t): {str(c): int(ct.loc[t, c]) for c in ct.columns} for t in ct.index}

    # Class-major crosstab over the declared tiers (for the ABC × Tier insight).
    abc_vs_tier = {}
    for cls in ["A", "B", "C"]:
        sub = spend[spend["abc_class"] == cls]
        abc_vs_tier[cls] = {
            t: int((sub["tier"] == t).sum())
            for t in ["Strategic", "Preferred", "Approved"]
        }

    return {
        "thresholds": [0.80, 0.95],
        "classifications": classifications,
        "summary": summary,
        "crosstab": crosstab,
        "abc_vs_tier": abc_vs_tier,
    }


# --------------------------------------------------------------------------- #
# c) Hypothesis test  (Mann-Whitney U on invoice_to_payment_days, pre vs post)
# --------------------------------------------------------------------------- #
def hypothesis_test(purchases, suppliers=None, metrics=None):
    pre = (
        purchases.loc[purchases["automationPeriod"] == "pre", "invoiceToPaymentDays"]
        .astype(float).dropna().values
    )
    post = (
        purchases.loc[purchases["automationPeriod"] == "post", "invoiceToPaymentDays"]
        .astype(float).dropna().values
    )

    def stats_block(arr):
        if len(arr) == 0:
            return {
                "n": 0, "mean": None, "median": None, "std": None,
                "q1": None, "q3": None, "min": None, "max": None,
            }
        return {
            "n": int(len(arr)),
            "mean": num(np.mean(arr)),
            "median": num(np.median(arr)),
            "std": num(np.std(arr, ddof=1)) if len(arr) > 1 else None,
            "q1": num(np.percentile(arr, 25)),
            "q3": num(np.percentile(arr, 75)),
            "min": num(np.min(arr)),
            "max": num(np.max(arr)),
        }

    def make_histogram(a, b, nbins=12):
        combined = np.concatenate([x for x in (a, b) if len(x)]) if (len(a) or len(b)) else np.array([])
        if len(combined) == 0:
            return {"bin_centers": [], "pre": [], "post": []}
        lo, hi = float(np.min(combined)), float(np.max(combined))
        if hi <= lo:
            hi = lo + 1.0
        edges = np.linspace(lo, hi, nbins + 1)
        pre_counts = np.histogram(a, bins=edges)[0].tolist() if len(a) else [0] * nbins
        post_counts = np.histogram(b, bins=edges)[0].tolist() if len(b) else [0] * nbins
        centers = (edges[:-1] + edges[1:]) / 2
        return {
            "bin_centers": [round(float(c), 1) for c in centers],
            "pre": [int(c) for c in pre_counts],
            "post": [int(c) for c in post_counts],
        }

    pm = purchases.copy()
    pm["month"] = pd.to_datetime(pm["invoiceDate"]).dt.strftime("%Y-%m")
    mt = pm.groupby("month")["invoiceToPaymentDays"].mean().sort_index()
    monthly_trend = [{"month": str(m), "mean_days": num(v)} for m, v in mt.items()]

    # ----- 11D enrichments: stage decomposition + per-quadrant breakdowns ---- #
    def _stage_means(df):
        def m(col):
            v = pd.to_numeric(df[col], errors="coerce").dropna()
            return num(v.mean()) if len(v) else None
        return {
            "pr_to_po": m("prToPoDays"),
            "po_to_delivery": m("poToDeliveryDays"),
            "delivery_to_invoice": m("deliveryToInvoiceDays"),
            "invoice_to_payment": m("invoiceToPaymentDays"),
        }

    pre_df = purchases[purchases["automationPeriod"] == "pre"]
    post_df = purchases[purchases["automationPeriod"] == "post"]
    stage_breakdown = {
        "overall": _stage_means(purchases),
        "pre": _stage_means(pre_df),
        "post": _stage_means(post_df),
    }

    # Period-accurate Kraljic quadrant per supplier (same helpers as 11C).
    quad_map = {}
    if suppliers is not None and metrics is not None and len(suppliers):
        risk_map, _c = compute_supply_risk(suppliers, metrics)
        spend_raw = purchases.groupby("supplierExternalId")["totalValueUsd"].sum()
        log_spend_map = {sid: float(np.log1p(v)) for sid, v in spend_raw.items()}
        krj_sids = [s for s in log_spend_map if s in risk_map]
        if krj_sids:
            quad_map, _sm, _rm = assign_kraljic_quadrants(
                {s: log_spend_map[s] for s in krj_sids},
                {s: risk_map[s] for s in krj_sids},
            )

    pq = purchases.copy()
    pq["quadrant"] = pq["supplierExternalId"].map(quad_map)

    cycle_by_quadrant = {}
    three_way_match_by_quadrant = {}
    for q in ["Strategic", "Leverage", "Bottleneck", "Routine"]:
        sub = pq[pq["quadrant"] == q]
        pre_v = pd.to_numeric(
            sub.loc[sub["automationPeriod"] == "pre", "invoiceToPaymentDays"],
            errors="coerce",
        ).dropna()
        post_v = pd.to_numeric(
            sub.loc[sub["automationPeriod"] == "post", "invoiceToPaymentDays"],
            errors="coerce",
        ).dropna()
        pre_mean = num(pre_v.mean()) if len(pre_v) else None
        post_mean = num(post_v.mean()) if len(post_v) else None
        delta = (
            num(pre_mean - post_mean)
            if (pre_mean is not None and post_mean is not None)
            else None
        )
        cycle_by_quadrant[q] = {
            "pre_mean": pre_mean,
            "post_mean": post_mean,
            "delta": delta,
            "n_suppliers": int(sub["supplierExternalId"].nunique()),
        }

        n_pos = int(len(sub))
        fail_rate = (
            num((~sub["threeWayMatchPass"].astype(bool)).sum() / n_pos * 100)
            if n_pos
            else 0
        )
        three_way_match_by_quadrant[q] = {"fail_rate_pct": fail_rate, "n_pos": n_pos}

    base = {
        "test": "Mann-Whitney U",
        "alpha": 0.05,
        "pre_stats": stats_block(pre),
        "post_stats": stats_block(post),
        "histogram": make_histogram(pre, post),
        "monthly_trend": monthly_trend,
        "stage_breakdown": stage_breakdown,
        "cycle_by_quadrant": cycle_by_quadrant,
        "three_way_match_by_quadrant": three_way_match_by_quadrant,
    }

    # Both pre and post groups are required (e.g. a single-year range has only one).
    if len(pre) < 2 or len(post) < 2:
        base.update(
            {
                "statistic": None,
                "p_value": None,
                "effect_size": None,
                "ci_low": None,
                "ci_high": None,
                "significant": False,
                "insufficient_data": True,
            }
        )
        return base

    u_stat, p_value = mannwhitneyu(pre, post, alternative="greater")
    r_rb = 1 - (2 * u_stat) / (len(pre) * len(post))

    rng = np.random.default_rng(42)
    diffs = np.empty(1000)
    for i in range(1000):
        diffs[i] = np.mean(rng.choice(pre, size=len(pre), replace=True)) - np.mean(
            rng.choice(post, size=len(post), replace=True)
        )

    base.update(
        {
            "statistic": float(u_stat),
            "p_value": float(p_value),
            "effect_size": num(r_rb),
            "ci_low": num(np.percentile(diffs, 2.5)),
            "ci_high": num(np.percentile(diffs, 97.5)),
            "significant": bool(p_value < 0.05),
            "insufficient_data": False,
        }
    )
    return base


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
    risk_map, _comp = compute_supply_risk(suppliers, metrics)
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

    def tier_of(s):
        return str(sup_meta.loc[s, "tier"]) if s in sup_meta.index else "Unknown"

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
        "tier_mismatch_by_zone": {},
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
            "tier": tier_of(s),
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

    # Tier mismatches by zone: the declared tier that's "wrong" for each zone.
    def _is_mismatch(zone, tier):
        if zone == "Stars":
            return tier != "Strategic"  # high-spend high-perf under-classified
        if zone == "Critical Issues":
            return tier == "Strategic"  # labeled Strategic but underperforming
        if zone == "Hidden Gems":
            return tier == "Approved"  # small-but-excellent, promotion candidate
        if zone == "Long Tail":
            return tier == "Strategic"  # labeled Strategic but low/low
        return False

    tier_mismatch_by_zone = {}
    for z in ["Stars", "Critical Issues", "Hidden Gems", "Long Tail"]:
        members = [r for r in rows if r["zone"] == z]
        tier_mismatch_by_zone[z] = {
            "mismatched": sum(1 for r in members if _is_mismatch(z, r["tier"])),
            "total": len(members),
        }

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
        "tier_mismatch_by_zone": tier_mismatch_by_zone,
    }


ANALYSES = [
    ("spend_overview", spend_overview),
    ("abc", abc_analysis),
    ("hypothesis", hypothesis_test),
    ("performance_spend", performance_spend_analysis),
]


# --------------------------------------------------------------------------- #
# d) Kraljic matrix  (supply-risk score + quadrant assignment)
# --------------------------------------------------------------------------- #
# ASEAN ISO alpha-2 codes (data stores codes, not names).
ASEAN_CODES = {"SG", "MY", "TH", "VN", "PH", "BN", "MM", "LA", "KH"}
ASEAN_NAMES = {
    "Singapore", "Malaysia", "Thailand", "Vietnam", "Philippines",
    "Brunei", "Myanmar", "Laos", "Cambodia",
}


def _country_distance_points(country):
    c = str(country).strip()
    if c in ("ID", "Indonesia"):
        return 0.0
    if c in ASEAN_CODES or c in ASEAN_NAMES:
        return 10.0
    return 20.0


def compute_supply_risk(suppliers, metrics):
    """Return (risk_map, competition_map) over the given supplier set.

    risk = single_source(0/30) + category_competition(0-30)
         + country_distance(0/10/20) + switching_cost(0-20), clipped to [0,100].
    """
    sup = suppliers.rename(columns={"externalId": "supplierExternalId"}).drop_duplicates(
        "supplierExternalId"
    )
    df = sup[["supplierExternalId", "category", "country"]].copy()

    # category competition: OTHER suppliers in the same category (this supplier set)
    cat_size = df.groupby("category")["supplierExternalId"].transform("size")
    df["other_in_category"] = (cat_size - 1).astype(int)

    m = (
        metrics[["supplierExternalId", "singleSourceRisk", "avgLeadTimeDays"]]
        .drop_duplicates("supplierExternalId")
        if len(metrics)
        else pd.DataFrame(
            columns=["supplierExternalId", "singleSourceRisk", "avgLeadTimeDays"]
        )
    )
    df = df.merge(m, on="supplierExternalId", how="left")

    # 1. single source (0 or 30)
    c_single = np.where(df["singleSourceRisk"].fillna(0).astype(float) >= 1, 30.0, 0.0)
    # 2. category competition (0-30): (5 - other) * 7.5, clipped
    c_category = ((5 - df["other_in_category"]) * 7.5).clip(0, 30).astype(float)
    # 3. country distance (0/10/20)
    c_country = df["country"].apply(_country_distance_points).astype(float)
    # 4. switching cost (0-20): min-max normalized lead time
    lead = df["avgLeadTimeDays"].astype(float)
    lead = lead.fillna(lead.mean())
    lmin, lmax = float(lead.min()), float(lead.max())
    lead_norm = (lead - lmin) / (lmax - lmin) if lmax > lmin else lead * 0.0
    c_switch = lead_norm * 20.0

    risk = np.clip(c_single + c_category.values + c_country.values + c_switch.values, 0, 100)

    risk_map = {sid: float(r) for sid, r in zip(df["supplierExternalId"], risk)}
    competition_map = {
        sid: int(o) for sid, o in zip(df["supplierExternalId"], df["other_in_category"])
    }
    return risk_map, competition_map


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

    risk_map, comp_map = compute_supply_risk(suppliers, metrics)

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

    def tier_of(s):
        return str(sup_meta.loc[s, "tier"]) if s in sup_meta.index else "Unknown"

    def name_of(s):
        return str(sup_meta.loc[s, "supplierName"]) if s in sup_meta.index else s

    def perf_of(s):
        if len(comp_score) and s in comp_score.index:
            v = comp_score.loc[s, "compositeScore"]
            return float(v) if pd.notna(v) else None
        return None

    quadrant_assignments = [
        {
            "supplier_id": s,
            "supplier_name": name_of(s),
            "tier": tier_of(s),
            "log_spend": num(spend_map[s]),
            "supply_risk_score": num(risk_map[s]),
            "quadrant": quad_map[s],
        }
        for s in sids
    ]

    grand_total = sum(total_spend_map[s] for s in sids) or 1.0
    quadrant_profiles = []
    quadrant_vs_tier = {}
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
        tier_counts = {}
        for s in members:
            t = tier_of(s)
            tier_counts[t] = tier_counts.get(t, 0) + 1
        quadrant_vs_tier[q] = tier_counts

    result = {
        "quadrant_assignments": quadrant_assignments,
        "quadrant_profiles": quadrant_profiles,
        "axis_thresholds": {"spend_median": num(spend_med), "risk_median": num(risk_med)},
        "quadrant_vs_tier": quadrant_vs_tier,
    }
    return result, risk_map, comp_map, quad_map


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

        all_types = [n for n, _ in ANALYSES] + ["kraljic"]

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
