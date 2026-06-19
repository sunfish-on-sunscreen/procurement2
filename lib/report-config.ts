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

export type Tier = "Core" | "Established" | "Standard";
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
    tiers: Tier[];
    categories: string[]; // supplier categories (e.g. "Fuel", "Tires")
  };
  filterScope: {
    tierApplies: SectionKey[];
    categoryApplies: SectionKey[];
  };
}

export const ALL_TIERS: Tier[] = ["Core", "Established", "Standard"];

export const ALL_REC_CATEGORIES: RecommendationCategory[] = [
  "critical_issues_engagement",
  "tier_reclassification",
  "bottleneck_risk",
  "hidden_gems_promotion",
  "process_improvement",
];

export const REC_CATEGORY_LABELS: Record<RecommendationCategory, string> = {
  critical_issues_engagement: "Critical Issues",
  tier_reclassification: "Tier Reclassification",
  bottleneck_risk: "Bottleneck Risk",
  hidden_gems_promotion: "Hidden Gems",
  process_improvement: "Process Improvement",
};

// Smart defaults: which sections each filter applies to out of the box.
export const DEFAULT_TIER_SCOPE: SectionKey[] = [
  "kraljic",
  "performanceSpend",
  "actionDashboard",
];
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
  actionDashboard: "Action Dashboard",
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
    filters: { tiers: [...ALL_TIERS], categories: [...allCategories] },
    filterScope: {
      tierApplies: [...DEFAULT_TIER_SCOPE],
      categoryApplies: [...DEFAULT_CATEGORY_SCOPE],
    },
  };
}

/** True when the tier filter should hide rows for this section. */
export function tierFilterActive(config: ReportConfig, section: SectionKey) {
  return (
    config.filterScope.tierApplies.includes(section) &&
    config.filters.tiers.length > 0 &&
    config.filters.tiers.length < ALL_TIERS.length
  );
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
