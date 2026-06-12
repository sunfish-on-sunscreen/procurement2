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
};

export type ClusterAssignment = {
  supplier_id: string;
  supplier_name: string;
  tier: string;
  cluster: number;
  pca1: number;
  pca2: number;
};

export type ClusterProfile = {
  cluster: number;
  n_suppliers: number;
  [feature: string]: number;
};

export type ClusteringResult = {
  k: number;
  features_used: string[];
  cluster_assignments: ClusterAssignment[];
  cluster_profiles: ClusterProfile[];
  explained_variance: { pc1: number; pc2: number };
  tier_vs_cluster: Record<string, Record<string, number>>;
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

/** Full payload returned by /api/analyses/compute-range (Python Mode B). */
export type RangeAnalyses = {
  spend_overview: SpendOverviewResult;
  abc: AbcResult;
  clustering: ClusteringResult;
  hypothesis: HypothesisResult;
  kraljic: KraljicResult;
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
