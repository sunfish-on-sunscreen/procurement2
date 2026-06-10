#!/usr/bin/env python3
"""Compute the 4 fixed procurement analyses over a DATE RANGE.

Two modes:
  Mode A (cache):   --period-id <id>
      Looks up the period's start/end dates, computes, and UPSERTs each analysis
      into AnalysisResult (one row per analysisType per period).
  Mode B (on-the-fly):  --start-date YYYY-MM-DD --end-date YYYY-MM-DD
      Computes over the date span and prints a single JSON object
      {spend_overview, abc, clustering, hypothesis} to STDOUT. No DB writes.

Data is filtered by Purchase.prDate (periodId on rows is decorative). Suppliers
and metrics are derived from the suppliers that appear in the filtered purchases.
Progress logs go to STDERR so Mode B's stdout stays pure JSON.

Methodology is FIXED (ABC 80/95, KMeans k=4 rs=42, Mann-Whitney U) per scope.
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

from sklearn.preprocessing import StandardScaler
from sklearn.cluster import KMeans
from sklearn.decomposition import PCA
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

    return {
        "thresholds": [0.80, 0.95],
        "classifications": classifications,
        "summary": summary,
        "crosstab": crosstab,
    }


# --------------------------------------------------------------------------- #
# c) Clustering  (fixed k=4, rs=42) — HYBRID features
#    Behavioral features recomputed from filtered purchases; the 2 synthetic
#    quality features (defect_rate, rfx_response) come from SupplierMetric.
# --------------------------------------------------------------------------- #
def clustering(purchases, suppliers, metrics):
    features = [
        "onTimeDeliveryPct",
        "defectRatePct",
        "rfxResponseRatePct",
        "avgLeadTimeDays",
        "threeWayMatchPct",
        "log_spend",
    ]

    g = purchases.groupby("supplierExternalId")
    feat = pd.DataFrame(
        {
            "onTimeDeliveryPct": g["onTimeDelivery"].mean() * 100.0,
            "threeWayMatchPct": g["threeWayMatchPass"].mean() * 100.0,
            "avgLeadTimeDays": g["poToDeliveryDays"].mean(),
            "total_spend": g["totalValueUsd"].sum(),
        }
    ).reset_index()
    feat["log_spend"] = np.log1p(feat["total_spend"].astype(float))

    m = (
        metrics[["supplierExternalId", "defectRatePct", "rfxResponseRatePct"]]
        .drop_duplicates("supplierExternalId")
        if len(metrics)
        else pd.DataFrame(columns=["supplierExternalId", "defectRatePct", "rfxResponseRatePct"])
    )
    s = (
        suppliers[["externalId", "supplierName", "tier"]]
        .drop_duplicates("externalId")
        .rename(columns={"externalId": "supplierExternalId"})
        if len(suppliers)
        else pd.DataFrame(columns=["supplierExternalId", "supplierName", "tier"])
    )

    df = feat.merge(m, on="supplierExternalId", how="left").merge(
        s, on="supplierExternalId", how="left"
    )
    df["supplierName"] = df["supplierName"].fillna(df["supplierExternalId"])
    df["tier"] = df["tier"].fillna("Unknown")

    if len(df) < 4:
        raise ValueError(f"clustering needs >= 4 suppliers, got {len(df)}")

    X = df[features].astype(float)
    X = X.fillna(X.mean())

    Xs = StandardScaler().fit_transform(X)
    df["cluster"] = KMeans(n_clusters=4, random_state=42, n_init=10).fit_predict(Xs)

    pca = PCA(n_components=2, random_state=42)
    coords = pca.fit_transform(Xs)
    df["pca1"] = coords[:, 0]
    df["pca2"] = coords[:, 1]

    cluster_assignments = [
        {
            "supplier_id": str(r["supplierExternalId"]),
            "supplier_name": str(r["supplierName"]),
            "tier": str(r["tier"]),
            "cluster": int(r["cluster"]),
            "pca1": num(r["pca1"]),
            "pca2": num(r["pca2"]),
        }
        for _, r in df.iterrows()
    ]

    cluster_profiles = []
    for c in range(4):
        sub = df[df["cluster"] == c]
        profile = {"cluster": int(c), "n_suppliers": int(len(sub))}
        for f in features:
            profile[f] = num(sub[f].mean())
        cluster_profiles.append(profile)

    ev = pca.explained_variance_ratio_
    ct = pd.crosstab(df["tier"], df["cluster"])
    tier_vs_cluster = {
        str(t): {str(int(c)): int(ct.loc[t, c]) for c in ct.columns} for t in ct.index
    }

    return {
        "k": 4,
        "features_used": features,
        "cluster_assignments": cluster_assignments,
        "cluster_profiles": cluster_profiles,
        "explained_variance": {"pc1": num(ev[0] * 100), "pc2": num(ev[1] * 100)},
        "tier_vs_cluster": tier_vs_cluster,
    }


# --------------------------------------------------------------------------- #
# d) Hypothesis test  (Mann-Whitney U on invoice_to_payment_days, pre vs post)
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
            return {"n": 0, "mean": None, "median": None, "std": None, "q1": None, "q3": None}
        return {
            "n": int(len(arr)),
            "mean": num(np.mean(arr)),
            "median": num(np.median(arr)),
            "std": num(np.std(arr, ddof=1)) if len(arr) > 1 else None,
            "q1": num(np.percentile(arr, 25)),
            "q3": num(np.percentile(arr, 75)),
        }

    pm = purchases.copy()
    pm["month"] = pd.to_datetime(pm["invoiceDate"]).dt.strftime("%Y-%m")
    mt = pm.groupby("month")["invoiceToPaymentDays"].mean().sort_index()
    monthly_trend = [{"month": str(m), "mean_days": num(v)} for m, v in mt.items()]

    base = {
        "test": "Mann-Whitney U",
        "alpha": 0.05,
        "pre_stats": stats_block(pre),
        "post_stats": stats_block(post),
        "monthly_trend": monthly_trend,
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


ANALYSES = [
    ("spend_overview", spend_overview),
    ("abc", abc_analysis),
    ("clustering", clustering),
    ("hypothesis", hypothesis_test),
]


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

        if mode == "A":
            succeeded = 0
            for name in [n for n, _ in ANALYSES]:
                if results.get(name) is not None:
                    upsert(conn, args.period_id, name, results[name])
                    succeeded += 1
            log(f"Done. {succeeded}/4 analyses upserted for period {args.period_id}.")
            sys.exit(0 if succeeded == 4 else 1)
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
