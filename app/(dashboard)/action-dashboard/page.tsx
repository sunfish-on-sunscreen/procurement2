import { requireAuth } from "@/lib/auth";
import { getCurrentPeriodSelection, resolveAnalysisSource } from "@/lib/period";
import {
  getAnalysisResult,
  type RecommendationsResult,
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
    const data = await getAnalysisResult<RecommendationsResult>(
      source.periodId,
      "recommendations",
    );
    body = data ? (
      <ActionDashboardView data={data} period={label} />
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
        period={label}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">
        Action Dashboard{label ? ` — ${label}` : ""}
      </h1>
      {body}
    </div>
  );
}
