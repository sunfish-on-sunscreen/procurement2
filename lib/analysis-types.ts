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
  /**
   * DISTINCT REAL category count for the window (excludes the synthetic "Other"
   * rollup). Use this to COUNT or label categories — NOT `by_category.length`,
   * which is capped at top-8 + "Other" for the donut and understates the truth.
   * Optional: pre-2026-07-14 cached rows won't have it — consumers fall back to
   * the `top_suppliers_by_category` key count (also complete).
   */
  total_categories?: number;
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
  /** Why no test was run. "empty_group" = one side has no orders, so no comparison
   *  EXISTS (never emit a p-value for it); "too_few" = under the 10-obs floor. */
  skip_reason?: "empty_group" | "too_few" | null;
  /** Minimum detectable effect (probability of superiority) at 80% power — lets a
   *  NULL be reported as informative rather than silent. */
  mde_a?: number | null;
  /** Window rows outside both groups. 0 under a partition; surfaced so a
   *  regression to silent dropping is visible. */
  excluded_n?: number;
};

/**
 * Per-buying-method period-over-period tests that survive BOTH Benjamini-Hochberg
 * correction and a power floor. Deliberately NOT a general significance surface:
 * `findings` is usually empty, and `tested` says how many tests ran so the UI can
 * report "1 of 10" rather than implying only one test existed.
 */
export type MethodSignificance = {
  tested: number;
  alpha: number;
  min_power: number;
  correction: string;
  findings: {
    method: string;
    from: string;
    to: string;
    n_from: number;
    n_to: number;
    median_from: number | null;
    median_to: number | null;
    p_value: number | null;
    q_value: number | null;
    power: number | null;
    direction: "faster" | "slower";
  }[];
};

export type ThreeWayMatchQuadrant = {
  pass_rate_pct: number | null;
  n: number;
  is_worst: boolean;
};

export type CycleTimeResult = {
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
  // Per-buying-method cut + the mix-adjusted trend. Cycle time is near-deterministic
  // in buying method (spot_buy ~44d -> direct ~130d), so the pooled mean is a WEIGHTED
  // MIXTURE and a shift in method mix can reverse the apparent trend. Both OPTIONAL —
  // analyses cached before this was added won't carry them.
  cycle_by_method?: Record<string, CycleMethodDescriptive>;
  mix_adjusted_trend?: MixAdjustedTrend;
  method_significance?: MethodSignificance;
  three_way_match_by_quadrant: Record<KraljicQuadrant, ThreeWayMatchQuadrant>;
};

/** cycle_by_method mirrors CycleDescriptive at the top level (so it reuses the same
 *  rendering as cycle_by_quadrant), with internal-cycle + per-stage detail nested. */
export type CycleMethodDescriptive = CycleDescriptive & {
  internal: CycleDescriptive;
  stage_breakdown: CycleStageBreakdown;
};

/** Shift-share decomposition: pooled change == mix effect + within-method effect.
 *  `pooled_misleading` marks transitions the UI must not report naively. */
export type MixAdjustedTransition = {
  from: string;
  to: string;
  from_pooled_mean: number | null;
  to_pooled_mean: number | null;
  pooled_change: number | null;
  mix_effect: number | null;
  within_effect: number | null;
  /** Each effect as a share of the EARLIER period's pooled mean, so a day figure
   *  carries a sense of scale ("+4.96d" = "+5.7%") without implying inference. */
  pooled_change_pct: number | null;
  mix_effect_pct: number | null;
  within_effect_pct: number | null;
  pooled_misleading: boolean;
  reason: "sign_reversal" | "magnitude_masked" | null;
  per_method: {
    method: string;
    from_mean: number | null;
    to_mean: number | null;
    within_change: number | null;
    from_share_pct: number | null;
    to_share_pct: number | null;
  }[];
};

export type MixAdjustedMetric = {
  per_period: Record<
    string,
    {
      n: number;
      pooled_mean: number | null;
      shares_pct: Record<string, number | null>;
      means: Record<string, number | null>;
    }
  >;
  transitions: MixAdjustedTransition[];
};

export type MixAdjustedTrend = {
  /** true when fewer than 2 periods exist IN THE DATA (not in the window). */
  insufficient_data: boolean;
  /** Every period in the data — transitions are computed across all of them,
   *  WINDOW-INDEPENDENTLY, so a transition reads the same on every window. */
  periods: string[];
  /** Periods inside the SELECTED window. Display hint only: show transitions whose
   *  `to` is in here (2024 -> none, 2025 -> 2024→2025, 2026 -> 2025→2026,
   *  full range -> both). */
  window_periods: string[];
  metrics: { total?: MixAdjustedMetric; internal?: MixAdjustedMetric };
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
}

export type RecommendationCategory =
  | "critical_issues_engagement"
  | "hidden_gems_promotion"
  | "bottleneck_risk"
  | "process_improvement"
  | "concentration"
  | "critical_spend" // A-tier "vital few" — supplier criticality (Spend group)
  | "tail_spend" // sub-1% suppliers, one portfolio-summary card (Spend group)
  | "slow_stage"; // slowest internal P2P stage(s) above the 8-day flag (Process group)

export type RecommendationAction =
  | "promote"
  | "engage"
  | "mitigate"
  | "improve"
  | "diversify"
  | "steward" // critical_spend
  | "consolidate" // tail_spend
  | "streamline"; // slow_stage

// A `type` alias (not `interface`) so it satisfies Prisma's JSON index-signature
// when persisted in ExecutiveSummary.metricsJson.
export type Recommendation = {
  type: RecommendationCategory;
  action: RecommendationAction;
  supplier_id?: string; // absent for process_improvement + category-level concentration
  supplier_name?: string;
  reasoning: string;
  impact_score: number;
  // Category-specific optional fields:
  total_spend_usd?: number;
  performance_score?: number;
  kraljic_quadrant?: KraljicQuadrant;
  supply_risk_score?: number;
  country?: string;
  scope?: string; // for process_improvement / slow_stage / tail_spend
  // Concentration-specific:
  concentration_kind?: "category" | "supplier";
  category?: string; // spend category for a category-level concentration item
  share_pct?: number; // share of total spend
  // Critical Spend (A-items):
  abc_class?: "A" | "B" | "C";
  // Slowest stage:
  avg_days?: number; // this stage's average duration
  // Tail spend (portfolio summary):
  tail_supplier_count?: number;
  tail_spend_share_pct?: number; // combined tail spend as % of total
  tail_supplier_pct?: number; // tail count as % of the supplier roster
};

/** Fixed-structure synthesis numbers for the page headline (both compute modes). */
export type RecommendationsNarrative = {
  n_suppliers: number;
  total_spend: number;
  top10_in_attention: number;
  top_category_name: string;
  top_category_share_pct: number;
  // "What each analysis found" strip (optional — old cached rows lack these).
  a_items_count?: number; // # of A-tier suppliers (Spend finding)
  slowest_stage_name?: string; // slowest internal stage (Process finding)
  slowest_stage_avg_days?: number | null; // its average days, null if none flagged
};

export interface RecommendationsResult {
  recommendations: Recommendation[];
  summary_stats: {
    total_recommendations: number;
    by_category: Record<RecommendationCategory, number>;
    highest_impact: Recommendation | null;
    // Optional: old cached rows (pre-redesign) won't have it — the UI guards.
    narrative?: RecommendationsNarrative;
  };
}

// --- Competitive sourcing coverage ----------------------------------------- #

/**
 * ⚠️ THREE BUCKETS, and `framework` is PERMANENT — never fold it into either side.
 * A call-off draws against a framework agreement that in real procurement was
 * competed once, at framework award, but `Framework` carries NO sourcing linkage in
 * this schema, so the data cannot say whether it was. A competed/uncompeted binary
 * would be wrong by the whole call-off share (44.78% of spend) whichever way it fell.
 */
export type CoverageBucket = "competed" | "framework" | "uncompeted";

export type CoverageSplit = {
  spend: number;
  pos: number;
  spend_pct: number;
  pos_pct: number;
};

export type CoverageMethod = CoverageSplit & {
  /** Which bucket this method rolls into; null if the vocabulary ever drifts. */
  bucket: CoverageBucket | null;
  median_po_value: number | null;
  avg_po_value: number | null;
};

/** Per-category / per-supplier coverage. ⚠️ COMPLETE — the compute layer emits every
 *  row and the DISPLAY decides what to truncate. Never derive a COUNT from a sliced
 *  copy of these arrays (the documented cap trap that poisoned three counts). */
export type CoverageCategory = {
  category: string;
  spend: number;
  pos: number;
  competed_pct: number;
  framework_pct: number;
  uncompeted_pct: number;
};

export type CoverageSupplier = {
  supplier_id: string;
  supplier_name: string;
  spend: number;
  pos: number;
  /** Distinct buying methods used — 1 means the supplier is bought one way only. */
  methods_used: number;
  competed_pct: number;
  framework_pct: number;
  uncompeted_pct: number;
};

/**
 * ⚠️ PORTFOLIO-LEVEL ONLY, AND DELIBERATELY SO. There is no by-category / by-supplier
 * / by-period cut of quote spread and one must never be added: spread is an order
 * statistic of the BID COUNT (9.22% at 2 bids, 12.80% at 3, 13.06% at 4) and is flat
 * across every other dimension once bid count is held fixed. A breakdown would report
 * the bid-count mix wearing a category label.
 */
export type CoverageBidding = {
  events: number;
  responses: number;
  avg_bids: number | null;
  min_bids: number | null;
  max_bids: number | null;
  /** bid count -> number of events, e.g. {"2": 31, "3": 165, "4": 30}. */
  bids_distribution: Record<string, number>;
  avg_quote_spread_pct: number | null;
  median_quote_spread_pct: number | null;
};

/** One category's contribution to a coverage transition. */
export type CoverageMixCategory = {
  category: string;
  from_rate_pct: number | null;
  to_rate_pct: number | null;
  within_change_pct: number | null;
  from_share_pct: number | null;
  to_share_pct: number | null;
};

/**
 * Shift-share of one bucket's spend share between two periods, in PERCENTAGE POINTS:
 * `pooled_change_pct == mix_effect_pct + within_effect_pct` (exactly, up to the 2dp
 * rounding of each field independently — reconcile in the UI by DERIVING the third
 * from the other two rather than rendering all three raw).
 *
 * mix = what was bought changed · within = how it was bought changed.
 *
 * ⚠️ Read the split; never assume which side dominates. On the seeded data the 2025
 * competed fall is -3.51 mix / -6.37 within — i.e. mostly BEHAVIOUR, not mix.
 */
export type CoverageMixTransition = {
  from: string;
  to: string;
  from_pooled_pct: number | null;
  to_pooled_pct: number | null;
  pooled_change_pct: number | null;
  mix_effect_pct: number | null;
  within_effect_pct: number | null;
  /** 0 except where a category nets to zero spend while holding bucket spend.
   *  Surfaced rather than swallowed so a broken decomposition cannot hide behind a
   *  correct-looking total. */
  residual_pct: number | null;
  /** True when the pooled number must NOT be reported naively. */
  pooled_misleading: boolean;
  reason: "sign_reversal" | "magnitude_masked" | "mix_dominated" | null;
  per_category: CoverageMixCategory[];
};

export type CoverageMixMetric = {
  per_period: Record<
    string,
    {
      n: number;
      spend: number | null;
      pooled_pct: number | null;
      shares_pct: Record<string, number | null>;
      rates_pct: Record<string, number | null>;
    }
  >;
  transitions: CoverageMixTransition[];
};

export type CoverageMixAdjusted = {
  insufficient_data: boolean;
  /** Every period in the DATA — transitions are computed window-independently, so a
   *  transition reads the same on every period selection. */
  periods: string[];
  /** Periods inside the SELECTED window. Display hint only: show transitions whose
   *  `to` falls in here. */
  window_periods: string[];
  metrics: Partial<Record<CoverageBucket, CoverageMixMetric>>;
};

export type SourcingCoverageResult = {
  total_spend: number;
  total_pos: number;
  by_bucket: Record<CoverageBucket, CoverageSplit>;
  by_method: Record<string, CoverageMethod>;
  by_category: CoverageCategory[];
  by_supplier: CoverageSupplier[];
  bidding: CoverageBidding;
  framework_leakage: {
    calloffs: number;
    with_framework: number;
    outside_window: number;
    outside_window_spend: number;
  };
  /**
   * ⚠️ A FINDING, not a caveat: the share of spend whose competitive basis cannot be
   * established from this schema. Surfaced as a number because it names a concrete
   * fix (link Framework to the sourcing event that awarded it), which is more
   * actionable than any coverage percentage.
   */
  unverifiable_share: {
    spend: number;
    spend_pct: number;
    pos: number;
    /** Stable machine code, not display copy. */
    reason: "framework_has_no_sourcing_linkage";
  };
  /** Orders whose buying_method is outside the vocabulary. Always 0 (both import
   *  paths reject unknown/blank), COUNTED rather than absorbed so a regression is
   *  visible instead of silently inflating a bucket. */
  unclassified: { spend: number; pos: number };
  mix_adjusted_coverage: CoverageMixAdjusted;
};

/** Full payload returned by /api/analyses/compute-range (Python Mode B). */
export type RangeAnalyses = {
  spend_overview: SpendOverviewResult;
  abc: AbcResult;
  cycle_time: CycleTimeResult;
  performance_spend: PerformanceSpendResult;
  kraljic: KraljicResult;
  recommendations: RecommendationsResult;
  sourcing_coverage: SourcingCoverageResult;
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
