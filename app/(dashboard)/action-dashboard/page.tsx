import { requireAuth } from "@/lib/auth";
import {
  getCurrentPeriodSelection,
  resolveAnalysisSource,
  getDateRangeFromSelection,
} from "@/lib/period";
import {
  getAnalysisResult,
  type RecommendationsResult,
  type CycleTimeResult,
  type PerformanceSpendResult,
  type KraljicResult,
} from "@/lib/analysis-types";
import { EmptyState } from "@/components/EmptyState";
import { ActionDashboardView } from "@/components/ActionDashboardView";
import { RangeCompute } from "@/components/analysis/RangeCompute";
import { loadTemporalMatrix } from "@/lib/temporal-load";
import { getSupplierCategoryMap } from "@/lib/suppliers";

export default async function ActionDashboardPage() {
  await requireAuth();
  const selection = await getCurrentPeriodSelection();
  const source = await resolveAnalysisSource(selection);

  let label = "";
  let body: React.ReactNode;

  if (source.kind === "empty") {
    body = <EmptyState />;
  } else if (source.kind === "cached") {
    label = source.periodLabel;
    // cycle_time feeds the P2P bar tile (recommendations only carries flagged
    // stages); performance_spend + kraljic + the period span power the in-place
    // supplier detail drawer (same inputs the Classification panel needs).
    // temporal: the hub's changed-over-time family compares the SELECTED year vs the
    // prior period (Y vs Y-1) — period-aware, so it renders in single-year mode too.
    const [data, cycle, perf, kraljic, span, temporal, supplierCategory] = await Promise.all([
      getAnalysisResult<RecommendationsResult>(source.periodId, "recommendations"),
      getAnalysisResult<CycleTimeResult>(source.periodId, "cycle_time"),
      getAnalysisResult<PerformanceSpendResult>(source.periodId, "performance_spend"),
      getAnalysisResult<KraljicResult>(source.periodId, "kraljic"),
      getDateRangeFromSelection(selection),
      loadTemporalMatrix({ selectedPeriodId: source.periodId }),
      // Supplier → category map (55-row Prisma read, period-independent): the ONLY
      // extra data the insight panels need beyond the analyses — powers the
      // Concentration panel's who's-in-the-category cross-analysis.
      getSupplierCategoryMap(),
    ]);
    const start = span ? span.startDate.toISOString().slice(0, 10) : "";
    const end = span ? span.endDate.toISOString().slice(0, 10) : "";
    body = data ? (
      <ActionDashboardView
        data={data}
        cycleTime={cycle}
        perf={perf}
        kraljic={kraljic}
        startDate={start}
        endDate={end}
        temporal={temporal}
        supplierCategory={supplierCategory}
        isRangeMode={false}
      />
    ) : (
      <EmptyState />
    );
  } else {
    label = source.periodLabel;
    // Range mode: latest-vs-prior across the roster (partial newest year skipped).
    const [temporal, supplierCategory] = await Promise.all([
      loadTemporalMatrix(),
      getSupplierCategoryMap(),
    ]);
    body = (
      <RangeCompute
        key={`${source.startDate}_${source.endDate}`}
        kind="recommendations"
        startDate={source.startDate}
        endDate={source.endDate}
        temporal={temporal}
        supplierCategory={supplierCategory}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">
          Action Priorities{label ? ` — ${label}` : ""}
        </h1>
      </div>
      {body}
    </div>
  );
}
