import { prisma } from "@/lib/prisma";
import { runComputeAnalyses } from "@/lib/python";

/**
 * Recompute every existing reporting period, then clear the range cache — the
 * SAME safe recipe the bulk import uses (compute_analyses per period + drop the
 * periodId=null range rows). This is the ONLY sanctioned recompute path for a
 * data change; do NOT use scripts/migrate-period-tags.ts (it clobbers per-period
 * SupplierMetric rows).
 *
 * Used after a supplier edit/delete: the roster concentration signal (Kraljic
 * supply-risk + the composite's risk term) is computed from the GLOBAL supplier
 * roster and is period-independent, so a category/country edit or a delete shifts
 * scores in every period. Runs periods SEQUENTIALLY to avoid python/DB contention.
 *
 * Returns { ok, failedPeriods } — ok is false if any period's compute failed
 * (the data mutation itself already succeeded; the caller surfaces a soft warning).
 */
export async function recomputeAllPeriods(): Promise<{
  ok: boolean;
  failedPeriods: string[];
}> {
  const periods = await prisma.reportingPeriod.findMany({ select: { id: true, name: true } });

  const failedPeriods: string[] = [];
  for (const period of periods) {
    const result = await runComputeAnalyses(period.id);
    if (result.code !== 0) {
      failedPeriods.push(period.name);
      console.error(`recompute failed for period ${period.name}:`, result.stderr.slice(-500));
    }
  }

  // Invalidate the cached RANGE results so range-mode views recompute Mode B from
  // the now-updated DB on next view (periodId IS NULL rows are the range cache).
  await prisma.analysisResult.deleteMany({ where: { periodId: null } });

  return { ok: failedPeriods.length === 0, failedPeriods };
}
