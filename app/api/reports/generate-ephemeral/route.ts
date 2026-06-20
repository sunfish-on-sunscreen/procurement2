import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { resolveAnalysisSource } from "@/lib/period";
import { getRangeAnalyses } from "@/lib/range-analyses";
import { getSupplierCategoryMap } from "@/lib/suppliers";
import { generateExecutiveSummary } from "@/lib/report-templates";
import type { ReportConfig } from "@/lib/report-config";

export const runtime = "nodejs";

// Range reports are NOT persisted: this returns everything the in-memory
// /reports/preview page needs to render + export, without touching the
// ExecutiveSummary table.
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
  if (!config || config.period?.mode !== "range") {
    return NextResponse.json(
      { error: "This endpoint is for range reports only." },
      { status: 400 },
    );
  }

  const source = await resolveAnalysisSource(config.period);
  if (source.kind !== "range") {
    return NextResponse.json(
      { error: "Selected period is not a multi-year range." },
      { status: 400 },
    );
  }

  const analyses = await getRangeAnalyses(source.startDate, source.endDate);
  if (!analyses) {
    return NextResponse.json(
      { error: "Range computation failed" },
      { status: 500 },
    );
  }
  const supplierCategory = await getSupplierCategoryMap();

  const { metrics } = generateExecutiveSummary({
    period: {
      name: source.periodLabel,
      startDate: source.startDate,
      endDate: source.endDate,
    },
    spendOverview: analyses.spend_overview,
    abc: analyses.abc,
    kraljic: analyses.kraljic,
    performanceSpend: analyses.performance_spend,
    cycleTime: analyses.cycle_time,
    recommendations: analyses.recommendations,
  });

  const today = new Date().toISOString().slice(0, 10);
  return NextResponse.json({
    meta: {
      title: `Range Report — ${source.periodLabel} — ${today}`,
      periodLabel: source.periodLabel,
      generatedBy: session.name,
      generatedAt: new Date().toISOString(),
      filename: `Range_Report_${source.periodLabel.replace(/[^\w-]+/g, "_")}.pdf`,
      ephemeral: true,
    },
    analyses,
    metrics,
    config,
    supplierCategory,
  });
}
