import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { runCycleCompare } from "@/lib/python";
import type { PeriodComparison } from "@/lib/analysis-types";

export const runtime = "nodejs";

const dateField = z
  .string()
  .refine((s) => /^\d{4}-\d{2}-\d{2}$/.test(s), "Expected YYYY-MM-DD");

const bodySchema = z.object({
  comparison_start_a: dateField,
  comparison_end_a: dateField,
  comparison_start_b: dateField,
  comparison_end_b: dateField,
});

export async function POST(request: Request) {
  // Any authenticated user (admin or viewer) may run a comparison.
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
    return NextResponse.json(
      { error: "Four well-formed dates (YYYY-MM-DD) are required" },
      { status: 400 },
    );
  }
  const {
    comparison_start_a: startA,
    comparison_end_a: endA,
    comparison_start_b: startB,
    comparison_end_b: endB,
  } = parsed.data;

  // 1. end >= start for each window.
  if (endA < startA || endB < startB) {
    return NextResponse.json(
      { error: "Each window's end date must be on or after its start date" },
      { status: 400 },
    );
  }

  // 2. Dates must fall within the available data span (friendly guard).
  const bounds = await prisma.$queryRaw<{ lo: Date | null; hi: Date | null }[]>`
    SELECT MIN("prDate") AS lo, MAX(COALESCE("invoiceDate", "prDate")) AS hi
    FROM "Purchase"
  `;
  const lo = bounds[0]?.lo;
  const hi = bounds[0]?.hi;
  if (lo && hi) {
    const loStr = lo.toISOString().slice(0, 10);
    const hiStr = hi.toISOString().slice(0, 10);
    const all = [startA, endA, startB, endB];
    if (all.some((d) => d < loStr || d > hiStr)) {
      return NextResponse.json(
        {
          error: `Dates must fall within the available data range (${loStr} to ${hiStr})`,
        },
        { status: 400 },
      );
    }
  }

  // 3. Overlap is allowed but flagged (the user may intend it).
  const overlaps = startA <= endB && startB <= endA;
  const warning = overlaps
    ? "The two windows overlap; some POs are counted in both groups."
    : undefined;

  // 4. Spawn Python (Mode B, no caching) and pull out only the comparison block.
  const result = await runCycleCompare({ startA, endA, startB, endB });
  if (result.code !== 0) {
    console.error("cycle-compare failed:", result.stderr.slice(-500));
    return NextResponse.json(
      { error: "Comparison computation failed" },
      { status: 500 },
    );
  }

  let data: { cycle_time?: { period_comparison?: PeriodComparison } };
  try {
    data = JSON.parse(result.stdout);
  } catch {
    console.error("cycle-compare non-JSON stdout:", result.stdout.slice(0, 300));
    return NextResponse.json(
      { error: "Comparison computation failed" },
      { status: 500 },
    );
  }

  const comparison = data.cycle_time?.period_comparison;
  if (!comparison) {
    return NextResponse.json(
      { error: "Comparison computation returned no result" },
      { status: 500 },
    );
  }

  return NextResponse.json({ period_comparison: comparison, warning });
}
