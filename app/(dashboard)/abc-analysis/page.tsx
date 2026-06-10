import { requireAuth } from "@/lib/auth";
import { getCurrentPeriodSelection, resolveAnalysisSource } from "@/lib/period";
import { getAnalysisResult, type AbcResult } from "@/lib/analysis-types";
import { EmptyState } from "@/components/EmptyState";
import { AbcView } from "@/components/analysis/AbcView";
import { RangeCompute } from "@/components/analysis/RangeCompute";

export default async function AbcAnalysisPage() {
  await requireAuth();
  const selection = await getCurrentPeriodSelection();
  const source = await resolveAnalysisSource(selection);

  let label = "";
  let body: React.ReactNode;

  if (source.kind === "empty") {
    body = <EmptyState />;
  } else if (source.kind === "cached") {
    label = source.periodLabel;
    const abc = await getAnalysisResult<AbcResult>(source.periodId, "abc");
    body = abc ? <AbcView abc={abc} /> : <EmptyState />;
  } else {
    label = source.periodLabel;
    body = (
      <RangeCompute
        key={`${source.startDate}_${source.endDate}`}
        kind="abc"
        startDate={source.startDate}
        endDate={source.endDate}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">
        ABC Analysis{label ? ` — ${label}` : ""}
      </h1>
      {body}
    </div>
  );
}
