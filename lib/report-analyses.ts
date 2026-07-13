import "server-only";
import { getRangeAnalyses } from "@/lib/range-analyses";
import { computeCycleBreakdown } from "@/lib/cycle-breakdown";
import { loadTemporalMatrix } from "@/lib/temporal-load";
import type { RangeAnalyses } from "@/lib/analysis-types";
import type { CycleBreakdown } from "@/lib/cycle-time-types";
import type { TemporalLoad } from "@/lib/temporal-anomalies";

/** The six range analyses (non-null fields) + the anomaly-hub extras. Structurally
 *  assignable to ReportAnalyses (whose fields are nullable), while keeping the
 *  non-null-ness generateExecutiveSummary relies on. */
export type ReportRangeAnalyses = RangeAnalyses & {
  breakdown: CycleBreakdown;
  // Discriminated, period-aware TemporalLoad (NOT an unwrapped matrix) so the report
  // can render the same note states the live page does (no-prior / partial-year /
  // insufficient) without a client fetch.
  temporal: TemporalLoad;
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
 * failure (the caller surfaces the error). temporal is `{kind:"insufficient"}` when
 * fewer than two periods exist.
 *
 * PERIOD-AWARE temporal (mirrors the live Action Priorities hub): pass
 * `selectedPeriodId` for a SINGLE-YEAR report → the temporal family compares that
 * year vs its prior (with the no-prior / partial-year note states); OMIT it for a
 * range report → latest-vs-prior with the partial-year skip (unchanged). The WHOLE
 * discriminated TemporalLoad is returned so every render path (incl. static PDF
 * export) has the note states without a client fetch.
 */
export async function assembleReportRangeAnalyses(
  startDate: string,
  endDate: string,
  opts?: { selectedPeriodId?: string },
): Promise<ReportRangeAnalyses | null> {
  const analyses = await getRangeAnalyses(startDate, endDate);
  if (!analyses) return null;

  const [breakdown, temporal] = await Promise.all([
    computeCycleBreakdown(startDate, endDate, {
      abc: analyses.abc,
      performance_spend: analyses.performance_spend,
    }),
    loadTemporalMatrix(
      opts?.selectedPeriodId ? { selectedPeriodId: opts.selectedPeriodId } : undefined,
    ),
  ]);

  return { ...analyses, breakdown, temporal };
}
