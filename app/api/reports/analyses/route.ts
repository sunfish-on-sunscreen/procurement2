import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { assembleReportRangeAnalyses } from "@/lib/report-analyses";

export const runtime = "nodejs";

const dateField = z
  .string()
  .refine((s) => /^\d{4}-\d{2}-\d{2}/.test(s), "Expected YYYY-MM-DD")
  .transform((s) => s.slice(0, 10));

const bodySchema = z.object({ startDate: dateField, endDate: dateField });

/**
 * Report-specific analyses for a span: the six range analyses PLUS the anomaly-hub
 * extras (breakdown + temporal). The report editor fetches THIS (not the dashboard's
 * compute-range) so the anomaly families are present at render time — incl. PDF
 * export. Kept separate from compute-range so non-report pages don't over-compute
 * the breakdown/temporal. Any authenticated user (same as compute-range).
 */
export async function POST(request: Request) {
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

  const data = await assembleReportRangeAnalyses(startDate, endDate);
  if (!data) {
    return NextResponse.json(
      { error: "Range computation failed" },
      { status: 500 },
    );
  }
  return NextResponse.json(data);
}
