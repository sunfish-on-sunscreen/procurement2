import { prisma } from "@/lib/prisma";
import { runComputeAnalyses } from "@/lib/python";

/** Per-period recompute timeout (ms) — a backstop so a hung Python can't hang the
 *  admin's request indefinitely. Generous, since Mode A also writes back metrics. */
const RECOMPUTE_PERIOD_TIMEOUT_MS = 60_000;

/**
 * Recompute every existing reporting period, then (only on full success) clear the
 * range cache — the SAME safe recipe the bulk import uses (compute_analyses per
 * period + drop the periodId=null range rows). This is the ONLY sanctioned recompute
 * path for a data change; do NOT use scripts/migrate-period-tags.ts (it clobbers
 * per-period SupplierMetric rows).
 *
 * Used after a supplier/purchase add/delete: the roster concentration signal (Kraljic
 * supply-risk + the composite's risk term) is computed from the GLOBAL supplier
 * roster and is period-independent, so an add or delete shifts scores in every
 * period. Runs periods SEQUENTIALLY to avoid python/DB contention, each with a
 * timeout backstop.
 *
 * Returns { ok, failedPeriods }. On ANY period failure the caller must surface a
 * real error (the data mutation itself already committed) — and we deliberately do
 * NOT clear the range cache, so range-mode views keep serving the last good cache
 * rather than rebuilding from now-stale/partial per-period rows.
 */
export async function recomputeAllPeriods(): Promise<{
  ok: boolean;
  failedPeriods: string[];
}> {
  const periods = await prisma.reportingPeriod.findMany({ select: { id: true, name: true } });

  const failedPeriods: string[] = [];
  for (const period of periods) {
    const result = await runComputeAnalyses(period.id, RECOMPUTE_PERIOD_TIMEOUT_MS);
    if (result.code !== 0) {
      failedPeriods.push(period.name);
      console.error(`recompute failed for period ${period.name}:`, result.stderr.slice(-500));
    }
  }

  // Invalidate the cached RANGE results ONLY when every period recomputed cleanly —
  // clearing them after a partial/failed recompute would force range-mode views to
  // rebuild from a DB whose per-period AnalysisResults are stale/partial.
  if (failedPeriods.length === 0) {
    await prisma.analysisResult.deleteMany({ where: { periodId: null } });
  }

  return { ok: failedPeriods.length === 0, failedPeriods };
}
