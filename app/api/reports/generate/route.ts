import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import {
  getAnalysisResult,
  type SpendOverviewResult,
  type AbcResult,
  type ClusteringResult,
  type HypothesisResult,
} from "@/lib/analysis-types";
import { generateExecutiveSummary } from "@/lib/report-templates";

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

  const [spendOverview, abc, clustering, hypothesis] = await Promise.all([
    getAnalysisResult<SpendOverviewResult>(periodId, "spend_overview"),
    getAnalysisResult<AbcResult>(periodId, "abc"),
    getAnalysisResult<ClusteringResult>(periodId, "clustering"),
    getAnalysisResult<HypothesisResult>(periodId, "hypothesis"),
  ]);

  if (!spendOverview || !abc || !clustering || !hypothesis) {
    return NextResponse.json(
      { error: "Compute analyses first before generating a summary." },
      { status: 400 },
    );
  }

  const { narrative, metrics } = generateExecutiveSummary({
    period: {
      name: period.name,
      startDate: period.startDate.toISOString(),
      endDate: period.endDate.toISOString(),
    },
    spendOverview,
    abc,
    clustering,
    hypothesis,
  });

  const today = new Date().toISOString().slice(0, 10);
  const summary = await prisma.executiveSummary.create({
    data: {
      periodId,
      title: `Executive Summary — ${period.name} — ${today}`,
      narrative,
      metricsJson: metrics,
      generatedBy: session.userId,
    },
    select: { id: true },
  });

  return NextResponse.json({ id: summary.id, redirect: `/reports/${summary.id}` });
}
