/**
 * Quick-view pills (Batch 6d): code-defined report "shapes" — a combination of
 * section visibility + tone + detail level. Pills deliberately do NOT touch the
 * period or the category filter (those are contextual to what the user is
 * analysing). Applying a pill spreads its shape over the current config.
 */
import type {
  ReportConfig,
  ReportTone,
  DetailLevel,
} from "@/lib/report-config";

// The 7 toggleable sections (executiveSummary is always on, so it's excluded).
export type PillSections = Omit<ReportConfig["sections"], "executiveSummary">;

export type ReportPill = {
  id: string;
  label: string;
  description: string;
  sections: PillSections;
  tone: ReportTone;
  detailLevel: DetailLevel;
};

export const REPORT_PILLS: ReportPill[] = [
  {
    id: "exec-snapshot",
    label: "Executive snapshot",
    description: "Brief executive summary only",
    sections: {
      spendOverview: false,
      abc: false,
      kraljic: false,
      performanceSpend: false,
      cycleTime: false,
      actionDashboard: false,
      methodology: false,
    },
    tone: "executive",
    detailLevel: "brief",
  },
  {
    id: "operational-deep",
    label: "Operational deep-dive",
    description: "Full operational analysis",
    sections: {
      spendOverview: true,
      abc: true,
      kraljic: true,
      performanceSpend: true,
      cycleTime: true,
      actionDashboard: true,
      methodology: false,
    },
    tone: "operational",
    detailLevel: "standard",
  },
  {
    id: "statistical",
    label: "Statistical analysis",
    description: "Detailed analytical view with methodology",
    sections: {
      spendOverview: true,
      abc: true,
      kraljic: true,
      performanceSpend: true,
      cycleTime: true,
      actionDashboard: true,
      methodology: true,
    },
    tone: "analytical",
    detailLevel: "detailed",
  },
  {
    id: "action-plan",
    label: "Action plan focus",
    description: "Executive + Action Priorities + Methodology",
    sections: {
      spendOverview: false,
      abc: false,
      kraljic: false,
      performanceSpend: false,
      cycleTime: false,
      actionDashboard: true,
      methodology: true,
    },
    tone: "operational",
    detailLevel: "standard",
  },
  {
    id: "spend-focus",
    label: "Spend focus",
    description: "Spend Overview + ABC analysis",
    sections: {
      spendOverview: true,
      abc: true,
      kraljic: false,
      performanceSpend: false,
      cycleTime: false,
      actionDashboard: false,
      methodology: true,
    },
    tone: "operational",
    detailLevel: "standard",
  },
];

const PILL_SECTION_KEYS = Object.keys(
  REPORT_PILLS[0].sections,
) as (keyof PillSections)[];

/**
 * True when the config's sections (the 7 toggleable ones) + tone + detail level
 * EXACTLY match the pill's shape. Exact match, not fuzzy — any manual deviation
 * un-matches the pill.
 */
export function isPillActive(config: ReportConfig, pill: ReportPill): boolean {
  if (config.tone !== pill.tone) return false;
  if (config.detailLevel !== pill.detailLevel) return false;
  return PILL_SECTION_KEYS.every(
    (k) => config.sections[k] === pill.sections[k],
  );
}

/** The pill whose shape the config currently matches, or null. */
export function activePill(config: ReportConfig): ReportPill | null {
  return REPORT_PILLS.find((p) => isPillActive(config, p)) ?? null;
}

/**
 * Apply a pill's shape over a config, preserving period + filters + filterScope.
 * executiveSummary stays on (always).
 */
export function applyPill(config: ReportConfig, pill: ReportPill): ReportConfig {
  return {
    ...config,
    sections: { executiveSummary: true, ...pill.sections },
    tone: pill.tone,
    detailLevel: pill.detailLevel,
  };
}
