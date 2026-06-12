import { requireAuth } from "@/lib/auth";
import { getCurrentPeriodSelection, resolveAnalysisSource } from "@/lib/period";
import {
  getAnalysisResult,
  type PerformanceSpendResult,
} from "@/lib/analysis-types";
import { EmptyState } from "@/components/EmptyState";
import { PerformanceSpendView } from "@/components/PerformanceSpendView";
import { RangeCompute } from "@/components/analysis/RangeCompute";

export default async function PerformanceSpendPage() {
  await requireAuth();
  const selection = await getCurrentPeriodSelection();
  const source = await resolveAnalysisSource(selection);

  let label = "";
  let body: React.ReactNode;

  if (source.kind === "empty") {
    body = <EmptyState />;
  } else if (source.kind === "cached") {
    label = source.periodLabel;
    const data = await getAnalysisResult<PerformanceSpendResult>(
      source.periodId,
      "performance_spend",
    );
    body = data ? (
      <PerformanceSpendView data={data} period={label} />
    ) : (
      <EmptyState />
    );
  } else {
    label = source.periodLabel;
    body = (
      <RangeCompute
        key={`${source.startDate}_${source.endDate}`}
        kind="performance_spend"
        startDate={source.startDate}
        endDate={source.endDate}
        period={label}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">
        Performance vs Spend{label ? ` — ${label}` : ""}
      </h1>
      {body}
    </div>
  );
}
