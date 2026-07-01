import type {
  AbcResult,
  KraljicResult,
  PerformanceSpendResult,
  CycleTimeResult,
  RecommendationsResult,
  CycleAnomaly,
  Recommendation,
  KraljicQuadrant,
  PerformanceZone,
} from "@/lib/analysis-types";

/**
 * Static per-supplier catalog facts not carried by the period analyses
 * (country, PO count). `num_pos` is the SupplierMetric snapshot — a catalog
 * value, same provenance as the kraljicQuadrant snapshot used elsewhere; it is
 * NOT re-derived per selected range.
 */
export type SupplierDirectory = Record<
  string,
  { country: string; num_pos: number }
>;

/** The analyses the detail panel reads from (subset of ReportAnalyses). */
export type SupplierDetailInput = {
  abc: AbcResult | null;
  kraljic: KraljicResult | null;
  performance_spend: PerformanceSpendResult | null;
  cycle_time: CycleTimeResult | null;
  recommendations: RecommendationsResult | null;
};

export type SupplierDetail = {
  supplier_id: string;
  supplier_name: string;
  category: string | null;
  country: string | null;
  total_spend_usd: number | null;
  num_pos: number | null;
  performance_score: number | null;
  supply_risk_score: number | null;
  abc_class: "A" | "B" | "C" | null;
  kraljic_quadrant: KraljicQuadrant | null;
  performance_zone: PerformanceZone | null;
  anomalies: CycleAnomaly[];
  recommendations: Recommendation[];
};

/**
 * Assemble a supplier's cross-analysis profile by `supplier_id`. Period-accurate
 * fields (spend, performance, risk, classifications, anomalies, recs) come from
 * the LOADED analyses; identity catalog facts (category, country, PO count) come
 * from the static maps. Returns null when the supplier appears in none of the
 * analyses (e.g. absent from the selected period) — nothing to show.
 */
export function buildSupplierDetail(
  supplierId: string,
  a: SupplierDetailInput,
  supplierCategory: Record<string, string>,
  directory: SupplierDirectory,
): SupplierDetail | null {
  const abcRow =
    a.abc?.classifications.find((c) => c.supplier_id === supplierId) ?? null;
  const krRow =
    a.kraljic?.quadrant_assignments.find((q) => q.supplier_id === supplierId) ??
    null;
  const psRow =
    a.performance_spend?.suppliers.find((s) => s.supplier_id === supplierId) ??
    null;

  const name =
    abcRow?.supplier_name ?? krRow?.supplier_name ?? psRow?.supplier_name;
  if (!name) return null;

  const anomalies = (a.cycle_time?.anomalies ?? []).filter(
    (x) => x.supplier_id === supplierId,
  );
  const recommendations = (a.recommendations?.recommendations ?? []).filter(
    (r) => r.supplier_id === supplierId,
  );
  const dir = directory[supplierId];

  return {
    supplier_id: supplierId,
    supplier_name: name,
    category: supplierCategory[supplierId] ?? null,
    country: dir?.country ?? null,
    total_spend_usd: psRow?.total_spend_usd ?? abcRow?.total ?? null,
    num_pos: dir?.num_pos ?? null,
    performance_score: psRow?.performance_score ?? null,
    supply_risk_score: krRow?.supply_risk_score ?? null,
    abc_class: abcRow?.abc_class ?? null,
    kraljic_quadrant: krRow?.quadrant ?? psRow?.kraljic_quadrant ?? null,
    performance_zone: psRow?.zone ?? null,
    anomalies,
    recommendations,
  };
}
