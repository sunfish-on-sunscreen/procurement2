import { requireAuth } from "@/lib/auth";
import { getCurrentPeriodSelection, resolveAnalysisSource } from "@/lib/period";
import { getAnalysisResult, type CycleTimeResult } from "@/lib/analysis-types";
import { EmptyState } from "@/components/EmptyState";
import { CycleTimeView } from "@/components/CycleTimeView";
import { RangeCompute } from "@/components/analysis/RangeCompute";

export default async function CycleTimePage() {
  await requireAuth();
  const selection = await getCurrentPeriodSelection();
  const source = await resolveAnalysisSource(selection);

  let label = "";
  let body: React.ReactNode;

  if (source.kind === "empty") {
    body = <EmptyState />;
  } else if (source.kind === "cached") {
    label = source.periodLabel;
    const cycleTime = await getAnalysisResult<CycleTimeResult>(
      source.periodId,
      "cycle_time",
    );
    body = cycleTime ? <CycleTimeView data={cycleTime} /> : <EmptyState />;
  } else {
    label = source.periodLabel;
    body = (
      <RangeCompute
        key={`${source.startDate}_${source.endDate}`}
        kind="cycle_time"
        startDate={source.startDate}
        endDate={source.endDate}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">
        Cycle Time — Process Health Monitoring{label ? ` — ${label}` : ""}
      </h1>
      {body}
    </div>
  );
}
