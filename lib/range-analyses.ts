import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { runComputeRange } from "@/lib/python";
import type { RangeAnalyses } from "@/lib/analysis-types";

// The SEVEN analyses a range compute produces (Python Mode B output keys).
//
// ⚠️ THIS LIST MUST MATCH `all_types` IN python/compute_analyses.py. It governs BOTH
// halves of the cache: the read side requires every entry to be present before a
// cached set is accepted, and the write side persists only these keys. Let it fall
// behind Python and the two halves disagree — a cache MISS returns the full Python
// output while a cache HIT returns the shorter cached set, so the same span yields a
// different key set depending only on whether it had been computed before. Adding an
// entry is self-healing: existing cached spans now fail the completeness check below
// and are recomputed on next read.
export const RANGE_TYPES = [
  "spend_overview",
  "abc",
  "cycle_time",
  "performance_spend",
  "kraljic",
  "recommendations",
  "sourcing_coverage",
] as const;

/**
 * Returns the six range analyses for a date span — from the cache if present,
 * otherwise by spawning Python (and caching the result). Used by both the
 * compute-range API and ephemeral report generation. Null on compute failure.
 */
export async function getRangeAnalyses(
  startDate: string,
  endDate: string,
): Promise<RangeAnalyses | null> {
  const rangeStartDate = new Date(startDate);
  const rangeEndDate = new Date(endDate);

  const cached = await prisma.analysisResult.findMany({
    where: { rangeStartDate, rangeEndDate },
    select: { analysisType: true, resultJson: true },
  });
  if (cached.length >= RANGE_TYPES.length) {
    const byType = new Map(cached.map((r) => [r.analysisType, r.resultJson]));
    if (RANGE_TYPES.every((t) => byType.has(t))) {
      return Object.fromEntries(
        RANGE_TYPES.map((t) => [t, byType.get(t)]),
      ) as unknown as RangeAnalyses;
    }
  }

  const result = await runComputeRange(startDate, endDate, 30000);
  if (result.code !== 0) {
    console.error("getRangeAnalyses compute failed:", result.stderr.slice(-500));
    return null;
  }
  let data: Record<string, unknown>;
  try {
    data = JSON.parse(result.stdout) as Record<string, unknown>;
  } catch {
    console.error("getRangeAnalyses non-JSON stdout:", result.stdout.slice(0, 300));
    return null;
  }

  await Promise.all(
    RANGE_TYPES.filter((t) => data[t] != null).map((t) =>
      prisma.analysisResult.upsert({
        where: {
          rangeStartDate_rangeEndDate_analysisType: {
            rangeStartDate,
            rangeEndDate,
            analysisType: t,
          },
        },
        update: {
          resultJson: data[t] as Prisma.InputJsonValue,
          computedAt: new Date(),
        },
        create: {
          analysisType: t,
          periodId: null,
          rangeStartDate,
          rangeEndDate,
          resultJson: data[t] as Prisma.InputJsonValue,
        },
      }),
    ),
  );

  return data as unknown as RangeAnalyses;
}
