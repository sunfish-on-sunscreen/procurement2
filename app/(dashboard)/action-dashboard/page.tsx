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

export default async function ActionDashboardPage() {
  await requireAuth();
  const selection = await getCurrentPeriodSelection();
  const source = await resolveAnalysisSource(selection);

  // Per-period latest-vs-prior matrix for the hub's temporal family. Server-loaded
  // from the trustworthy per-period AnalysisResults (Purchase-derived; no lag), and
  // mode-independent — the temporal block itself only renders in range mode.
  const temporal = await loadTemporalMatrix();

  let label = "";
  let body: React.ReactNode;

  if (source.kind === "empty") {
    body = <EmptyState />;
  } else if (source.kind === "cached") {
    label = source.periodLabel;
    // cycle_time feeds the P2P bar tile (recommendations only carries flagged
    // stages); performance_spend + kraljic + the period span power the in-place
    // supplier detail drawer (same inputs the Classification panel needs).
    const [data, cycle, perf, kraljic, span] = await Promise.all([
      getAnalysisResult<RecommendationsResult>(source.periodId, "recommendations"),
      getAnalysisResult<CycleTimeResult>(source.periodId, "cycle_time"),
      getAnalysisResult<PerformanceSpendResult>(source.periodId, "performance_spend"),
      getAnalysisResult<KraljicResult>(source.periodId, "kraljic"),
      getDateRangeFromSelection(selection),
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
        isRangeMode={false}
      />
    ) : (
      <EmptyState />
    );
  } else {
    label = source.periodLabel;
    body = (
      <RangeCompute
        key={`${source.startDate}_${source.endDate}`}
        kind="recommendations"
        startDate={source.startDate}
        endDate={source.endDate}
        temporal={temporal}
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
