import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { computeCycleBreakdown } from "@/lib/cycle-breakdown";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Per-supplier + per-category cycle-time breakdown for the selected span. Thin
 * wrapper around lib/cycle-breakdown's computeCycleBreakdown (extracted so the
 * SAME computation serves this route AND server-side report assembly). Login
 * required; any role.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = new URL(request.url).searchParams;
  const start = sp.get("start");
  const end = sp.get("end");
  if (!start || !end || !DATE_RE.test(start) || !DATE_RE.test(end)) {
    return NextResponse.json(
      { error: "start and end must both be YYYY-MM-DD" },
      { status: 400 },
    );
  }
  if (end < start) {
    return NextResponse.json(
      { error: "end must be on or after start" },
      { status: 400 },
    );
  }

  const result = await computeCycleBreakdown(start, end);
  return NextResponse.json(result);
}
