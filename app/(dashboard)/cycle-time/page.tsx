import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentPeriodSelection, resolveAnalysisSource } from "@/lib/period";
import { getAnalysisResult, type CycleTimeResult } from "@/lib/analysis-types";
import { EmptyState } from "@/components/EmptyState";
import { CycleTimeView } from "@/components/CycleTimeView";
import { RangeCompute } from "@/components/analysis/RangeCompute";
import { CycleSupplierSection } from "@/components/CycleTime/CycleSupplierSection";

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function CycleTimePage() {
  await requireAuth();
  const selection = await getCurrentPeriodSelection();
  const source = await resolveAnalysisSource(selection);

  let label = "";
  let body: React.ReactNode;
  // Resolved date span for the period-scoped per-supplier / per-category
  // breakdown section (null in the empty state).
  let span: { startDate: string; endDate: string } | null = null;

  if (source.kind === "empty") {
    body = <EmptyState />;
  } else if (source.kind === "cached") {
    label = source.periodLabel;
    const [cycleTime, period] = await Promise.all([
      getAnalysisResult<CycleTimeResult>(source.periodId, "cycle_time"),
      prisma.reportingPeriod.findUnique({
        where: { id: source.periodId },
        select: { startDate: true, endDate: true },
      }),
    ]);
    body = cycleTime ? <CycleTimeView data={cycleTime} /> : <EmptyState />;
    if (period) {
      span = {
        startDate: toIsoDate(period.startDate),
        endDate: toIsoDate(period.endDate),
      };
    }
  } else {
    label = source.periodLabel;
    span = { startDate: source.startDate, endDate: source.endDate };
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
      {/* Coal-mining framing (B4). */}
      <p className="max-w-3xl text-sm text-muted-foreground">
        In capital-intensive mining operations, procurement delays directly
        impact equipment availability. Identifying slow-procurement suppliers and
        bottleneck stages enables targeted improvements that keep critical spares
        and services flowing to the pit.
      </p>
      {body}
      {span && (
        <CycleSupplierSection startDate={span.startDate} endDate={span.endDate} />
      )}
    </div>
  );
}
