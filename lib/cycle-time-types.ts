/** Per-supplier + per-category cycle-time breakdown (period/range-scoped),
 * computed on demand from the Purchase table by /api/cycle-time/breakdown. */

import type { KraljicQuadrant, PerformanceZone, CycleAnomaly } from "@/lib/analysis-types";

/** The four procure-to-pay stages, in order, with display labels. */
export const CYCLE_STAGES = [
  { key: "pr_to_po", label: "PR to PO" },
  { key: "po_to_delivery", label: "PO to Delivery" },
  { key: "delivery_to_invoice", label: "Delivery to Invoice" },
  { key: "invoice_to_payment", label: "Invoice to Payment" },
] as const;

export type CycleStageKey = (typeof CYCLE_STAGES)[number]["key"];

/** Supplier-level anomaly flags. Each flag filters the single Cycle Time roster;
 * membership is derived CLIENT-SIDE from already-fetched data (cycleTime.anomalies,
 * breakdown.stageAnomalies, roster IQR) — presentation only, no new compute. */
export type CycleFlagKey = "has_outlier" | "inconsistent" | "has_stage_dom";
export type SupplierFlagState = Record<CycleFlagKey, boolean>;

/** Plain-language hover explanations for the three supplier-level cycle flags —
 * shared by the roster pills, the anomaly cards, and the detail-card badge so the
 * wording stays consistent everywhere the flag surfaces. */
export const FLAG_TOOLTIP: Record<CycleFlagKey, string> = {
  has_outlier:
    "Outlier: this supplier has at least one PO whose total cycle time ran more than 2σ above the period mean.",
  inconsistent:
    "Inconsistent: this supplier's cycle times vary more widely than typical for this period's supplier base — its interquartile spread exceeds the variability threshold set across all suppliers. It's a supplier-level pattern, not tied to any single PO, so a supplier can be flagged in one period and not another.",
  has_stage_dom:
    "Stage-dominated: this supplier has at least one PO where a single stage took over 60% of the total cycle time.",
};

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
/** One stage's mean for a supplier vs the portfolio mean, for the panel's
 * per-stage comparison. Mean-based so it agrees with the mean-based
 * "Slowest stage" chip and the page-wide mean % of cycle. */
export type CycleStageComparison = {
  key: CycleStageKey;
  label: string;
  supplier_mean: number;
  portfolio_mean: number;
};

/** One PO in the supplier's selected-span history. `is_anomaly` mirrors the
 * cycle_time analysis flag (total cycle > 2σ above the span mean). */
export type CyclePoRow = {
  po_id: string;
  // The 5 procure-to-pay milestone dates (ISO YYYY-MM-DD; null if absent). The
  // cycle spans pr_date → payment_date, so payment_date − pr_date == total_cycle_days.
  pr_date: string | null;
  po_date: string | null;
  delivery_date: string | null;
  invoice_date: string | null;
  payment_date: string | null;
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
    // Performance-vs-Spend zone (period-scoped, parallel to kraljic_quadrant).
    zone: PerformanceZone | null;
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
  stages: CycleStageComparison[];
  pos: CyclePoRow[];
};

/** Portfolio-level cycle context for the supplier detail card's stat comparison:
 *  the population median + typical range (from cycle_time.distribution) and every
 *  supplier's median (from the breakdown roster) for percentile ranking. All
 *  display-derived from data the dashboard already has — no new compute. */
export type CyclePortfolioContext = {
  median: number | null;
  p25: number | null;
  p75: number | null;
  supplierMedians: number[];
  // The Inconsistent flag's threshold = 1.5 × median(all suppliers' IQRs). Used as
  // the consistency chart's band half-width so out-of-band crossings ⟺ the flag.
  iqrCutoff: number | null;
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
  // Spend-at-risk control metric: the value of POs that FAILED the 3-way match,
  // over the same span. Optional so older consumers stay valid.
  controlExposure?: ControlExposure;
};

/** 3-way-match spend-at-risk summary (failed-match value ÷ total spend). */
export type ControlExposure = {
  failed_spend: number; // Σ value of POs that failed the 3-way match
  total_spend: number; // Σ value of all POs in the span
  pct_at_risk: number; // failed_spend / total_spend * 100
  n_failed: number; // count of failed-match POs
  n_total: number; // count of all POs in the span
  n_failing_suppliers: number; // distinct suppliers with ≥1 failed match
  n_total_suppliers: number; // distinct suppliers active in the span
};

// --- Whole-integer per-stage monthly occupancy (GET /api/cycle-time/stage-occupancy)
/** One month's whole-integer count of POs active in each of the 4 procure-to-pay
 * stages, plus payment events. Each stage spans from its milestone to the NEXT
 * milestone; a PO counts as a whole +1 in EVERY window month its span touches
 * (occupancy), so per-month totals across the stages can exceed the PO count.
 * Payment is the terminal milestone — counted +1 in its own payment month. */
export type StageOccupancyRow = {
  month: string; // "YYYY-MM"
  pr_active: number; // prDate → poDate
  po_active: number; // poDate → deliveryDate
  delivery_active: number; // deliveryDate → invoiceDate
  invoice_active: number; // invoiceDate → paymentDate
  payment: number; // payment milestone, counted in its own month (terminal)
};

export type StageOccupancy = { months: StageOccupancyRow[] };
