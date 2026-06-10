import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { runComputeRange } from "@/lib/python";

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

  const result = await runComputeRange(startDate, endDate, 30000);
  if (result.code !== 0) {
    console.error("compute-range failed:", result.stderr);
    return NextResponse.json(
      { error: "Range computation failed", detail: result.stderr.slice(-500) },
      { status: 500 },
    );
  }

  try {
    return NextResponse.json(JSON.parse(result.stdout));
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
}
