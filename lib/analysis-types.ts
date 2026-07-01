import { prisma } from "@/lib/prisma";

/**
 * A top-spend supplier bar. `supplier_id` (Batch 6b) is the stable cross-chart
 * identity key emitted by the Python `spend_overview`. Chart highlight/pin still
 * guards on its presence for resilience against any legacy cached payload.
 */
export type TopSupplier = {
  supplier_id: string;
  supplier_name: string;
  total: number;
};

export type SpendOverviewResult = {
  total_spend: number;
  total_pos: number;
  active_suppliers: number;
  avg_cycle_time: number;
  by_category: { category: string; total: number }[];
  top_suppliers: TopSupplier[];
  /**
   * Per-category top-10 suppliers (same shape as top_suppliers), keyed by
   * category. Powers the Overview chart's category filter. Optional: old cached
   * spend_overview rows (pre-Batch-4) won't have it — consumers fall back to
   * "All Categories" only when absent.
   */
  top_suppliers_by_category?: Record<string, TopSupplier[]>;
  // `po_count` added in Batch 6c (per-month PO count for KPI sparklines);
  // optional for pre-6c cached rows.
  monthly_trend: { month: string; total: number; po_count?: number }[];
};

export type AbcClassification = {
  supplier_id: string;
  supplier_name: string;
  total: number;
  rank: number;
  pct: number;
  cumulative_pct: number;
  abc_class: "A" | "B" | "C";
};

export type AbcResult = {
  thresholds: [number, number];
  classifications: AbcClassification[];
  summary: {
    A: { n: number; total_spend: number; pct_of_spend: number };
    B: { n: number; total_spend: number; pct_of_spend: number };
    C: { n: number; total_spend: number; pct_of_spend: number };
  };
};

// --- Cycle Time (process-health monitoring + date-driven comparison) ------- #
// Renamed from "hypothesis" in Batch 5. Metric = total_cycle_days. The old
// pre/post automation shape lives on as LegacyHypothesisResult for the
// report backward-compat path (see ReportDocument).

/** mean/median/IQR descriptives over a cycle-day population. */
export type CycleDescriptive = {
  mean: number | null;
  median: number | null;
  p25: number | null;
  p75: number | null;
  n: number;
};

export type CycleDistribution = {
  median: number | null;
  p25: number | null;
  p75: number | null;
  iqr: number | null;
  min: number | null;
  max: number | null;
  mean: number | null;
  std: number | null;
  n: number;
};

export type CycleStageBreakdown = {
  pr_to_po: CycleDescriptive;
  po_to_delivery: CycleDescriptive;
  delivery_to_invoice: CycleDescriptive;
  invoice_to_payment: CycleDescriptive;
};

export type CycleAnomaly = {
  po_id: string;
  // Stable cross-chart identity key (Batch 6b), emitted by Python cycle_time.
  supplier_id: string;
  supplier_name: string;
  invoice_date: string | null;
  cycle_days: number | null;
  z_score: number;
};

export type EffectSizeLabel = "negligible" | "small" | "medium" | "large";

export type PeriodComparison = {
  period_a: { start: string; end: string; n: number };
  period_b: { start: string; end: string; n: number };
  mannwhitney_u: number | null;
  p_value: number | null;
  rank_biserial_r: number | null;
  effect_size_label: EffectSizeLabel | null;
  median_a: number | null;
  median_b: number | null;
  insufficient_data: boolean;
};

export type ThreeWayMatchQuadrant = {
  pass_rate_pct: number | null;
  n: number;
  is_worst: boolean;
};

export type CycleTimeResult = {
  metric: string;
  // `median_cycle_days` added in Batch 6c (monthly median for KPI sparklines);
  // optional for pre-6c cached rows.
  monthly_trend: {
    month: string;
    avg_cycle_days: number;
    median_cycle_days?: number;
    po_count: number;
  }[];
  rolling_avg_trend: { month: string; rolling_3mo: number }[];
  distribution: CycleDistribution;
  stage_breakdown: CycleStageBreakdown;
  anomalies: CycleAnomaly[];
  period_comparison: PeriodComparison;
  cycle_by_quadrant: Record<KraljicQuadrant, CycleDescriptive>;
  three_way_match_by_quadrant: Record<KraljicQuadrant, ThreeWayMatchQuadrant>;
};

/**
 * Legacy pre/post "automation impact" shape. Only consumed by the report
 * backward-compat path for reports persisted before Batch 5. Detected by the
 * presence of `pre_stats`/`statistic` and the ABSENCE of `period_comparison`.
 * Do NOT use for new code.
 */
export type LegacyHypothesisResult = {
  test?: string;
  pre_stats?: { n: number; mean: number | null; median: number | null };
  post_stats?: { n: number; mean: number | null; median: number | null };
  statistic?: number | null;
  p_value?: number | null;
  effect_size?: number | null;
  significant?: boolean;
};

export type KraljicQuadrant = "Strategic" | "Leverage" | "Bottleneck" | "Routine";

/**
 * The three components of the Kraljic supply-risk score (each clipped to its own
 * cap: supply_concentration ≤50, cost_premium ≤25, import_friction ≤25). They sum
 * to `supply_risk_score` at 2dp — the Python emit defines the total AS the sum of
 * these rounded components, so the detail-panel breakdown reconciles with the
 * scatter point exactly. `supply_concentration` merges the former single_source +
 * category_competition into one roster-derived measure.
 */
export interface RiskComponents {
  supply_concentration: number;
  cost_premium: number;
  import_friction: number;
}

export interface QuadrantAssignment {
  supplier_id: string;
  supplier_name: string;
  log_spend: number;
  supply_risk_score: number;
  // Optional: pre-emit cached rows (before this batch) lack it — the breakdown
  // tab guards on its presence. The range cache is cleared on this batch's run.
  risk_components?: RiskComponents;
  quadrant: KraljicQuadrant;
}

export interface QuadrantProfile {
  quadrant: KraljicQuadrant;
  n_suppliers: number;
  total_spend: number;
  pct_of_total_spend: number;
  avg_performance_score: number;
  median_risk: number;
  median_spend: number;
}

export interface KraljicResult {
  quadrant_assignments: QuadrantAssignment[];
  quadrant_profiles: QuadrantProfile[];
  axis_thresholds: {
    spend_median: number;
    risk_median: number;
  };
}

export type PerformanceZone =
  | "Stars"
  | "Critical Issues"
  | "Hidden Gems"
  | "Long Tail";

export interface PerformanceSpendSupplier {
  supplier_id: string;
  supplier_name: string;
  log_spend: number;
  total_spend_usd: number; // raw spend for display
  performance_score: number;
  kraljic_quadrant: KraljicQuadrant;
  zone: PerformanceZone;
}

export interface ZoneProfile {
  zone: PerformanceZone;
  n_suppliers: number;
  total_spend_usd: number;
  pct_of_total_spend: number;
  avg_performance: number;
}

export interface PerformanceSpendResult {
  suppliers: PerformanceSpendSupplier[];
  zone_profiles: ZoneProfile[];
  axis_thresholds: {
    spend_median: number;
    performance_median: number;
  };
  top_critical_issues: PerformanceSpendSupplier[]; // top 5 by spend
  top_hidden_gems: PerformanceSpendSupplier[]; // top 5 by performance
  performance_by_quadrant: Record<KraljicQuadrant, number>;
}

export type RecommendationCategory =
  | "critical_issues_engagement"
  | "hidden_gems_promotion"
  | "bottleneck_risk"
  | "process_improvement";

export type RecommendationAction =
  | "promote"
  | "engage"
  | "mitigate"
  | "improve";

// A `type` alias (not `interface`) so it satisfies Prisma's JSON index-signature
// when persisted in ExecutiveSummary.metricsJson.
export type Recommendation = {
  type: RecommendationCategory;
  action: RecommendationAction;
  supplier_id?: string; // absent for process_improvement
  supplier_name?: string;
  reasoning: string;
  impact_score: number;
  // Category-specific optional fields:
  total_spend_usd?: number;
  performance_score?: number;
  kraljic_quadrant?: KraljicQuadrant;
  supply_risk_score?: number;
  country?: string;
  scope?: string; // for process_improvement
};

export interface RecommendationsResult {
  period_label: string;
  generated_at: string;
  recommendations: Recommendation[];
  summary_stats: {
    total_recommendations: number;
    by_category: Record<RecommendationCategory, number>;
    highest_impact: Recommendation | null;
  };
}

/** Full payload returned by /api/analyses/compute-range (Python Mode B). */
export type RangeAnalyses = {
  spend_overview: SpendOverviewResult;
  abc: AbcResult;
  cycle_time: CycleTimeResult;
  performance_spend: PerformanceSpendResult;
  kraljic: KraljicResult;
  recommendations: RecommendationsResult;
};

/**
 * Fetch a pre-computed AnalysisResult's resultJson, typed as T, or null if it
 * has not been computed for the period yet.
 */
export async function getAnalysisResult<T>(
  periodId: string,
  analysisType: string,
): Promise<T | null> {
  const row = await prisma.analysisResult.findUnique({
    where: { periodId_analysisType: { periodId, analysisType } },
    select: { resultJson: true },
  });
  if (!row) return null;
  return row.resultJson as unknown as T;
}
