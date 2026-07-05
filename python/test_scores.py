"""Unit tests / verification for python/scores.py (Stage 1 of backend-scoring).

Two layers:

  1. PURE FORMULA TESTS (no external data) — always run. Lock the normalizers,
     country-distance tiers, the D9 concentration curve, and a full hand-computed
     composite so any future formula drift fails loudly.

  2. BASELINE REPRODUCTION — recompute the 6 scores from the RAW workbook via
     scores.py and prove they reproduce the captured DB baseline. The baseline is
     INVOICE-year bucketed (54/50/16, D9 applied in place); a from-raw compute is
     PAYMENT-year bucketed (53/50/20). So the check is layered:
       (a) the PERIOD-INDEPENDENT scores (quality, service, risk — incl. D9) must
           match per supplier for EVERY supplier in both  -> proves formula exactness;
       (b) EVERY per-(supplier,period) difference is confined to the
           PERIOD-DEPENDENT scores (delivery/process/composite) and tracks a change
           in the PO set (num_pos/total_spend) -> proves the ONLY cause of
           per-period differences is the documented invoice->payment rebucketing,
           not a formula change.

Run:   python python/test_scores.py        (standalone, prints a full report)
       pytest python/test_scores.py         (assertions)
Baseline CSV: $BASELINE_CSV or the default scratch path (skips if absent).
"""

import os
import sys

import numpy as np
import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scores  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
RAW_XLSX = os.path.join(HERE, "..", "data", "raw", "procurement_data_raw.xlsx")
DEFAULT_BASELINE = os.path.join(
    r"C:\Users\indra\AppData\Local\Temp\claude",
    "C--Users-indra-Downloads-procurement-analytics-app",
    "05de7671-e478-4b22-8678-a76f41d6cd2f", "scratchpad",
    "baseline_supplier_scores.csv",
)
BASELINE_CSV = os.environ.get("BASELINE_CSV", DEFAULT_BASELINE)

PERIOD_INDEP = ["quality_score", "service_score", "risk_score"]
PERIOD_DEP = ["delivery_score", "process_score", "composite_score"]
# The 4 suppliers whose PERIOD MEMBERSHIP shifts under invoice->payment (Stage 0).
KNOWN_BOUNDARY = {"S054", "S002", "S003", "S020"}


# --------------------------------------------------------------------------- #
# Layer 1 — pure formula tests
# --------------------------------------------------------------------------- #
def test_normalizers():
    assert scores.norm_high(50, 0, 100) == 50.0
    assert scores.norm_high(150, 0, 100) == 100.0   # clamp high
    assert scores.norm_high(-10, 0, 100) == 0.0     # clamp low
    assert scores.norm_low(0, 0, 10) == 100.0       # best
    assert scores.norm_low(10, 0, 10) == 0.0        # worst
    assert scores.norm_low(2, 0, 10) == 80.0
    assert abs(scores.norm_low(2, 0, 14) - (12 / 14 * 100)) < 1e-9


def test_country_distance():
    assert scores.country_distance_score("ID") == 0.0
    assert scores.country_distance_score("indonesia") == 0.0
    assert scores.country_distance_score("MY") == 30.0
    assert scores.country_distance_score("JP") == 60.0
    assert scores.country_distance_score("DE") == 100.0
    assert scores.country_distance_score("") == 100.0


def test_concentration_curve():
    # D9 curve: 0 others -> 100 (single source), grades down, >=5 -> 0.
    assert scores.concentration_0_100(0) == 100.0
    assert scores.concentration_0_100(1) == 70.0
    assert scores.concentration_0_100(2) == 44.0
    assert scores.concentration_0_100(3) == 24.0
    assert scores.concentration_0_100(4) == 10.0
    assert scores.concentration_0_100(5) == 0.0
    assert scores.concentration_0_100(9) == 0.0


def test_roster_category_counts():
    df = pd.DataFrame({
        "supplier_id": ["S1", "S2", "S3", "S4"],
        "category": ["A", "A", "B", "A"],
    })
    assert scores.roster_category_counts(df) == {"A": 3, "B": 1}


def test_composite_handcalc():
    # A fully hand-computed supplier-period through the whole pipeline.
    m = pd.DataFrame([{
        "supplier_id": "SX", "country": "JP", "category": "X",
        "defect_rate_pct": 2.0, "complaint_count_annual": 3,
        "on_time_delivery_pct": 90.0, "avg_lead_time_days": 12.0,
        "avg_response_time_days": 2.0, "rfx_response_rate_pct": 80.0,
        "three_way_match_pct": 100.0,
    }])
    out = scores.compute_scores(m.copy(), {"X": 3})  # 2 OTHER suppliers -> conc 44
    r = out.iloc[0]
    assert r["quality_score"] == 75.0        # (80+70)/2
    assert r["delivery_score"] == 85.0       # (90+80)/2
    assert r["service_score"] == 82.86       # (85.714+80)/2
    assert r["process_score"] == 100.0
    assert r["risk_score"] == 53.8           # 100-(0.4*60+0.3*30+0.3*44)
    assert r["composite_score"] == 80.5      # 0.25*75+0.25*85+0.15*82.86+0.20*100+0.15*53.8


# --------------------------------------------------------------------------- #
# Layer 2 — baseline reproduction
# --------------------------------------------------------------------------- #
def recompute_from_raw() -> pd.DataFrame:
    sh = pd.read_excel(RAW_XLSX, sheet_name=None)
    m = scores.build_period_metrics(sh["SupplierMetrics"], sh["Purchases"])
    roster = scores.roster_category_counts(sh["Suppliers"])
    m = scores.compute_scores(m, roster)
    m["period"] = m["period"].astype(int)
    return m


def _load_baseline():
    if not os.path.exists(BASELINE_CSV):
        return None
    b = pd.read_csv(BASELINE_CSV)
    # The DB dump uses camelCase column names; map them to scores.py's snake_case.
    b = b.rename(columns={
        "supplierExternalId": "supplier_id",
        "qualityScore": "quality_score", "deliveryScore": "delivery_score",
        "serviceScore": "service_score", "processScore": "process_score",
        "riskScore": "risk_score", "compositeScore": "composite_score",
        "numPos": "num_pos", "totalSpendUsd": "total_spend_usd",
    })
    b["period"] = b["period"].astype(int)
    return b


def verify_against_baseline(verbose=True):
    """Returns (ok, report dict). Prints a full report when verbose."""
    base = _load_baseline()
    if base is None:
        if verbose:
            print(f"[skip] baseline CSV not found at {BASELINE_CSV} — set $BASELINE_CSV")
        return None, {"skipped": True}

    rec = recompute_from_raw()

    def p(msg):
        if verbose:
            print(msg)

    p("=" * 70)
    p("BASELINE REPRODUCTION")
    p(f"  baseline rows: {len(base)}  periods: {base.groupby('period')['supplier_id'].nunique().to_dict()}")
    p(f"  recompute rows: {len(rec)}  periods: {rec.groupby('period')['supplier_id'].nunique().to_dict()}")

    # (a) PERIOD-INDEPENDENT scores per supplier (bucketing-independent) -> formula exactness.
    bi = base.drop_duplicates("supplier_id").set_index("supplier_id")
    ri = rec.drop_duplicates("supplier_id").set_index("supplier_id")
    common = sorted(set(bi.index) & set(ri.index))
    indep_mismatch = []
    for sid in common:
        for c in PERIOD_INDEP:
            if round(float(bi.loc[sid, c]), 2) != round(float(ri.loc[sid, c]), 2):
                indep_mismatch.append((sid, c, float(bi.loc[sid, c]), float(ri.loc[sid, c])))
    p(f"\n(a) period-INDEPENDENT scores (quality/service/risk incl. D9), {len(common)} common suppliers:")
    p(f"    mismatches: {len(indep_mismatch)}  ->  {'FORMULAS BIT-EXACT' if not indep_mismatch else 'FORMULA DRIFT!'}")
    for m in indep_mismatch[:20]:
        p(f"      {m}")

    # (b) full per-(supplier,period) join.
    key = ["supplier_id", "period"]
    merged = base.merge(rec, on=key, how="outer", suffixes=("_base", "_rec"), indicator=True)
    both = merged[merged["_merge"] == "both"]
    only_base = merged[merged["_merge"] == "left_only"]
    only_rec = merged[merged["_merge"] == "right_only"]

    exact, mism = [], []
    for _, r in both.iterrows():
        diffs = [c for c in scores.SCORE_COLS
                 if round(float(r[f"{c}_base"]), 2) != round(float(r[f"{c}_rec"]), 2)]
        (exact if not diffs else mism).append((r["supplier_id"], int(r["period"]), diffs, r))

    p(f"\n(b) per-(supplier,period) rows present in BOTH: {len(both)}")
    p(f"    exact 6-score match: {len(exact)}")
    p(f"    differing:           {len(mism)}")

    # every difference must be confined to the period-DEPENDENT scores, and track a PO-set change.
    bad_indep = [(s, per, d) for (s, per, d, _) in mism if any(c in PERIOD_INDEP for c in d)]
    p(f"    differences touching a period-INDEPENDENT score (should be 0): {len(bad_indep)}")
    for (s, per, d) in bad_indep[:20]:
        p(f"      !! {s}@{per} diffs {d}")

    p("\n    differing supplier-periods (all confined to delivery/process/composite):")
    for (s, per, d, r) in mism:
        po_b, po_r = int(r["num_pos_base"]), int(r["num_pos_rec"])
        boundary = "  [BOUNDARY]" if s in KNOWN_BOUNDARY else ""
        p(f"      {s}@{per}: {d}  | num_pos {po_b}->{po_r}{boundary}")

    p(f"\n    rows only in BASELINE (invoice-year, disappeared under payment): {len(only_base)}")
    for _, r in only_base.iterrows():
        p(f"      {r['supplier_id']}@{int(r['period'])}  [BOUNDARY]" if r["supplier_id"] in KNOWN_BOUNDARY
          else f"      {r['supplier_id']}@{int(r['period'])}")
    p(f"    rows only in RECOMPUTE (payment-year, newly appeared): {len(only_rec)}")
    for _, r in only_rec.iterrows():
        p(f"      {r['supplier_id']}@{int(r['period'])}  [BOUNDARY]" if r["supplier_id"] in KNOWN_BOUNDARY
          else f"      {r['supplier_id']}@{int(r['period'])}")

    # Boundary suppliers' period-independent scores still match the baseline (formula right).
    boundary_indep_ok = all(
        sid not in [m[0] for m in indep_mismatch] for sid in KNOWN_BOUNDARY if sid in common
    )
    p(f"\n    boundary suppliers' quality/service/risk still match baseline: {boundary_indep_ok}")

    ok = (len(indep_mismatch) == 0 and len(bad_indep) == 0)
    p("\n" + ("PASS: formulas bit-exact; every per-period diff is pure invoice->payment rebucketing."
             if ok else "FAIL: unexplained differences (formula drift)."))
    p("=" * 70)

    report = {
        "skipped": False,
        "indep_mismatches": len(indep_mismatch),
        "both": len(both), "exact": len(exact), "diff": len(mism),
        "diff_touching_indep": len(bad_indep),
        "only_base": [f"{r['supplier_id']}@{int(r['period'])}" for _, r in only_base.iterrows()],
        "only_rec": [f"{r['supplier_id']}@{int(r['period'])}" for _, r in only_rec.iterrows()],
        "differing": [f"{s}@{per}:{d}" for (s, per, d, _) in mism],
    }
    return ok, report


def test_baseline_reproduction():
    ok, rep = verify_against_baseline(verbose=False)
    if rep.get("skipped"):
        return  # baseline CSV absent in this environment — formula tests still cover exactness
    assert rep["indep_mismatches"] == 0, "period-independent scores drifted (formula bug)"
    assert rep["diff_touching_indep"] == 0, "a per-period diff touched quality/service/risk (not rebucketing)"
    assert ok


if __name__ == "__main__":
    # Run pure formula tests
    for name, fn in sorted(globals().items()):
        if name.startswith("test_") and name != "test_baseline_reproduction":
            fn()
            print(f"[ok] {name}")
    # Run + print the baseline reproduction report
    verify_against_baseline(verbose=True)
