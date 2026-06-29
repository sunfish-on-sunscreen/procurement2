import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentPeriodSelection, resolveAnalysisSource } from "@/lib/period";
import { getAnalysisResult, type CycleTimeResult } from "@/lib/analysis-types";
import { EmptyState } from "@/components/EmptyState";
import { CycleTimeClient } from "@/components/CycleTime/CycleTimeClient";

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export default async function CycleTimePage() {
  await requireAuth();
  const selection = await getCurrentPeriodSelection();
  const source = await resolveAnalysisSource(selection);

  const title = "Cycle Time — Process Health Monitoring";
  const subtitle = "Procure-to-pay timing across the supplier base";
  const label = source.kind === "empty" ? "" : source.periodLabel;

  let content: React.ReactNode;

  if (source.kind === "empty") {
    content = <EmptyState />;
  } else if (source.kind === "cached") {
    const [cycleTime, period] = await Promise.all([
      getAnalysisResult<CycleTimeResult>(source.periodId, "cycle_time"),
      prisma.reportingPeriod.findUnique({
        where: { id: source.periodId },
        select: { startDate: true, endDate: true },
      }),
    ]);
    if (!cycleTime || !period) {
      content = <EmptyState />;
    } else {
      // Previous period's median cycle time, for the glance panel's trend line.
      const prevPeriod = await prisma.reportingPeriod.findFirst({
        where: { startDate: { lt: period.startDate } },
        orderBy: { startDate: "desc" },
        select: { id: true, name: true },
      });
      let previousMedian: number | null = null;
      let previousLabel: string | null = null;
      if (prevPeriod) {
        const prevCt = await getAnalysisResult<CycleTimeResult>(prevPeriod.id, "cycle_time");
        if (prevCt?.distribution.median != null) {
          previousMedian = prevCt.distribution.median;
          previousLabel = prevPeriod.name;
        }
      }
      content = (
        <CycleTimeClient
          startDate={toIsoDate(period.startDate)}
          endDate={toIsoDate(period.endDate)}
          periodLabel={label}
          isRangeMode={false}
          cachedCycleTime={cycleTime}
          previousMedian={previousMedian}
          previousLabel={previousLabel}
        />
      );
    }
  } else {
    content = (
      <CycleTimeClient
        key={`${source.startDate}_${source.endDate}`}
        startDate={source.startDate}
        endDate={source.endDate}
        periodLabel={label}
        isRangeMode={true}
        cachedCycleTime={null}
        previousMedian={null}
        previousLabel={null}
      />
    );
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">
          {title}
          {label ? ` — ${label}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      {content}
    </div>
  );
}
