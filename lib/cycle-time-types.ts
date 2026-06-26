/** Per-supplier + per-category cycle-time breakdown (period/range-scoped),
 * computed on demand from the Purchase table by /api/cycle-time/breakdown. */

/** The four procure-to-pay stages, in order, with display labels. */
export const CYCLE_STAGES = [
  { key: "pr_to_po", label: "PR → PO" },
  { key: "po_to_delivery", label: "PO → Delivery" },
  { key: "delivery_to_invoice", label: "Delivery → Invoice" },
  { key: "invoice_to_payment", label: "Invoice → Payment" },
] as const;

export type CycleStageKey = (typeof CYCLE_STAGES)[number]["key"];

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
};
