import "server-only";
import { getRangeAnalyses } from "@/lib/range-analyses";
import { computeCycleBreakdown } from "@/lib/cycle-breakdown";
import { loadTemporalMatrix } from "@/lib/temporal-load";
import type { RangeAnalyses } from "@/lib/analysis-types";
import type { CycleBreakdown } from "@/lib/cycle-time-types";
import type { TemporalMatrix } from "@/lib/temporal-anomalies";

/** The six range analyses (non-null fields) + the anomaly-hub extras. Structurally
 *  assignable to ReportAnalyses (whose fields are nullable), while keeping the
 *  non-null-ness generateExecutiveSummary relies on. */
export type ReportRangeAnalyses = RangeAnalyses & {
  breakdown: CycleBreakdown;
  temporal: TemporalMatrix | null;
};

/**
 * Assemble the FULL report analyses for a RANGE span: the six range analyses
 * (getRangeAnalyses) PLUS the anomaly-hub extras the report needs to render all
 * three families server-side — the cycle-time `breakdown` (process family) and the
 * latest-vs-prior `temporal` matrix (changed-over-time family). Everything is
 * computed HERE so it's present in the report data at render time, working in every
 * render path INCLUDING static PDF export (no client fetch). Used by the report
 * analyses endpoint (editor) and the ephemeral (range) report route.
 *
 * The range analyses are loaded once and passed into computeCycleBreakdown so the
 * breakdown's roster join doesn't re-load them. Returns null on range-compute
 * failure (the caller surfaces the error). temporal is null when <2 periods exist.
 */
export async function assembleReportRangeAnalyses(
  startDate: string,
  endDate: string,
): Promise<ReportRangeAnalyses | null> {
  const analyses = await getRangeAnalyses(startDate, endDate);
  if (!analyses) return null;

  const [breakdown, temporalLoad] = await Promise.all([
    computeCycleBreakdown(startDate, endDate, {
      abc: analyses.abc,
      performance_spend: analyses.performance_spend,
    }),
    // Reports' temporal family is RANGE-only — the no-arg load keeps the existing
    // latest-vs-prior (partial-year-guarded) behavior. Unwrap to the raw matrix
    // (the report renders it directly; the single-year note states don't apply).
    loadTemporalMatrix(),
  ]);
  const temporal = temporalLoad.kind === "ok" ? temporalLoad.matrix : null;

  return { ...analyses, breakdown, temporal };
}
