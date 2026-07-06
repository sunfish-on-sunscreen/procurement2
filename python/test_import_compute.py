"""Tests for python/import_compute.py — the compute-from-raw path (Stage 2).

Locks the reconciliation between the from-raw compute (payment-year bucketed) and
the captured DB baseline (invoice-year bucketed) as a REGRESSION, so the
"pure-rebucketing, zero-formula-drift" property can't silently break in Stage 3.

⚠️ Reconciliation property (corrected from the initial Stage-0 guess):
  The initial guess was "every per-period delta is accompanied by a num_pos
  change." That is FALSE — 4 supplier-periods (e.g. S002@2025, S020@2025) are
  net-zero PO swaps: one PO leaves the period and a different one enters under the
  invoice->payment rebucketing, so delivery/composite change while num_pos stays
  put. The RIGOROUS, provably-true invariant used here instead:
    (1) period-INDEPENDENT scores (quality/service/risk incl. D9) match the
        baseline EXACTLY for every common supplier  -> formula exactness;
    (2) per-supplier TOTAL num_pos and TOTAL spend (summed over a supplier's
        periods) are INVARIANT vs baseline  -> same POs, only re-bucketed (no PO
        added/dropped/duplicated); and
    (3) every per-period score delta is confined to the period-DEPENDENT scores
        (delivery/process/composite) — never quality/service/risk.
  (1)+(2)+(3) together prove the ONLY cause of differences is the documented
  invoice->payment rebucketing.

Run:   python python/test_import_compute.py
       pytest python/test_import_compute.py
Baseline CSV: $BASELINE_CSV or the default scratch path (skips if absent).
"""

import os
import sys

import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, HERE)
import scores            # noqa: E402
import import_compute    # noqa: E402
from test_scores import _load_baseline, RAW_XLSX, PERIOD_INDEP  # noqa: E402


def _recompute():
    sh = pd.read_excel(RAW_XLSX, sheet_name=None)
    rec = import_compute.compute_supplier_metrics(sh["Suppliers"], sh["SupplierMetrics"], sh["Purchases"])
    rec["period"] = rec["period"].astype(int)
    return rec


def test_shape_and_columns():
    rec = _recompute()
    assert list(rec.columns) == import_compute.METRIC_COLS
    # payment-year bucketed row set (Stage-0 documented drift 54/50/16 -> 53/50/20).
    dist = rec.groupby("period")["supplier_id"].nunique().to_dict()
    assert dist == {2024: 53, 2025: 50, 2026: 20}, dist
    assert len(rec) == 123


def test_wrapper_matches_engine():
    # The wrapper must be a pure pass-through over scores.py (no altered values).
    sh = pd.read_excel(RAW_XLSX, sheet_name=None)
    direct = scores.compute_scores(
        scores.build_period_metrics(sh["SupplierMetrics"], sh["Purchases"]),
        scores.roster_category_counts(sh["Suppliers"]),
    )
    wrap = import_compute.compute_supplier_metrics(sh["Suppliers"], sh["SupplierMetrics"], sh["Purchases"])
    for c in scores.SCORE_COLS:
        a = direct.sort_values(["supplier_id", "period"])[c].round(2).reset_index(drop=True)
        b = wrap.sort_values(["supplier_id", "period"])[c].round(2).reset_index(drop=True)
        assert a.equals(b), c


def reconcile(verbose=False):
    """Returns a report dict, or {'skipped': True} if the baseline CSV is absent."""
    base = _load_baseline()
    if base is None:
        return {"skipped": True}
    rec = _recompute()

    # (1) formula exactness: period-independent scores per supplier.
    bi = base.drop_duplicates("supplier_id").set_index("supplier_id")
    ri = rec.drop_duplicates("supplier_id").set_index("supplier_id")
    common = sorted(set(bi.index) & set(ri.index))
    indep_mm = [
        (s, c) for s in common for c in PERIOD_INDEP
        if round(float(bi.loc[s, c]), 2) != round(float(ri.loc[s, c]), 2)
    ]

    # (2) per-supplier total invariant.
    bt = base.groupby("supplier_id").agg(npos=("num_pos", "sum"), spend=("total_spend_usd", "sum"))
    rt = rec.groupby("supplier_id").agg(npos=("num_pos", "sum"), spend=("total_spend_usd", "sum"))
    tot = bt.join(rt, lsuffix="_b", rsuffix="_r", how="outer").fillna(0)
    npos_bad = int((tot.npos_b != tot.npos_r).sum())
    spend_bad = int(((tot.spend_b - tot.spend_r).abs() > 0.01).sum())

    # (3) confinement: no per-period delta touches a period-independent score.
    merged = base.merge(rec, on=["supplier_id", "period"], how="outer", suffixes=("_b", "_r"), indicator=True)
    both = merged[merged._merge == "both"]
    diffs, unexplained, netzero = [], [], []
    for _, r in both.iterrows():
        d = [c for c in scores.SCORE_COLS if round(float(r[f"{c}_b"]), 2) != round(float(r[f"{c}_r"]), 2)]
        if not d:
            continue
        diffs.append((r.supplier_id, int(r.period), d))
        if any(c in PERIOD_INDEP for c in d):
            unexplained.append((r.supplier_id, int(r.period), d))
        if int(r.num_pos_b) == int(r.num_pos_r):
            netzero.append((r.supplier_id, int(r.period)))

    rep = {
        "skipped": False, "common": len(common),
        "indep_mismatch": len(indep_mm), "npos_bad": npos_bad, "spend_bad": spend_bad,
        "both": len(both), "diffs": len(diffs), "exact": len(both) - len(diffs),
        "unexplained": len(unexplained), "netzero": [f"{s}@{p}" for s, p in netzero],
        "only_base": int((merged._merge == "left_only").sum()),
        "only_rec": int((merged._merge == "right_only").sum()),
    }
    if verbose:
        for k, v in rep.items():
            print(f"  {k}: {v}")
    return rep


def test_reconciliation_regression():
    rep = reconcile()
    if rep.get("skipped"):
        return
    assert rep["indep_mismatch"] == 0, "period-independent scores drifted (FORMULA BUG)"
    assert rep["npos_bad"] == 0, "per-supplier total num_pos changed (a PO was added/dropped, not re-bucketed)"
    assert rep["spend_bad"] == 0, "per-supplier total spend changed (not pure rebucketing)"
    assert rep["unexplained"] == 0, "a per-period delta touched quality/service/risk (not rebucketing)"


if __name__ == "__main__":
    test_shape_and_columns(); print("[ok] test_shape_and_columns")
    test_wrapper_matches_engine(); print("[ok] test_wrapper_matches_engine")
    rep = reconcile(verbose=True)
    if not rep.get("skipped"):
        test_reconciliation_regression()
        print("[ok] test_reconciliation_regression -> pure rebucketing, zero formula drift")
    else:
        print("[skip] reconciliation (baseline CSV absent)")
