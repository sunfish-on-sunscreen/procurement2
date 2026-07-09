/**
 * Client-safe report customization config (Batch 3c). No server-only imports so
 * the modal + the shared <ReportDocument> renderer can use it freely.
 */
import type { PeriodSelection } from "@/lib/period-constants";
import type { RecommendationCategory } from "@/lib/analysis-types";

// sessionStorage key for an in-memory (range) report handed to /reports/preview.
export const EPHEMERAL_KEY = "ephemeralReport";

export type SectionKey =
  | "spendOverview"
  | "abc"
  | "kraljic"
  | "performanceSpend"
  | "cycleTime"
  | "actionDashboard"
  | "methodology";

export type DetailLevel = "brief" | "standard" | "detailed";
export type ReportTone = "executive" | "operational" | "analytical";

export interface ReportConfig {
  period: PeriodSelection;
  sections: {
    executiveSummary: true; // always on
    spendOverview: boolean;
    abc: boolean;
    kraljic: boolean;
    performanceSpend: boolean;
    cycleTime: boolean;
    actionDashboard: boolean;
    methodology: boolean;
  };
  recommendationFilters: {
    categories: RecommendationCategory[];
    topN: number;
  };
  detailLevel: DetailLevel;
  tone: ReportTone;
  filters: {
    categories: string[]; // supplier categories (e.g. "Fuel", "Tires")
  };
  filterScope: {
    categoryApplies: SectionKey[];
  };
}

/** A user-saved preset (Batch 6d): a named full-config snapshot from the DB. */
export type SavedPreset = {
  id: string;
  name: string;
  config: ReportConfig;
  updatedAt: string;
};

export const ALL_REC_CATEGORIES: RecommendationCategory[] = [
  "critical_issues_engagement",
  "bottleneck_risk",
  "hidden_gems_promotion",
  "process_improvement",
  "concentration",
  "critical_spend",
  "tail_spend",
  "slow_stage",
];

export const REC_CATEGORY_LABELS: Record<RecommendationCategory, string> = {
  critical_issues_engagement: "Critical Issues",
  bottleneck_risk: "Bottleneck Risk",
  hidden_gems_promotion: "Hidden Gems",
  process_improvement: "Process Improvement",
  concentration: "Concentration",
  critical_spend: "Critical Spend",
  tail_spend: "Tail Spend",
  slow_stage: "Slowest Stage",
};

// Smart defaults: which sections the category filter applies to out of the box.
export const DEFAULT_CATEGORY_SCOPE: SectionKey[] = [
  "abc",
  "kraljic",
  "performanceSpend",
];

// Sections that filters can affect at all (the rest are aggregate-only).
export const FILTERABLE_SECTIONS: SectionKey[] = [
  "abc",
  "kraljic",
  "performanceSpend",
  "actionDashboard",
];

export const SECTION_LABELS: Record<SectionKey, string> = {
  spendOverview: "Spend Overview",
  abc: "ABC Analysis",
  kraljic: "Supplier Quadrant",
  performanceSpend: "Performance vs Spend",
  cycleTime: "Cycle Time",
  actionDashboard: "Action Priorities",
  methodology: "Methodology",
};

export function defaultReportConfig(
  period: PeriodSelection,
  allCategories: string[],
): ReportConfig {
  return {
    period,
    sections: {
      executiveSummary: true,
      spendOverview: true,
      abc: true,
      kraljic: true,
      performanceSpend: true,
      cycleTime: true,
      actionDashboard: true,
      methodology: true,
    },
    recommendationFilters: { categories: [...ALL_REC_CATEGORIES], topN: 10 },
    detailLevel: "standard",
    tone: "operational",
    filters: { categories: [...allCategories] },
    filterScope: {
      categoryApplies: [...DEFAULT_CATEGORY_SCOPE],
    },
  };
}

/**
 * Reset all FILTER-related config to defaults (Batch 6c) while preserving the
 * user's deliberate choices: period, tone, and detail level. Resets the
 * category filter, section visibility, recommendation filters, and the
 * per-section filter scope.
 */
export function resetReportFilters(
  config: ReportConfig,
  allCategories: string[],
): ReportConfig {
  return {
    ...config,
    sections: {
      executiveSummary: true,
      spendOverview: true,
      abc: true,
      kraljic: true,
      performanceSpend: true,
      cycleTime: true,
      actionDashboard: true,
      methodology: true,
    },
    recommendationFilters: { categories: [...ALL_REC_CATEGORIES], topN: 10 },
    filters: { categories: [...allCategories] },
    filterScope: {
      categoryApplies: [...DEFAULT_CATEGORY_SCOPE],
    },
  };
}

/** True when the category filter should hide rows for this section. */
export function categoryFilterActive(
  config: ReportConfig,
  section: SectionKey,
  totalCategories: number,
) {
  return (
    config.filterScope.categoryApplies.includes(section) &&
    config.filters.categories.length > 0 &&
    config.filters.categories.length < totalCategories
  );
}
