import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { runComputeRange } from "@/lib/python";
import type { RangeAnalyses } from "@/lib/analysis-types";

// The six analyses a range compute produces (Python Mode B output keys).
export const RANGE_TYPES = [
  "spend_overview",
  "abc",
  "cycle_time",
  "performance_spend",
  "kraljic",
  "recommendations",
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
