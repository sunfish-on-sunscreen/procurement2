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
  type TemporalMatrix,
} from "@/lib/temporal-anomalies";

/**
 * Server-side loader for the temporal (latest-vs-prior) matrix. Reads the
 * trustworthy per-period AnalysisResults (Purchase-derived), NOT the stored
 * SupplierMetric rows — so it's immune to the SupplierMetric lag. All reads are
 * cheap cached `getAnalysisResult` lookups; no compute, no new endpoint.
 *
 * Picks the two most recent periods, but SKIPS a newest period that looks partial
 * (total spend < PARTIAL_YEAR_SPEND_FRACTION of the prior's) so a sparse latest
 * year doesn't make every supplier look like a huge drop. Returns null when fewer
 * than two periods exist (the caller renders a "needs ≥2 periods" state).
 */
export async function loadTemporalMatrix(): Promise<TemporalMatrix | null> {
  const periods = await prisma.reportingPeriod.findMany({
    orderBy: { startDate: "asc" },
    select: { id: true, name: true },
  });
  if (periods.length < 2) return null;

  // Load each period's perf (cached) to compute totals for the partial-year guard.
  const perfs = await Promise.all(
    periods.map((p) => getAnalysisResult<PerformanceSpendResult>(p.id, "performance_spend")),
  );
  const totals = perfs.map((pf) => (pf?.suppliers ?? []).reduce((s, x) => s + x.total_spend_usd, 0));

  let li = periods.length - 1; // latest
  let pi = periods.length - 2; // prior
  let skippedLabel: string | null = null;
  if (periods.length >= 3 && totals[pi] > 0 && totals[li] < PARTIAL_YEAR_SPEND_FRACTION * totals[pi]) {
    // Newest period is partial — step back one so we compare two comparable years.
    skippedLabel = periods[li].name;
    li = pi;
    pi = pi - 1;
  }

  const latestAbc = await getAnalysisResult<AbcResult>(periods[li].id, "abc");

  return buildTemporalMatrix({
    latest: { label: periods[li].name, perf: perfs[li], abc: latestAbc },
    prior: { label: periods[pi].name, perf: perfs[pi] },
    skippedLabel,
  });
}
