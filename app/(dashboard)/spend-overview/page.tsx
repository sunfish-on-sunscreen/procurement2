import { prisma } from "@/lib/prisma";
import { getCurrentPeriodSelection, resolveAnalysisSource } from "@/lib/period";
import { EmptyState } from "@/components/EmptyState";
import { SpendOverviewClient } from "@/components/SpendOverview/SpendOverviewClient";

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

// Spend Overview (renamed from "Overview"). Server resolves the selected
// period/range to a date span, then a client wrapper fetches the page data and
// owns the interactive ranking table + spend-decomposition drill-down.
export default async function SpendOverviewPage() {
  const selection = await getCurrentPeriodSelection();
  const source = await resolveAnalysisSource(selection);

  if (source.kind === "empty") {
    return (
      <div className="flex flex-col gap-6">
        <h1 className="text-2xl font-semibold">Spend Overview</h1>
        <EmptyState />
      </div>
    );
  }

  let startDate: string;
  let endDate: string;
  const label = source.periodLabel;

  if (source.kind === "cached") {
    const period = await prisma.reportingPeriod.findUnique({
      where: { id: source.periodId },
      select: { startDate: true, endDate: true },
    });
    if (!period) {
      return (
        <div className="flex flex-col gap-6">
          <h1 className="text-2xl font-semibold">Spend Overview</h1>
          <EmptyState />
        </div>
      );
    }
    startDate = toIsoDate(period.startDate);
    endDate = toIsoDate(period.endDate);
  } else {
    startDate = source.startDate;
    endDate = source.endDate;
  }

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-semibold">
        Spend Overview{label ? ` — ${label}` : ""}
      </h1>
      <SpendOverviewClient
        startDate={startDate}
        endDate={endDate}
        periodLabel={label}
        isRangeMode={source.kind === "range"}
      />
    </div>
  );
}
