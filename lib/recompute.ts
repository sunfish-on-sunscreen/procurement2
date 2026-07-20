import { runSeedCompute, type SeedComputeSummary } from "@/lib/python";

/**
 * Recompute timeout (ms). Covers the WHOLE pipeline (SupplierMetric rewrite +
 * compute_analyses per period + range-cache clear), not one period. Measured at
 * ~5.5s on the current 647-PO dataset, so this is a generous backstop against a
 * hung Python rather than a realistic bound.
 */
const RECOMPUTE_TIMEOUT_MS = 180_000;

export type RecomputeResult =
  | { ok: true; summary: SeedComputeSummary }
  | { ok: false; error: string };

/**
 * Serialization chain. Two admins writing at once must NOT recompute concurrently —
 * `seed_compute` does delete-then-insert per period on SupplierMetric, so overlapping
 * runs would interleave writes. Each call queues behind the previous one (running
 * regardless of whether that one succeeded or failed). Recompute is idempotent, so a
 * redundant back-to-back run costs time but can't corrupt state.
 */
let chain: Promise<unknown> = Promise.resolve();

async function runOnce(): Promise<RecomputeResult> {
  const { code, summary, stderr } = await runSeedCompute(RECOMPUTE_TIMEOUT_MS);
  if (code !== 0 || !summary) {
    const detail = stderr.trim().slice(-800) || `exit code ${code}`;
    console.error("recompute failed:", detail);
    return { ok: false, error: detail };
  }
  return { ok: true, summary };
}

/**
 * Regenerate every derived artefact from the current normalized data: the per-period
 * SupplierMetric rows, the per-period AnalysisResult rows, and the range cache.
 * Delegates to `python/seed_compute.py` — the SAME pipeline the post-seed step runs —
 * so the scoring math is reused, never reimplemented here.
 *
 * Call this after ANY data mutation. The roster-concentration signal is global and
 * period-independent (one supplier changes supply-risk in every period) and the
 * ABC/Kraljic/zone splits are medians over the whole population, so there is no
 * correct incremental update — a full recompute is the only sound option.
 *
 * ⚠️ On failure the caller must surface a real error: the mutation that triggered
 * this has already committed, so the DB now holds data the analyses don't reflect.
 * The range cache is NOT cleared on failure (seed_compute clears it only as its last
 * step, after every period has recomputed cleanly), so range views keep serving the
 * last good cache instead of rebuilding from partial per-period rows.
 */
export function recomputeAllPeriods(): Promise<RecomputeResult> {
  const run = chain.then(runOnce, runOnce);
  chain = run.catch(() => {});
  return run;
}
