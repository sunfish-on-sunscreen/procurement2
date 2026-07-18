import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { getRangeAnalyses } from "@/lib/range-analyses";

export const runtime = "nodejs";

const dateField = z
  .string()
  .refine((s) => /^\d{4}-\d{2}-\d{2}/.test(s), "Expected YYYY-MM-DD")
  .transform((s) => s.slice(0, 10));

const bodySchema = z.object({ startDate: dateField, endDate: dateField });

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

  // Returns cached results immediately, or computes + caches on a miss.
  const data = await getRangeAnalyses(startDate, endDate);
  if (!data) {
    return NextResponse.json(
      { error: "Range computation failed" },
      { status: 500 },
    );
  }
  return NextResponse.json(data);
}
