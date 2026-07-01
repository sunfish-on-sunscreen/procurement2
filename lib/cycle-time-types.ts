/** Per-supplier + per-category cycle-time breakdown (period/range-scoped),
 * computed on demand from the Purchase table by /api/cycle-time/breakdown. */

import type { KraljicQuadrant, CycleAnomaly } from "@/lib/analysis-types";

/** The four procure-to-pay stages, in order, with display labels. */
export const CYCLE_STAGES = [
  { key: "pr_to_po", label: "PR → PO" },
  { key: "po_to_delivery", label: "PO → Delivery" },
  { key: "delivery_to_invoice", label: "Delivery → Invoice" },
  { key: "invoice_to_payment", label: "Invoice → Payment" },
] as const;

export type CycleStageKey = (typeof CYCLE_STAGES)[number]["key"];

/** Supplier-level anomaly flags. Each flag filters the single Cycle Time roster;
 * membership is derived CLIENT-SIDE from already-fetched data (cycleTime.anomalies,
 * breakdown.stageAnomalies, roster IQR) — presentation only, no new compute. */
export type CycleFlagKey = "has_outlier" | "inconsistent" | "has_stage_dom";
export type SupplierFlagState = Record<CycleFlagKey, boolean>;

export type AbcClass = "A" | "B" | "C";

export type CycleSupplierRow = {
  supplier_id: string;
  supplier_name: string;
  po_count: number;
  median_cycle: number;
  p25: number;
  p75: number;
  iqr: number;
  // The stage that contributes the most mean days for this supplier.
  slowest_stage: CycleStageKey;
  slowest_stage_label: string;
  slowest_stage_pct: number; // share of mean total cycle (0–100)
  // Classification context (period-scoped, from getRangeAnalyses) — null when
  // the supplier isn't classified in the selected span.
  abc_class: AbcClass | null;
  kraljic_quadrant: KraljicQuadrant | null;
  composite: number | null;
};

// --- Per-supplier drill-down (GET /api/cycle-time/supplier-detail) ---------- #
/** One stage's median for a supplier vs the portfolio median, for the panel's
 * per-stage comparison. */
export type CycleStageMedian = {
  key: CycleStageKey;
  label: string;
  supplier_median: number;
  portfolio_median: number;
};

/** One PO in the supplier's selected-span history. `is_anomaly` mirrors the
 * cycle_time analysis flag (total cycle > 2σ above the span mean). */
export type CyclePoRow = {
  po_id: string;
  invoice_date: string | null;
  total_cycle_days: number;
  slowest_stage: CycleStageKey;
  slowest_stage_label: string;
  is_anomaly: boolean;
};

export type CycleSupplierDetail = {
  supplier: {
    id: string;
    name: string;
    category: string | null;
    country: string | null;
    abc_class: AbcClass | null;
    kraljic_quadrant: KraljicQuadrant | null;
    composite: number | null;
  };
  cycle: {
    median_cycle: number;
    p25: number;
    p75: number;
    iqr: number;
    po_count: number;
    slowest_stage: CycleStageKey;
    slowest_stage_label: string;
  };
  stages: CycleStageMedian[];
  pos: CyclePoRow[];
};

export type CycleCategoryRow = {
  category: string;
  po_count: number;
  // Mean days in each stage across the category's POs.
  pr_to_po: number;
  po_to_delivery: number;
  delivery_to_invoice: number;
  invoice_to_payment: number;
  total_mean: number;
};

export type CycleBreakdown = {
  bySupplier: CycleSupplierRow[];
  byCategory: CycleCategoryRow[];
  // POs where one stage's share of total cycle exceeds 50% (stage-dominated
  // outliers); z_score is over the in-span cycle population. Optional so any
  // older cached/consumer shape stays valid.
  stageAnomalies?: CycleAnomaly[];
};
