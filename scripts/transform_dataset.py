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

import os
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
ASEAN = {"SG", "MY", "TH", "VN", "PH", "BN", "MM", "LA", "KH"}

# Single-source flag probability by category size. Calibrated DOWN from the
# spec's suggested rates because this dataset has no 1-supplier categories and
# many 2-3 supplier ones, so the spec rates would flag ~30% (target is 15-20%).
def single_source_prob(category_size: int) -> float:
    if category_size <= 1:
        return 1.0
    if category_size <= 3:
        return 0.28
    if category_size <= 5:
        return 0.12
    return 0.05


def country_distance(code: str) -> float:
    c = str(code).strip()
    if c in ("ID", "Indonesia"):
        return 0.0
    if c in ASEAN:
        return 5.0
    return 15.0


def summarize(label, series):
    print(
        f"  {label}: min={series.min():.1f} max={series.max():.1f} "
        f"mean={series.mean():.1f} std={series.std():.1f}"
    )


def main():
    rng = np.random.default_rng(SEED)

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

    # Category sizes from the supplier catalogue.
    cat_size = suppliers.groupby("category")["supplier_id"].transform("size")
    size_by_id = dict(zip(suppliers["supplier_id"], cat_size))

    # --- 2. risk_score (varied 20-95) ------------------------------------- #
    # Spend reliability credit: top spenders earn up to -10 (more dependable).
    spend = metrics["total_spend_usd"].astype(float)
    spend_norm = (spend - spend.min()) / (spend.max() - spend.min() + 1e-9)
    new_risk = []
    for _, r in metrics.iterrows():
        base = 44.0
        noise = float(np.clip(rng.normal(0, 18), -30, 30))
        country = country_distance(r.get("country", ""))
        complaints = min(float(r["complaint_count_annual"]) * 3.0, 15.0)
        credit = -10.0 * float(spend_norm.loc[r.name])
        new_risk.append(float(np.clip(base + noise + country + complaints + credit, 0, 100)))
    metrics["risk_score"] = np.round(new_risk, 2)

    # --- 3. single_source_risk (~15-20%, small-category biased) ----------- #
    flags = []
    for _, r in metrics.iterrows():
        size = int(size_by_id.get(r["supplier_id"], 99))
        flags.append(1 if rng.random() < single_source_prob(size) else 0)
    metrics["single_source_risk"] = flags

    # --- 4. composite_score (recompute with new risk) --------------------- #
    metrics["composite_score"] = np.round(
        sum(metrics[col] * w for col, w in WEIGHTS.items()), 2
    )

    # --- 5. calculated_tier + tier_mismatch (new names) ------------------- #
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
