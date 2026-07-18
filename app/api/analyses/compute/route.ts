import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { runComputeAnalyses } from "@/lib/python";

export const runtime = "nodejs";

export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const periodId =
    body && typeof body === "object" && "periodId" in body
      ? (body as { periodId?: unknown }).periodId
      : undefined;

  if (typeof periodId !== "string" || periodId.length === 0) {
    return NextResponse.json({ error: "Missing periodId" }, { status: 400 });
  }

  const period = await prisma.reportingPeriod.findUnique({ where: { id: periodId } });
  if (!period) {
    return NextResponse.json({ error: "Reporting period not found" }, { status: 400 });
  }

  const result = await runComputeAnalyses(periodId);
  if (result.code !== 0) {
    console.error("compute_analyses failed:", result.stderr);
    return NextResponse.json(
      { error: "Analysis computation failed", detail: result.stderr.slice(-500) },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, analyses_computed: true });
}
