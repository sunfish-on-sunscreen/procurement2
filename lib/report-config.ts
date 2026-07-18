/**
 * Client-safe report customization config. No server-only imports so the sidebar
 * + the shared <ReportDocument> renderer can use it freely.
 *
 * The report is a decision-first ARGUMENT (see lib/report-narrative), not a table
 * dump — so the config is four questions: what it's about (focus), which period,
 * how long (detail), and which appendix evidence to attach (sections). Tone is a
 * minor prose-register control. The old recommendation/category filters + per-section
 * scope were REMOVED: the argument reads only the analyses + tone, so filtering rows
 * could never change a finding — it was dashboard behaviour leaking into a document.
 */
import type { PeriodSelection } from "@/lib/period-constants";

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

/**
 * What the report is ABOUT (Focus). `portfolio` = the full review (default);
 * `supplier` = a one-supplier brief; `category` = a category deep-dive. The picker
 * IDs are validated at render time (an absent supplier/category falls back
 * gracefully to the portfolio view).
 */
export type ReportFocus =
  | { kind: "portfolio" }
  | { kind: "supplier"; supplierId: string }
  | { kind: "category"; category: string };

export interface ReportConfig {
  period: PeriodSelection;
  focus: ReportFocus;
  /**
   * Appendix "evidence" toggles (only meaningful at standard/detailed — brief drops
   * the appendix entirely). `executiveSummary` is the always-on front matter. In
   * supplier/category focus the portfolio-wide evidence is hidden; only Methodology
   * applies (see ReportDocument).
   */
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
  detailLevel: DetailLevel;
  tone: ReportTone;
}

export const SECTION_LABELS: Record<SectionKey, string> = {
  spendOverview: "Spend Overview",
  abc: "ABC Analysis",
  kraljic: "Supplier Quadrant",
  performanceSpend: "Performance vs Spend",
  cycleTime: "Cycle Time",
  actionDashboard: "Action Priorities",
  methodology: "Methodology",
};

const ALL_SECTIONS_ON: ReportConfig["sections"] = {
  executiveSummary: true,
  spendOverview: true,
  abc: true,
  kraljic: true,
  performanceSpend: true,
  cycleTime: true,
  actionDashboard: true,
  methodology: true,
};

export function defaultReportConfig(period: PeriodSelection): ReportConfig {
  return {
    period,
    focus: { kind: "portfolio" },
    sections: { ...ALL_SECTIONS_ON },
    detailLevel: "standard",
    tone: "operational",
  };
}

/**
 * Normalise a persisted config into the current shape. Reports saved before this
 * rebuild carry the OLD shape — no `focus`, plus the removed `recommendationFilters`
 * / `filters` / `filterScope` fields. Those old reports default to portfolio focus;
 * the removed fields are simply dropped (they were dead, or only hid appendix rows,
 * so the rendered argument is unchanged). Missing sections/detail/tone fall back to
 * the defaults, preserving backward compatibility.
 */
export function normalizeReportConfig(
  raw: Partial<ReportConfig> & { period: PeriodSelection },
): ReportConfig {
  return {
    period: raw.period,
    focus: raw.focus ?? { kind: "portfolio" },
    sections: { ...ALL_SECTIONS_ON, ...(raw.sections ?? {}) },
    detailLevel: raw.detailLevel ?? "standard",
    tone: raw.tone ?? "operational",
  };
}
