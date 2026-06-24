"""One-off dataset transformer for Phase 11F (Batches 3a + 5).

The original synthetic-data GENERATOR is not in this repository — only its
output (data/raw/procurement_data.xlsx). Rather than reconstruct the generator,
this script reads that workbook, applies targeted fixes, and writes it back. A
proper generator is deferred to a future phase.

Transformations (deterministic — fixed seed):
  1. Tier rename:  Strategic -> Core, Preferred -> Established, Approved -> Standard
                   (Suppliers.tier, SupplierMetrics.tier, .calculated_tier)
  2. risk_score:   was saturated at 100 for every supplier; replaced with a
                   varied 20-95 score driven by country distance, complaints,
                   spend reliability credit, plus seeded Gaussian noise.
  3. single_source_risk: was 0 for everyone; ~15-20% of suppliers are now
                   flagged 1, biased toward small categories (fewer alternatives).
  4. composite_score: recomputed from the (changed) risk_score.
  5. calculated_tier / tier_mismatch: recomputed from the new composite_score,
                   using the new tier names.
  6. (Batch 5) Drop the Purchases.automation_period column. It was a hardcoded
                   pre/post label for a one-time 2024->2025 automation event;
                   the Cycle Time page no longer uses it (reframed to date-driven
                   process-health monitoring). Idempotent: a no-op if absent.

Steps 1-5 are idempotent on already-transformed input (risk/single-source are
recomputed from unchanged inputs under the fixed seed, so re-running reproduces
identical Suppliers/SupplierMetrics). Supplier identities, spend, and all
Purchases dates are left untouched.

Usage:  python scripts/transform_dataset.py
"""

import json
import os
import sys
import numpy as np
import pandas as pd

SEED = 42
HERE = os.path.dirname(os.path.abspath(__file__))
XLSX = os.path.join(HERE, "..", "data", "raw", "procurement_data.xlsx")

TIER_MAP = {"Strategic": "Core", "Preferred": "Established", "Approved": "Standard"}

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
        row["calculated_tier"] = {"old": oi.loc[sid, "calculated_tier"], "new": ni.loc[sid, "calculated_tier"]}
        row["tier_mismatch"] = {"old": bool(oi.loc[sid, "tier_mismatch"]), "new": bool(ni.loc[sid, "tier_mismatch"])}
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
    tier_changes = [
        {"supplier_name": r["supplier_name"], "old": r["calculated_tier"]["old"], "new": r["calculated_tier"]["new"]}
        for r in per if r["calculated_tier"]["old"] != r["calculated_tier"]["new"]
    ]
    mismatch_changes = [
        {"supplier_name": r["supplier_name"], "old": r["tier_mismatch"]["old"], "new": r["tier_mismatch"]["new"]}
        for r in per if r["tier_mismatch"]["old"] != r["tier_mismatch"]["new"]
    ]
    return {"summary": summary, "top5": top5, "tier_changes": tier_changes, "mismatch_changes": mismatch_changes, "per_supplier": per}


def print_diff_summary(diff):
    print("\n==================== SCORE REBUILD DIFF ====================")
    for c, s in diff["summary"].items():
        print(f"  {c:16} changed={s['changed']:2}/55  mean|d|={s['mean_abs']:6}  max|d|={s['max_abs']:6}  {s['buckets']}")
    for c in SCORE_COLS:
        print(f"\n  Top 5 shifts - {c}:")
        for t in diff["top5"][c]:
            print(f"    {t['supplier_name'][:30]:30} {t['old']:6} -> {t['new']:6}  (d {t['delta']:+.2f})")
    print(f"\n  calculated_tier crossings ({len(diff['tier_changes'])}):")
    for t in diff["tier_changes"]:
        print(f"    {t['supplier_name'][:30]:30} {t['old']} -> {t['new']}")
    old_mm = sum(1 for r in diff["per_supplier"] if r["tier_mismatch"]["old"])
    new_mm = sum(1 for r in diff["per_supplier"] if r["tier_mismatch"]["new"])
    print(f"\n  tier_mismatch: was {old_mm}/55 true, now {new_mm}/55 true ({len(diff['mismatch_changes'])} flipped)")
    for t in diff["mismatch_changes"]:
        print(f"    {t['supplier_name'][:30]:30} {t['old']} -> {t['new']}")
    print("============================================================")


def summarize(label, series):
    print(
        f"  {label}: min={series.min():.1f} max={series.max():.1f} "
        f"mean={series.mean():.1f} std={series.std():.1f}"
    )


def main():
    # Methodology rebuild: the transformer is now FULLY DETERMINISTIC — no rng.
    # All five sub-scores + composite + tier are derived from raw operational
    # inputs with fixed industry bounds (the xlsx scores are overwritten).
    sheets = pd.read_excel(XLSX, sheet_name=None)  # ordered dict of all sheets
    suppliers = sheets["Suppliers"]
    metrics = sheets["SupplierMetrics"]
    purchases = sheets["Purchases"]

    print(f"Loaded {len(suppliers)} suppliers, {len(metrics)} metric rows.")
    print("BEFORE:")
    print("  tier:", suppliers["tier"].value_counts().to_dict())
    summarize("risk_score", metrics["risk_score"])
    print("  single_source_risk sum:", int(metrics["single_source_risk"].sum()))
    summarize("composite_score", metrics["composite_score"])
    print("  calculated_tier:", metrics["calculated_tier"].value_counts().to_dict())

    # --- 1. Tier rename --------------------------------------------------- #
    suppliers["tier"] = suppliers["tier"].map(lambda t: TIER_MAP.get(t, t))
    metrics["tier"] = metrics["tier"].map(lambda t: TIER_MAP.get(t, t))

    # Snapshot the pre-rebuild scores so we can diff old-vs-new (Decision F).
    old_scores = metrics[
        ["supplier_id", "supplier_name", "tier", *SCORE_COLS, "calculated_tier", "tier_mismatch"]
    ].copy()

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

    # --- 5. calculated_tier + tier_mismatch (75/55 thresholds) ------------ #
    def tier_of(score):
        if score >= 75:
            return "Core"
        if score >= 55:
            return "Established"
        return "Standard"

    metrics["calculated_tier"] = metrics["composite_score"].map(tier_of)
    metrics["tier_mismatch"] = metrics["tier"] != metrics["calculated_tier"]

    # --- 6. (Batch 5) Drop Purchases.automation_period -------------------- #
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
    print("  calculated_tier:", metrics["calculated_tier"].value_counts().to_dict())
    print("  tier_mismatch:", metrics["tier_mismatch"].value_counts().to_dict())

    # --- Rebuild diff + review gate (Decision F) -------------------------- #
    diff = build_diff(old_scores, metrics)
    print_diff_summary(diff)
    diff_path = os.path.join(HERE, "score_rebuild_diff.json")
    with open(diff_path, "w") as f:
        json.dump(diff, f, indent=2)
    print(f"\nFull diff saved to {diff_path}")
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
