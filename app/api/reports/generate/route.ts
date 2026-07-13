import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import {
  getAnalysisResult,
  type SpendOverviewResult,
  type AbcResult,
  type KraljicResult,
  type CycleTimeResult,
  type PerformanceSpendResult,
  type RecommendationsResult,
} from "@/lib/analysis-types";
import type { ReportConfig } from "@/lib/report-config";
import { Prisma } from "@/lib/generated/prisma/client";

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
  const config = (body as { config?: ReportConfig } | null)?.config;
  if (!config || typeof config !== "object") {
    return NextResponse.json({ error: "Missing config" }, { status: 400 });
  }
  if (config.period.mode !== "single") {
    return NextResponse.json(
      { error: "Range reports are not persisted — preview them in the report editor." },
      { status: 400 },
    );
  }
  const periodId = config.period.singleId;
  if (!periodId) {
    return NextResponse.json({ error: "No period selected" }, { status: 400 });
  }

  const period = await prisma.reportingPeriod.findUnique({ where: { id: periodId } });
  if (!period) {
    return NextResponse.json({ error: "Reporting period not found" }, { status: 400 });
  }

  const [spendOverview, abc, kraljic, performanceSpend, cycleTime, recommendations] =
    await Promise.all([
      getAnalysisResult<SpendOverviewResult>(periodId, "spend_overview"),
      getAnalysisResult<AbcResult>(periodId, "abc"),
      getAnalysisResult<KraljicResult>(periodId, "kraljic"),
      getAnalysisResult<PerformanceSpendResult>(periodId, "performance_spend"),
      getAnalysisResult<CycleTimeResult>(periodId, "cycle_time"),
      getAnalysisResult<RecommendationsResult>(periodId, "recommendations"),
    ]);

  if (
    !spendOverview ||
    !abc ||
    !kraljic ||
    !performanceSpend ||
    !cycleTime ||
    !recommendations
  ) {
    return NextResponse.json(
      {
        error:
          "Compute analyses first by running an import or selecting Range mode.",
      },
      { status: 400 },
    );
  }

  const today = new Date().toISOString().slice(0, 10);
  const summary = await prisma.executiveSummary.create({
    data: {
      periodId,
      title: `Executive Summary — ${period.name} — ${today}`,
      // The report renders LIVE from the analyses (ReportDocument + the argument
      // model in lib/report-narrative); the `narrative` column is legacy and never
      // displayed, so it holds only a stub. The detail page reads metricsJson for
      // the customization `config` and the `cycle_framing` marker — nothing else.
      narrative: `Procurement report for ${period.name} — rendered live from the analyses.`,
      metricsJson: { config, cycle_framing: "monitoring" } as unknown as Prisma.InputJsonValue,
      generatedBy: session.userId,
    },
    select: { id: true },
  });

  return NextResponse.json({ id: summary.id, redirect: `/reports/${summary.id}` });
}
