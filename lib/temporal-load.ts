import "server-only";
import { prisma } from "@/lib/prisma";
import {
  getAnalysisResult,
  type PerformanceSpendResult,
  type AbcResult,
} from "@/lib/analysis-types";
import {
  buildTemporalMatrix,
  PARTIAL_YEAR_SPEND_FRACTION,
  type TemporalLoad,
} from "@/lib/temporal-anomalies";

/**
 * Server-side loader for the temporal (year-over-year) comparison. Reads the
 * trustworthy per-period AnalysisResults (Purchase-derived), NOT the stored
 * SupplierMetric rows — so it's immune to the SupplierMetric lag. All reads are
 * cheap cached `getAnalysisResult` lookups; no compute, no new endpoint.
 *
 * PERIOD-AWARE — resolves which two periods to compare from the selected mode:
 *  - RANGE (no `selectedPeriodId`): the two most recent periods, but SKIPS a newest
 *    period that looks partial (total spend < PARTIAL_YEAR_SPEND_FRACTION of the
 *    prior's) so a sparse latest year doesn't make every supplier look like a huge
 *    drop → compares the two comparable full years, with a `skippedLabel` note.
 *  - SINGLE-YEAR (`selectedPeriodId` = year Y): compares Y vs the immediately-prior
 *    period. `no-prior` when Y is the earliest period; `partial-year` when Y itself
 *    is sparse vs its prior (a YoY compare would be a volume artifact — we surface a
 *    note rather than fire ~85%-of-roster fake drops). We can't step back here (the
 *    user explicitly chose Y), so the guard becomes a note instead of a re-pick.
 *
 * Returns `{kind:"insufficient"}` when fewer than two periods exist.
 */
export async function loadTemporalMatrix(
  opts?: { selectedPeriodId?: string },
): Promise<TemporalLoad> {
  const periods = await prisma.reportingPeriod.findMany({
    orderBy: { startDate: "asc" },
    select: { id: true, name: true },
  });
  if (periods.length < 2) return { kind: "insufficient" };

  // Load each period's perf (cached) to compute totals for the partial-year guard.
  const perfs = await Promise.all(
    periods.map((p) => getAnalysisResult<PerformanceSpendResult>(p.id, "performance_spend")),
  );
  const totals = perfs.map((pf) => (pf?.suppliers ?? []).reduce((s, x) => s + x.total_spend_usd, 0));

  let li: number; // latest / selected
  let pi: number; // prior
  let skippedLabel: string | null = null;

  const selectedId = opts?.selectedPeriodId;
  if (selectedId) {
    // SINGLE-YEAR: compare the selected year vs the immediately-prior period.
    const idx = periods.findIndex((p) => p.id === selectedId);
    if (idx < 0) return { kind: "insufficient" }; // selected period unknown (shouldn't happen)
    if (idx === 0) return { kind: "no-prior", label: periods[idx].name };
    li = idx;
    pi = idx - 1;
    // Partial-year trap: a sparse selected year vs a full prior is a volume artifact.
    if (totals[pi] > 0 && totals[li] < PARTIAL_YEAR_SPEND_FRACTION * totals[pi]) {
      return { kind: "partial-year", label: periods[li].name, priorLabel: periods[pi].name };
    }
  } else {
    // RANGE: latest two, skipping a partial newest year (unchanged behavior).
    li = periods.length - 1;
    pi = periods.length - 2;
    if (periods.length >= 3 && totals[pi] > 0 && totals[li] < PARTIAL_YEAR_SPEND_FRACTION * totals[pi]) {
      skippedLabel = periods[li].name;
      li = pi;
      pi = pi - 1;
    }
  }

  const latestAbc = await getAnalysisResult<AbcResult>(periods[li].id, "abc");

  return {
    kind: "ok",
    matrix: buildTemporalMatrix({
      latest: { label: periods[li].name, perf: perfs[li], abc: latestAbc },
      prior: { label: periods[pi].name, perf: perfs[pi] },
      skippedLabel,
    }),
  };
}
