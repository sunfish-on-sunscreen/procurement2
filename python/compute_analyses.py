#!/usr/bin/env python3
"""Compute the 4 fixed procurement analyses for a reporting period and upsert
them into the AnalysisResult table.

Usage:
    python compute_analyses.py --period-id <periodId>

Reads DATABASE_URL from the project-root .env. Methodology is FIXED
(ABC 80/95, KMeans k=4 random_state=42, Mann-Whitney U) per project scope.
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


# --------------------------------------------------------------------------- #
# Helpers
# --------------------------------------------------------------------------- #
def load_env():
    here = os.path.dirname(os.path.abspath(__file__))
    # utf-8-sig tolerates a UTF-8 BOM (PowerShell writes one), which would
    # otherwise corrupt the first key name (﻿DATABASE_URL).
    load_dotenv(os.path.join(here, "..", ".env"), encoding="utf-8-sig")


def get_dsn():
    url = os.environ.get("DATABASE_URL")
    if not url:
        raise RuntimeError("DATABASE_URL is not set in the environment / .env")
    # libpq (psycopg2) does not understand Prisma's "?schema=public" param.
    return url.split("?")[0]


def num(value, ndigits=4):
    """Convert a possibly-numpy value to a JSON-safe native number (or None)."""
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


def _read_table(conn, table, period_id):
    """Read a period's rows into a DataFrame via a cursor (works on any pandas
    version; pd.read_sql no longer reliably accepts raw DBAPI connections)."""
    with conn.cursor() as cur:
        cur.execute(f'SELECT * FROM "{table}" WHERE "periodId" = %s', (period_id,))
        columns = [desc[0] for desc in cur.description]
        rows = cur.fetchall()
    df = pd.DataFrame(rows, columns=columns)
    return df.infer_objects()


def load_frames(conn, period_id):
    return (
        _read_table(conn, "Supplier", period_id),
        _read_table(conn, "Purchase", period_id),
        _read_table(conn, "SupplierMetric", period_id),
    )


# --------------------------------------------------------------------------- #
# Analysis a) Spend overview
# --------------------------------------------------------------------------- #
def spend_overview(purchases, **_):
    total_spend = purchases["totalValueUsd"].sum()
    cat = (
        purchases.groupby("category")["totalValueUsd"].sum().sort_values(ascending=False)
    )
    by_category = [{"category": str(c), "total": num(t)} for c, t in cat.head(8).items()]
    if len(cat) > 8:
        by_category.append({"category": "Other", "total": num(cat.iloc[8:].sum())})

    sup = (
        purchases.groupby(["supplierExternalId", "supplierName"])["totalValueUsd"]
        .sum()
        .sort_values(ascending=False)
        .head(10)
    )
    top_suppliers = [
        {"supplier_name": str(name), "total": num(t)} for (_sid, name), t in sup.items()
    ]

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
# Analysis b) ABC / Pareto  (fixed thresholds 0.80 / 0.95)
# --------------------------------------------------------------------------- #
def abc_analysis(purchases, suppliers, **_):
    spend = (
        purchases.groupby(["supplierExternalId", "supplierName"], as_index=False)[
            "totalValueUsd"
        ]
        .sum()
        .rename(columns={"totalValueUsd": "total"})
        .sort_values("total", ascending=False)
        .reset_index(drop=True)
    )
    spend["rank"] = spend.index + 1
    grand = spend["total"].sum()
    spend["pct"] = spend["total"] / grand if grand else 0.0
    spend["cumulative_pct"] = spend["pct"].cumsum()

    def classify(cum):
        if cum <= 0.80:
            return "A"
        if cum <= 0.95:
            return "B"
        return "C"

    spend["abc_class"] = spend["cumulative_pct"].apply(classify)
    tier_map = dict(zip(suppliers["externalId"], suppliers["tier"]))
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
        sub_total = sub["total"].sum()
        summary[cls] = {
            "n": int(len(sub)),
            "total_spend": num(sub_total),
            "pct_of_spend": num((sub_total / grand) if grand else 0.0, 6),
        }

    ct = pd.crosstab(spend["tier"], spend["abc_class"])
    crosstab = {
        str(t): {str(c): int(ct.loc[t, c]) for c in ct.columns} for t in ct.index
    }

    return {
        "thresholds": [0.80, 0.95],
        "classifications": classifications,
        "summary": summary,
        "crosstab": crosstab,
    }


# --------------------------------------------------------------------------- #
# Analysis c) Clustering  (fixed k=4, random_state=42)
# --------------------------------------------------------------------------- #
def clustering(metrics, **_):
    features = [
        "onTimeDeliveryPct",
        "defectRatePct",
        "rfxResponseRatePct",
        "avgLeadTimeDays",
        "threeWayMatchPct",
        "log_spend",
    ]
    df = metrics.copy()
    df["log_spend"] = np.log1p(df["totalSpendUsd"].astype(float))

    X = df[features].astype(float)
    X = X.fillna(X.mean())

    Xs = StandardScaler().fit_transform(X)
    km = KMeans(n_clusters=4, random_state=42, n_init=10)
    df["cluster"] = km.fit_predict(Xs)

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
# Analysis d) Hypothesis test  (Mann-Whitney U on invoice_to_payment_days)
# --------------------------------------------------------------------------- #
def hypothesis_test(purchases, **_):
    pre = (
        purchases.loc[purchases["automationPeriod"] == "pre", "invoiceToPaymentDays"]
        .astype(float)
        .dropna()
        .values
    )
    post = (
        purchases.loc[purchases["automationPeriod"] == "post", "invoiceToPaymentDays"]
        .astype(float)
        .dropna()
        .values
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

    # One-tailed: H1 = pre payment days stochastically greater than post
    # (automation reduced invoice-to-payment time).
    u_stat, p_value = mannwhitneyu(pre, post, alternative="greater")
    r_rb = 1 - (2 * u_stat) / (len(pre) * len(post)) if len(pre) and len(post) else None

    # Bootstrap 95% CI on the mean difference (pre - post), 1000 iterations.
    rng = np.random.default_rng(42)
    diffs = np.empty(1000)
    for i in range(1000):
        ba = rng.choice(pre, size=len(pre), replace=True)
        bb = rng.choice(post, size=len(post), replace=True)
        diffs[i] = np.mean(ba) - np.mean(bb)
    ci_low = num(np.percentile(diffs, 2.5))
    ci_high = num(np.percentile(diffs, 97.5))

    pm = purchases.copy()
    pm["month"] = pd.to_datetime(pm["invoiceDate"]).dt.strftime("%Y-%m")
    mt = pm.groupby("month")["invoiceToPaymentDays"].mean().sort_index()
    monthly_trend = [{"month": str(m), "mean_days": num(v)} for m, v in mt.items()]

    return {
        "test": "Mann-Whitney U",
        "alpha": 0.05,
        "pre_stats": stats_block(pre),
        "post_stats": stats_block(post),
        "statistic": float(u_stat),
        "p_value": float(p_value),
        "effect_size": num(r_rb),
        "ci_low": ci_low,
        "ci_high": ci_high,
        "significant": bool(p_value < 0.05),
        "monthly_trend": monthly_trend,
    }


# --------------------------------------------------------------------------- #
# Upsert
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


# --------------------------------------------------------------------------- #
# Main
# --------------------------------------------------------------------------- #
def main():
    parser = argparse.ArgumentParser(description="Compute procurement analyses for a period.")
    parser.add_argument("--period-id", required=True, help="ReportingPeriod id")
    args = parser.parse_args()
    period_id = args.period_id

    load_env()
    dsn = get_dsn()

    conn = None
    succeeded = 0
    try:
        conn = psycopg2.connect(dsn)
        suppliers, purchases, metrics = load_frames(conn, period_id)
        print(
            f"Loaded {len(suppliers)} suppliers, {len(purchases)} purchases, "
            f"{len(metrics)} metrics for period {period_id}"
        )
        if len(purchases) == 0:
            print("ERROR: no purchase data for this period; nothing to compute.", file=sys.stderr)
            sys.exit(1)

        analyses = [
            ("spend_overview", spend_overview),
            ("abc", abc_analysis),
            ("clustering", clustering),
            ("hypothesis", hypothesis_test),
        ]
        for name, fn in analyses:
            try:
                print(f"Computing {name}...")
                result = fn(purchases=purchases, suppliers=suppliers, metrics=metrics)
                upsert(conn, period_id, name, result)
                succeeded += 1
            except Exception as exc:  # noqa: BLE001 - continue with remaining analyses
                print(f"FAILED {name}: {exc}", file=sys.stderr)
                traceback.print_exc(file=sys.stderr)

        print(f"Done. {succeeded} analyses computed for period {period_id}.")
    except SystemExit:
        raise
    except Exception as exc:  # noqa: BLE001
        print(f"FATAL: {exc}", file=sys.stderr)
        traceback.print_exc(file=sys.stderr)
        sys.exit(1)
    finally:
        if conn is not None:
            conn.close()

    sys.exit(0 if succeeded == 4 else 1)


if __name__ == "__main__":
    main()
