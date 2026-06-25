"""Deterministic supplier-scorecard transformer (two-file, schema-clean).

This script is the sole source of truth for all derived supplier scores. It
reads the RAW workbook (``procurement_data_raw.xlsx``) — operational
measurements only, with **no** derived score columns — computes the full
scorecard, and writes the ENRICHED workbook (``procurement_data.xlsx``) that the
import route reads. The two files are committed separately:

    procurement_data_raw.xlsx   (input)  — raw operational inputs, source of truth
    procurement_data.xlsx       (output) — raw inputs + computed scores, imported

Pipeline (fully deterministic — no rng):
  1. Tier rename (Strategic->Core, Preferred->Established, Approved->Standard);
     idempotent on already-renamed input.
  2. Five sub-scores (quality/delivery/service/process) from raw inputs with
     FIXED industry bounds.
  3. risk_score: deterministic 100 - weighted(country, complaints, single-source),
     higher = safer.
  4. composite_score (weights 0.25/0.25/0.15/0.20/0.15).
  5. Drop the obsolete Purchases.automation_period column if present.

Strict input validation (Decision C): the raw workbook must NOT contain any of
the derived score columns. If found, the run aborts with a clear message.

The old-vs-new diff (scripts/score_rebuild_diff.json) compares the new output
against the PREVIOUS enriched workbook if one exists; on a first run there is no
baseline and the diff is skipped.

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

TIER_MAP = {"Strategic": "Core", "Preferred": "Established", "Approved": "Standard"}

# The derived columns this transformer COMPUTES — they must NOT appear in the
# raw input workbook (Decision C). Kept in sync with SCORE_COLS below.
DERIVED_COLS = [
    "quality_score", "delivery_score", "service_score", "process_score",
    "risk_score", "composite_score",
]

# Composite weights (Batch 3a spec) and new tier thresholds.
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
    """Per-supplier old-vs-new score diff for human review (Decision F)."""
    oi, ni = old.set_index("supplier_id"), new.set_index("supplier_id")
    per = []
    for sid in ni.index:
        row = {"supplier_id": sid, "supplier_name": ni.loc[sid, "supplier_name"]}
        for c in SCORE_COLS:
            ov, nv = float(oi.loc[sid, c]), float(ni.loc[sid, c])
            row[c] = {"old": ov, "new": nv, "delta": round(nv - ov, 2)}
        per.append(row)
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
    # On a first run (no prior output / missing columns) the diff is skipped.
    need = ["supplier_id", "supplier_name", "tier", *SCORE_COLS]
    old_scores = None
    if os.path.exists(XLSX):
        try:
            prev = pd.read_excel(XLSX, sheet_name="SupplierMetrics")
            if all(c in prev.columns for c in need):
                old_scores = prev[need].copy()
        except Exception:
            old_scores = None

    # --- 1. Tier rename (idempotent on already-renamed input) ------------- #
    suppliers["tier"] = suppliers["tier"].map(lambda t: TIER_MAP.get(t, t))
    metrics["tier"] = metrics["tier"].map(lambda t: TIER_MAP.get(t, t))

    # --- 2. Sub-scores from raw operational inputs, FIXED bounds (Decision B) #
    # Bounds rationale (see methodology doc):
    #   defect_rate 0-10% (Toyota near-zero; >1% investigate; 10% unacceptable)
    #   complaint_count 0-10 (>10/yr = severe relationship issue)
    #   lead_time 0-60 days (60-day lead = poor); response_time 0-14 days (2-wk SLA)
    #   OTD / rfx_rate / 3-way-match are percentages (0-100) by definition.
    metrics["quality_score"] = np.round([
        (norm_low(r["defect_rate_pct"], 0, 10) + norm_low(r["complaint_count_annual"], 0, 10)) / 2
        for _, r in metrics.iterrows()
    ], 2)
    metrics["delivery_score"] = np.round([
        (norm_high(r["on_time_delivery_pct"], 0, 100) + norm_low(r["avg_lead_time_days"], 0, 60)) / 2
        for _, r in metrics.iterrows()
    ], 2)
    metrics["service_score"] = np.round([
        (norm_low(r["avg_response_time_days"], 0, 14) + norm_high(r["rfx_response_rate_pct"], 0, 100)) / 2
        for _, r in metrics.iterrows()
    ], 2)
    metrics["process_score"] = np.round([
        norm_high(r["three_way_match_pct"], 0, 100) for _, r in metrics.iterrows()
    ], 2)

    # --- 3. risk_score: deterministic composite, higher = safer (Decision C) #
    # single_source_risk is read as an existing 0/1 data field (NOT regenerated).
    new_risk = []
    for _, r in metrics.iterrows():
        country = country_distance_score(r.get("country", ""))
        complaint = min(float(r["complaint_count_annual"]) * 10.0, 100.0)
        concentration = float(r["single_source_risk"]) * 100.0
        risk = 100.0 - (0.4 * country + 0.3 * complaint + 0.3 * concentration)
        new_risk.append(float(np.clip(risk, 0, 100)))
    metrics["risk_score"] = np.round(new_risk, 2)

    # --- 4. composite_score (existing weights, now over derived sub-scores) - #
    metrics["composite_score"] = np.round(
        sum(metrics[col] * w for col, w in WEIGHTS.items()), 2
    )

    # (tier_mismatch + calculated_tier removed — unreliable diagnostic, dropped.)

    # --- 5. (Batch 5) Drop Purchases.automation_period -------------------- #
    if "automation_period" in purchases.columns:
        purchases = purchases.drop(columns=["automation_period"])
        print("  dropped Purchases.automation_period")
    else:
        print("  Purchases.automation_period already absent (no-op)")

    print("AFTER:")
    print("  tier:", suppliers["tier"].value_counts().to_dict())
    summarize("risk_score", metrics["risk_score"])
    print(
        "  single_source_risk flagged:",
        int(metrics["single_source_risk"].sum()),
        f"({metrics['single_source_risk'].mean() * 100:.0f}%)",
    )
    summarize("composite_score", metrics["composite_score"])

    # --- Rebuild diff + review gate (Decision F) -------------------------- #
    if old_scores is not None:
        diff = build_diff(old_scores, metrics)
        print_diff_summary(diff)
        diff_path = os.path.join(HERE, "score_rebuild_diff.json")
        with open(diff_path, "w") as f:
            json.dump(diff, f, indent=2)
        print(f"\nFull diff saved to {diff_path} (new output vs previous enriched output)")
    else:
        print("\nNo previous enriched output to diff against — fresh computation.")
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
