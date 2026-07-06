"""Compute-from-raw SupplierMetric rows (Stage 2 of the backend-scoring rebuild).

Thin orchestration over the proven-exact ``scores.py`` engine (no duplicated
formulas). This is the EXACT logic the import route will call in Stage 3 — given
the RAW inputs (Suppliers, raw SupplierMetrics soft-survey, Purchases), it
produces the full set of per-period SupplierMetric rows (identity + period tag +
operational aggregates + soft inputs + the 6 derived scores), ready to write to
the DB. Payment-year bucketed (``build_period_metrics``), D9 baked into
``risk_score``.

Pure: takes DataFrames in, returns a DataFrame out. No file I/O, no DB. Stage 2
verifies this in isolation against the captured baseline; Stage 3 maps the output
to Prisma fields (``period`` -> ``periodId``) and writes it.
"""

import os
import sys

import pandas as pd

sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import scores  # noqa: E402

# Columns of a computed per-period SupplierMetric row, in a stable order.
METRIC_COLS = (
    scores.IDENTITY_COLS
    + ["period"]
    + [
        "total_spend_usd", "num_pos", "avg_po_value_usd", "avg_lead_time_days",
        "avg_cycle_time_days", "on_time_delivery_pct", "three_way_match_pct",
    ]
    + scores.SOFT_COLS
    + scores.SCORE_COLS
)


def compute_supplier_metrics(
    suppliers: pd.DataFrame,
    metrics: pd.DataFrame,
    purchases: pd.DataFrame,
) -> pd.DataFrame:
    """Full per-period SupplierMetric rows from RAW inputs.

    `suppliers` — the Suppliers master (drives the roster concentration count).
    `metrics`   — the RAW SupplierMetrics soft-survey rows (one per supplier:
                  identity + defect/complaints/rfx/response/single-source).
    `purchases` — the Purchases rows (drive per-period operational aggregates +
                  the payment-year bucketing).

    Returns one row per ACTIVE supplier-period with all 6 scores computed. The
    `period` column is the integer payment-year; Stage 3 maps it to a periodId.
    """
    roster = scores.roster_category_counts(suppliers)
    m = scores.build_period_metrics(metrics, purchases)
    m = scores.compute_scores(m, roster)
    return m[METRIC_COLS].reset_index(drop=True)
