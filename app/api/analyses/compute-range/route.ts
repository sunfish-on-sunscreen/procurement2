import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { Prisma } from "@/lib/generated/prisma/client";
import { runComputeRange } from "@/lib/python";

export const runtime = "nodejs";

const dateField = z
  .string()
  .refine((s) => /^\d{4}-\d{2}-\d{2}/.test(s), "Expected YYYY-MM-DD")
  .transform((s) => s.slice(0, 10));

const bodySchema = z.object({ startDate: dateField, endDate: dateField });

// The six analyses a range compute produces (Python Mode B output keys).
const RANGE_TYPES = [
  "spend_overview",
  "abc",
  "hypothesis",
  "performance_spend",
  "kraljic",
  "recommendations",
] as const;

export async function POST(request: Request) {
  // Any authenticated user may compute a range.
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid date range" }, { status: 400 });
  }
  const { startDate, endDate } = parsed.data;
  const rangeStartDate = new Date(startDate);
  const rangeEndDate = new Date(endDate);

  // 1. Cache hit? Return immediately if all six analyses are cached for this range.
  const cached = await prisma.analysisResult.findMany({
    where: { rangeStartDate, rangeEndDate },
    select: { analysisType: true, resultJson: true },
  });
  if (cached.length >= RANGE_TYPES.length) {
    const byType = new Map(cached.map((r) => [r.analysisType, r.resultJson]));
    if (RANGE_TYPES.every((t) => byType.has(t))) {
      const payload = Object.fromEntries(
        RANGE_TYPES.map((t) => [t, byType.get(t)]),
      );
      return NextResponse.json(payload);
    }
  }

  // 2. Cache miss: spawn Python, then cache each result before returning.
  const result = await runComputeRange(startDate, endDate, 30000);
  if (result.code !== 0) {
    console.error("compute-range failed:", result.stderr);
    return NextResponse.json(
      { error: "Range computation failed", detail: result.stderr.slice(-500) },
      { status: 500 },
    );
  }

  let data: Record<string, unknown>;
  try {
    data = JSON.parse(result.stdout) as Record<string, unknown>;
  } catch {
    console.error(
      "compute-range produced non-JSON stdout:",
      result.stdout.slice(0, 300),
      result.stderr.slice(-300),
    );
    return NextResponse.json(
      { error: "Could not parse analysis output" },
      { status: 500 },
    );
  }

  // Cache every non-null analysis for this range (keyed by the range dates).
  await Promise.all(
    RANGE_TYPES.filter((t) => data[t] != null).map((t) => {
      const resultJson = data[t] as Prisma.InputJsonValue;
      return prisma.analysisResult.upsert({
        where: {
          rangeStartDate_rangeEndDate_analysisType: {
            rangeStartDate,
            rangeEndDate,
            analysisType: t,
          },
        },
        update: { resultJson, computedAt: new Date() },
        create: {
          analysisType: t,
          periodId: null,
          rangeStartDate,
          rangeEndDate,
          resultJson,
        },
      });
    }),
  );

  return NextResponse.json(data);
}
