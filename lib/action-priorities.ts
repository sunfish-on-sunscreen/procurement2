import type { RecommendationCategory } from "@/lib/analysis-types";

/**
 * Shared presentation metadata for the Action Priorities categories — one source
 * of truth for the view + the card. Colours are theme tokens (--priority-*), so
 * they're dark-mode safe (no hardcoded hex). Display order = most urgent first.
 */
export const CATEGORY_ORDER: RecommendationCategory[] = [
  "critical_issues_engagement",
  "bottleneck_risk",
  "hidden_gems_promotion",
  "process_improvement",
  "concentration",
];

export const CATEGORY_LABEL: Record<RecommendationCategory, string> = {
  critical_issues_engagement: "Critical Issues Engagement",
  bottleneck_risk: "Bottleneck Risk Mitigation",
  hidden_gems_promotion: "Hidden Gems Promotion",
  process_improvement: "Process Improvement",
  concentration: "Concentration",
};

/** CSS custom-property references (theme-aware, light + dark). */
export const CATEGORY_COLOR_VAR: Record<RecommendationCategory, string> = {
  critical_issues_engagement: "var(--priority-engage)",
  bottleneck_risk: "var(--priority-mitigate)",
  hidden_gems_promotion: "var(--priority-promote)",
  process_improvement: "var(--priority-improve)",
  concentration: "var(--priority-concentrate)",
};

/** One-line "why this matters" framing shown under each section heading. */
export const CATEGORY_WHY: Record<RecommendationCategory, string> = {
  critical_issues_engagement:
    "The widest gap between what you pay and what you get — high-spend suppliers performing below the portfolio median.",
  bottleneck_risk:
    "Low-spend but hard to replace — high supply risk with few ready alternatives.",
  hidden_gems_promotion:
    "Strong performers you're barely using — room to shift more spend their way.",
  process_improvement:
    "Internal process friction slowing the procure-to-pay cycle.",
  concentration:
    "Where spend is most concentrated — resilience exposure, not performance.",
};

/** One generic, light soft-nudge per category (same for every card in it). */
export const CATEGORY_NUDGE: Record<RecommendationCategory, string> = {
  critical_issues_engagement: "Suggested: performance review before renewal.",
  bottleneck_risk: "Suggested: line up a qualified second source.",
  hidden_gems_promotion: "Suggested: evaluate for an expanded share of wallet.",
  process_improvement: "Suggested: review the flagged stage's handoffs.",
  concentration: "Suggested: diversification / second-source review.",
};
