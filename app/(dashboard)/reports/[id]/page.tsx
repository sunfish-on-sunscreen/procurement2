import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import {
  getAnalysisResult,
  type SpendOverviewResult,
  type AbcResult,
  type ClusteringResult,
  type HypothesisResult,
} from "@/lib/analysis-types";
import type { ReportMetrics } from "@/lib/report-templates";
import { buttonVariants } from "@/components/ui/button";
import { OverviewCharts } from "@/components/analysis/OverviewCharts";
import { AbcView } from "@/components/analysis/AbcView";
import { SupplierSegmentsView } from "@/components/SupplierSegmentsView";
import { CycleTimeView } from "@/components/CycleTimeView";
import { DownloadPdfButton } from "@/components/DownloadPdfButton";

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

  const metrics = summary.metricsJson as unknown as ReportMetrics;
  const periodId = summary.periodId;

  const [spend, abc, clustering, hypothesis] = await Promise.all([
    getAnalysisResult<SpendOverviewResult>(periodId, "spend_overview"),
    getAnalysisResult<AbcResult>(periodId, "abc"),
    getAnalysisResult<ClusteringResult>(periodId, "clustering"),
    getAnalysisResult<HypothesisResult>(periodId, "hypothesis"),
  ]);

  const filename = `${summary.title.replace(/[^\w-]+/g, "_")}.pdf`;

  return (
    <div className="flex flex-col gap-4">
      <div className="no-print sticky top-0 z-10 -mx-6 flex items-center justify-between gap-4 border-b bg-background/95 px-6 py-3 backdrop-blur">
        <Link
          href="/reports"
          className={buttonVariants({ variant: "ghost", size: "sm" })}
        >
          <ArrowLeft className="h-4 w-4" /> Back to Reports
        </Link>
        <span className="hidden truncate text-sm font-medium sm:block">
          {summary.title}
        </span>
        <DownloadPdfButton filename={filename} />
      </div>

      <div
        id="report-root"
        className="mx-auto flex w-full max-w-[820px] flex-col gap-8"
      >
        {/* 1. Cover */}
        <section className="pdf-page-break flex flex-col gap-3 rounded-lg border bg-card p-8">
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Adaro &middot; Procurement Analytics
          </p>
          <h1 className="text-3xl font-bold">{summary.title}</h1>
          <p className="text-sm text-muted-foreground">
            Period: {summary.period.name} &middot; Generated{" "}
            {new Date(summary.createdAt).toLocaleString()} by{" "}
            {summary.generatedByUser.name}
          </p>
          <p className="mt-4 text-sm leading-relaxed">
            {metrics.narratives.cover_intro}
          </p>
          <div className="mt-4">
            <h3 className="text-sm font-semibold">Key findings</h3>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-sm text-muted-foreground">
              {metrics.key_findings.map((f, i) => (
                <li key={i}>{f}</li>
              ))}
            </ul>
          </div>
        </section>

        {/* 2. Spend Overview */}
        {spend && (
          <section className="pdf-page-break flex flex-col gap-4">
            <h2 className="text-xl font-semibold">Spend Overview</h2>
            <OverviewCharts spend={spend} />
            <p className="text-sm leading-relaxed text-muted-foreground">
              {metrics.narratives.spend}
            </p>
          </section>
        )}

        {/* 3. ABC Analysis */}
        {abc && (
          <section className="pdf-page-break flex flex-col gap-4">
            <h2 className="text-xl font-semibold">ABC Analysis</h2>
            <AbcView abc={abc} />
            <p className="text-sm leading-relaxed text-muted-foreground">
              {metrics.narratives.abc}
            </p>
          </section>
        )}

        {/* 4. Supplier Segments */}
        {clustering && (
          <section className="pdf-page-break flex flex-col gap-4">
            <h2 className="text-xl font-semibold">Supplier Segments</h2>
            <SupplierSegmentsView clustering={clustering} />
            <p className="text-sm leading-relaxed text-muted-foreground">
              {metrics.narratives.clustering}
            </p>
          </section>
        )}

        {/* 5. Cycle Time */}
        {hypothesis && (
          <section className="pdf-page-break flex flex-col gap-4">
            <h2 className="text-xl font-semibold">
              Cycle Time &amp; Automation Impact
            </h2>
            <CycleTimeView hypothesis={hypothesis} />
            <p className="text-sm leading-relaxed text-muted-foreground">
              {metrics.narratives.cycle_time}
            </p>
          </section>
        )}

        {/* 6. Recommendations */}
        <section className="pdf-page-break flex flex-col gap-3">
          <h2 className="text-xl font-semibold">Recommendations</h2>
          <ul className="list-disc space-y-2 pl-5 text-sm">
            {metrics.recommendations.map((r, i) => (
              <li key={i}>{r}</li>
            ))}
          </ul>
        </section>

        {/* 7. Methodology footer */}
        <section className="pdf-page-break flex flex-col gap-2 text-sm text-muted-foreground">
          <h2 className="text-xl font-semibold text-foreground">Methodology</h2>
          <p>
            ABC uses fixed 80% / 95% thresholds (Pareto principle). Supplier
            segmentation uses K-means (k = 4) on six features with a PCA
            projection. Automation impact uses the Mann-Whitney U test (α = 0.05)
            with a rank-biserial effect size and a bootstrap 95% confidence
            interval.
          </p>
          <p className="text-xs">
            Synthetic data calibrated to APQC, Hackett Group, CIPS, MOPS, and AME
            benchmarks. References: Juran (1951); Mann &amp; Whitney (1947).
          </p>
        </section>
      </div>
    </div>
  );
}
