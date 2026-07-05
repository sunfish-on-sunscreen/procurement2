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

import numpy as np  # noqa: F401  retained import; harmless if unused post-extraction
import pandas as pd

HERE = os.path.dirname(os.path.abspath(__file__))
RAW_XLSX = os.path.join(HERE, "..", "data", "raw", "procurement_data_raw.xlsx")  # input
XLSX = os.path.join(HERE, "..", "data", "raw", "procurement_data.xlsx")  # output (imported)

# Score formulas + column groups live in ONE place now: python/scores.py (Stage 1
# extraction). The offline transformer and the future server-side import path both
# import from there, so the derived scores can never drift between the two paths.
# (Names are re-exported here so anything importing them from transform_dataset
# keeps working — a behaviour-preserving move, not a formula change.)
sys.path.insert(0, os.path.join(HERE, "..", "python"))
from scores import (  # noqa: E402
    WEIGHTS,  # noqa: F401  re-export
    SCORE_COLS,
    IDENTITY_COLS,
    SOFT_COLS,
    country_distance_score,  # noqa: F401  re-export
    concentration_0_100,  # noqa: F401  re-export
    norm_high,  # noqa: F401  re-export
    norm_low,  # noqa: F401  re-export
    build_period_metrics,
    compute_scores,
    roster_category_counts,
)

# The derived columns this transformer COMPUTES — they must NOT appear in the raw
# input workbook (Decision C). Identical to scores.SCORE_COLS by construction.
DERIVED_COLS = list(SCORE_COLS)
# WEIGHTS, SCORE_COLS, IDENTITY_COLS, SOFT_COLS, the normalizers,
# country_distance_score, concentration_0_100 and the D9 _CONC_POINTS mapping now
# live in python/scores.py (imported above) — one source of truth for the formulas.

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


# build_period_metrics and compute_scores now live in python/scores.py (imported
# above). Kept out of this file so the offline transformer and the server-side
# import path share ONE implementation of the derived-score formulas.


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
    roster_cat_counts = roster_category_counts(suppliers)
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
