import { getCurrentPeriodSelection, resolveAnalysisSource } from "@/lib/period";
import { getAnalysisResult, type SpendOverviewResult } from "@/lib/analysis-types";
import { EmptyState } from "@/components/EmptyState";
import { OverviewCharts } from "@/components/analysis/OverviewCharts";
import { RangeCompute } from "@/components/analysis/RangeCompute";

export default async function OverviewPage() {
  const selection = await getCurrentPeriodSelection();
  const source = await resolveAnalysisSource(selection);

  let label = "";
  let body: React.ReactNode;

  if (source.kind === "empty") {
    body = <EmptyState />;
  } else if (source.kind === "cached") {
    label = source.periodLabel;
    const spend = await getAnalysisResult<SpendOverviewResult>(
      source.periodId,
      "spend_overview",
    );
    body = spend ? <OverviewCharts spend={spend} /> : <EmptyState />;
  } else {
    label = source.periodLabel;
    body = (
      <RangeCompute
        key={`${source.startDate}_${source.endDate}`}
        kind="overview"
        startDate={source.startDate}
        endDate={source.endDate}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">
        Overview{label ? ` — ${label}` : ""}
      </h1>
      {body}
    </div>
  );
}
