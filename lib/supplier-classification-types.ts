import type {
  KraljicQuadrant,
  KraljicResult,
  PerformanceSpendResult,
  AbcResult,
} from "@/lib/analysis-types";

/** One row of the combined Supplier Classification table (period/range-scoped). */
export type ClassificationRankingRow = {
  supplier_id: string;
  supplier_name: string;
  category: string | null;
  tier: string | null;
  abc_class: "A" | "B" | "C" | null;
  kraljic_quadrant: KraljicQuadrant | null;
  // Composite performance for the span (latest-in-range snapshot, same source as
  // the scatter). Null when the supplier has no classification in this period.
  performance_score: number | null;
  total_spend: number;
  // True when the supplier has no activity/classification in the selected period
  // (rendered muted, ranked last) — mirrors the Spend Overview ranking pattern.
  inactive: boolean;
};

/** The four cross-classification synthesis buckets (Kraljic × performance median). */
export type SynthesisKey =
  | "strategic_under"
  | "bottleneck_critical"
  | "leverage_workhorse"
  | "routine_risk";

/**
 * Prior-period portfolio summary for the glance panel's YoY finding (single-year
 * mode only). `null` in range mode or when there is no prior period / no cached
 * analyses for it. Computed server-side from the immediately-earlier period's
 * cached kraljic + performance analyses.
 */
export type ClassificationPrevSummary = {
  periodLabel: string;
  avg_performance: number;
  quadrant_counts: Record<KraljicQuadrant, number>;
};

/** Combined page payload for a date span. */
export type ClassificationPageData = {
  kraljic: KraljicResult | null;
  performance_spend: PerformanceSpendResult;
  abc: AbcResult | null;
  ranking: ClassificationRankingRow[];
  previous: ClassificationPrevSummary | null;
};
