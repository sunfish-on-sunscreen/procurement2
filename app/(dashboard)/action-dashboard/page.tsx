import { requireAuth } from "@/lib/auth";
import { getCurrentPeriodSelection, resolveAnalysisSource } from "@/lib/period";
import {
  getAnalysisResult,
  type RecommendationsResult,
  type CycleTimeResult,
} from "@/lib/analysis-types";
import { EmptyState } from "@/components/EmptyState";
import { ActionDashboardView } from "@/components/ActionDashboardView";
import { RangeCompute } from "@/components/analysis/RangeCompute";

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
    // cycle_time is read alongside recommendations so the P2P bar tile has all
    // three internal stage means (recommendations only carries flagged stages).
    const [data, cycle] = await Promise.all([
      getAnalysisResult<RecommendationsResult>(source.periodId, "recommendations"),
      getAnalysisResult<CycleTimeResult>(source.periodId, "cycle_time"),
    ]);
    body = data ? <ActionDashboardView data={data} cycleTime={cycle} /> : <EmptyState />;
  } else {
    label = source.periodLabel;
    body = (
      <RangeCompute
        key={`${source.startDate}_${source.endDate}`}
        kind="recommendations"
        startDate={source.startDate}
        endDate={source.endDate}
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
