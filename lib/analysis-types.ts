import { prisma } from "@/lib/prisma";

export type SpendOverviewResult = {
  total_spend: number;
  total_pos: number;
  active_suppliers: number;
  avg_cycle_time: number;
  by_category: { category: string; total: number }[];
  top_suppliers: { supplier_name: string; total: number }[];
  monthly_trend: { month: string; total: number }[];
};

export type AbcClassification = {
  supplier_id: string;
  supplier_name: string;
  tier: string;
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
  crosstab: Record<string, Record<string, number>>; // tier -> abc_class -> count
  abc_vs_tier?: Record<"A" | "B" | "C", Record<string, number>>; // class -> tier -> count
};

export type HypothesisStats = {
  n: number;
  mean: number | null;
  median: number | null;
  std: number | null;
  q1: number | null;
  q3: number | null;
  min: number | null;
  max: number | null;
};

export type HypothesisHistogram = {
  bin_centers: number[];
  pre: number[];
  post: number[];
};

export interface StageBreakdown {
  pr_to_po: number | null;
  po_to_delivery: number | null;
  delivery_to_invoice: number | null;
  invoice_to_payment: number | null;
}

export interface QuadrantCycleStats {
  pre_mean: number | null;
  post_mean: number | null;
  delta: number | null;
  n_suppliers: number;
}

export interface ThreeWayMatchStats {
  fail_rate_pct: number;
  n_pos: number;
}

export type HypothesisResult = {
  test: string;
  alpha: number;
  pre_stats: HypothesisStats;
  post_stats: HypothesisStats;
  histogram: HypothesisHistogram;
  statistic: number | null;
  p_value: number | null;
  effect_size: number | null;
  ci_low: number | null;
  ci_high: number | null;
  significant: boolean;
  insufficient_data?: boolean;
  monthly_trend: { month: string; mean_days: number }[];
  // 11D enrichments (optional for backward compatibility with old results).
  stage_breakdown?: {
    overall: StageBreakdown;
    pre: StageBreakdown;
    post: StageBreakdown;
  };
  cycle_by_quadrant?: Record<KraljicQuadrant, QuadrantCycleStats | null>;
  three_way_match_by_quadrant?: Record<KraljicQuadrant, ThreeWayMatchStats>;
};

export type KraljicQuadrant = "Strategic" | "Leverage" | "Bottleneck" | "Routine";

export interface QuadrantAssignment {
  supplier_id: string;
  supplier_name: string;
  tier: string;
  log_spend: number;
  supply_risk_score: number;
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
  quadrant_vs_tier: Record<KraljicQuadrant, Record<string, number>>;
}

export type PerformanceZone =
  | "Stars"
  | "Critical Issues"
  | "Hidden Gems"
  | "Long Tail";

export interface PerformanceSpendSupplier {
  supplier_id: string;
  supplier_name: string;
  tier: string;
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
  // 11D cross-reference (optional for backward compatibility).
  tier_mismatch_by_zone?: Record<
    PerformanceZone,
    { mismatched: number; total: number }
  >;
}

export type RecommendationCategory =
  | "tier_reclassification"
  | "critical_issues_engagement"
  | "hidden_gems_promotion"
  | "bottleneck_risk"
  | "process_improvement";

export type RecommendationAction =
  | "promote"
  | "demote"
  | "review"
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
  current_tier?: string;
  recommended_tier?: string;
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
  hypothesis: HypothesisResult;
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
