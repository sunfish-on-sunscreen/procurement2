import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getAnalysisResult,
  type SpendOverviewResult,
  type AbcResult,
  type KraljicResult,
  type CycleTimeResult,
  type PerformanceSpendResult,
  type RecommendationsResult,
} from "@/lib/analysis-types";
import type { ReportMetrics } from "@/lib/report-templates";
import { defaultReportConfig, type ReportConfig } from "@/lib/report-config";
import { getSupplierCategoryMap } from "@/lib/suppliers";
import { computeCycleBreakdown } from "@/lib/cycle-breakdown";
import {
  ReportDocument,
  type ReportAnalyses,
} from "@/components/Reports/ReportDocument";

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireAuth();
  const { id } = await params;

  const summary = await prisma.executiveSummary.findUnique({
    where: { id },
    include: { generatedByUser: true, period: true },
  });
  if (!summary) notFound();

  const stored = summary.metricsJson as unknown as ReportMetrics & {
    config?: ReportConfig;
  };
  const periodId = summary.periodId!;

  const [spend, abc, kraljic, cycleTime, performance, recommendations, supplierCategory] =
    await Promise.all([
      getAnalysisResult<SpendOverviewResult>(periodId, "spend_overview"),
      getAnalysisResult<AbcResult>(periodId, "abc"),
      getAnalysisResult<KraljicResult>(periodId, "kraljic"),
      getAnalysisResult<CycleTimeResult>(periodId, "cycle_time"),
      getAnalysisResult<PerformanceSpendResult>(periodId, "performance_spend"),
      getAnalysisResult<RecommendationsResult>(periodId, "recommendations"),
      getSupplierCategoryMap(),
    ]);

  // Reports persisted before Batch 5 lack the `cycle_framing` marker. Render
  // their stored pre/post cycle narrative as historical context rather than
  // back-filling them with the new monitoring view.
  const legacyCycle =
    stored.cycle_framing !== "monitoring"
      ? (stored.narratives?.cycle_time ?? null)
      : null;

  // Old reports (pre-3c) have no config: default to standard / all sections.
  const config: ReportConfig =
    stored.config ??
    defaultReportConfig(
      { mode: "single", singleId: periodId, fromId: periodId, toId: periodId },
      [...new Set(Object.values(supplierCategory))],
    );

  // Process family needs the cycle-time breakdown (per-supplier IQR + stage
  // anomalies). Compute it server-side for this period's span, reusing the
  // already-loaded (Mode A) abc + performance for the roster join — so it's in the
  // report data at render time (incl. PDF), no client fetch. Temporal is omitted:
  // persisted reports are single-year and the temporal family is range-only.
  const pStart = summary.period.startDate.toISOString().slice(0, 10);
  const pEnd = summary.period.endDate.toISOString().slice(0, 10);
  const breakdown = await computeCycleBreakdown(pStart, pEnd, {
    abc,
    performance_spend: performance,
  });

  const analyses: ReportAnalyses = {
    spend_overview: spend,
    abc,
    kraljic,
    cycle_time: cycleTime,
    performance_spend: performance,
    recommendations,
    breakdown,
    temporal: null,
  };

  return (
    <ReportDocument
      meta={{
        title: summary.title,
        periodLabel: summary.period.name,
        generatedBy: summary.generatedByUser.name,
        generatedAt: summary.createdAt.toISOString(),
        filename: `${summary.title.replace(/[^\w-]+/g, "_")}.pdf`,
      }}
      analyses={analyses}
      config={config}
      supplierCategory={supplierCategory}
      legacyCycle={legacyCycle}
    />
  );
}
