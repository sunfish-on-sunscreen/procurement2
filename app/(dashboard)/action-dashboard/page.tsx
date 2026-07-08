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
    body = data ? <ActionDashboardView data={data} /> : <EmptyState />;
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
        <p className="text-sm text-muted-foreground">
          Where to look first{label ? ` — ${label}` : ""} · grounded in the Spend,
          Classification, and Process analyses.
        </p>
      </div>
      {body}
    </div>
  );
}
