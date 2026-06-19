import { notFound } from "next/navigation";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getAnalysisResult,
  type SpendOverviewResult,
  type AbcResult,
  type KraljicResult,
  type HypothesisResult,
  type PerformanceSpendResult,
  type RecommendationsResult,
} from "@/lib/analysis-types";
import type { ReportMetrics } from "@/lib/report-templates";
import { defaultReportConfig, type ReportConfig } from "@/lib/report-config";
import { getSupplierCategoryMap } from "@/lib/suppliers";
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

  const [spend, abc, kraljic, hypothesis, performance, recommendations, supplierCategory] =
    await Promise.all([
      getAnalysisResult<SpendOverviewResult>(periodId, "spend_overview"),
      getAnalysisResult<AbcResult>(periodId, "abc"),
      getAnalysisResult<KraljicResult>(periodId, "kraljic"),
      getAnalysisResult<HypothesisResult>(periodId, "hypothesis"),
      getAnalysisResult<PerformanceSpendResult>(periodId, "performance_spend"),
      getAnalysisResult<RecommendationsResult>(periodId, "recommendations"),
      getSupplierCategoryMap(),
    ]);

  // Old reports (pre-3c) have no config: default to standard / all sections.
  const config: ReportConfig =
    stored.config ??
    defaultReportConfig(
      { mode: "single", singleId: periodId, fromId: periodId, toId: periodId },
      [...new Set(Object.values(supplierCategory))],
    );

  const analyses: ReportAnalyses = {
    spend_overview: spend,
    abc,
    kraljic,
    hypothesis,
    performance_spend: performance,
    recommendations,
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
    />
  );
}
