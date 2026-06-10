import { requireAuth } from "@/lib/auth";
import { getCurrentPeriodSelection, resolveAnalysisSource } from "@/lib/period";
import { getAnalysisResult, type HypothesisResult } from "@/lib/analysis-types";
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
    const hypothesis = await getAnalysisResult<HypothesisResult>(
      source.periodId,
      "hypothesis",
    );
    body = hypothesis ? (
      <CycleTimeView hypothesis={hypothesis} />
    ) : (
      <EmptyState />
    );
  } else {
    label = source.periodLabel;
    body = (
      <RangeCompute
        key={`${source.startDate}_${source.endDate}`}
        kind="hypothesis"
        startDate={source.startDate}
        endDate={source.endDate}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">
        Cycle Time &amp; Automation Impact{label ? ` — ${label}` : ""}
      </h1>
      {body}
    </div>
  );
}
