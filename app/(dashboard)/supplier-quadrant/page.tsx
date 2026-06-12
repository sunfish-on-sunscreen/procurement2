import { requireAuth } from "@/lib/auth";
import { getCurrentPeriodSelection, resolveAnalysisSource } from "@/lib/period";
import { getAnalysisResult, type KraljicResult } from "@/lib/analysis-types";
import { EmptyState } from "@/components/EmptyState";
import { SupplierKraljicView } from "@/components/SupplierKraljicView";
import { RangeCompute } from "@/components/analysis/RangeCompute";

export default async function SupplierQuadrantPage() {
  await requireAuth();
  const selection = await getCurrentPeriodSelection();
  const source = await resolveAnalysisSource(selection);

  let label = "";
  let body: React.ReactNode;

  if (source.kind === "empty") {
    body = <EmptyState />;
  } else if (source.kind === "cached") {
    label = source.periodLabel;
    const kraljic = await getAnalysisResult<KraljicResult>(
      source.periodId,
      "kraljic",
    );
    body = kraljic ? (
      <SupplierKraljicView kraljic={kraljic} period={label} />
    ) : (
      <EmptyState />
    );
  } else {
    label = source.periodLabel;
    body = (
      <RangeCompute
        key={`${source.startDate}_${source.endDate}`}
        kind="kraljic"
        startDate={source.startDate}
        endDate={source.endDate}
        period={label}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">
        Supplier Quadrant{label ? ` — ${label}` : ""}
      </h1>
      {body}
    </div>
  );
}
