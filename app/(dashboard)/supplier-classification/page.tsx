import { requireAuth } from "@/lib/auth";
import { prisma } from "@/lib/prisma";
import { getCurrentPeriodSelection, resolveAnalysisSource } from "@/lib/period";
import { EmptyState } from "@/components/EmptyState";
import { SupplierClassificationClient } from "@/components/SupplierClassification/SupplierClassificationClient";

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Supplier Classification — merges Kraljic + Performance-vs-Spend. The server
 * resolves the selected period/range to a date span (same pattern as Spend
 * Overview), then a client wrapper fetches the combined data and owns the
 * interactive synthesis filter + drill-down panel.
 */
export default async function SupplierClassificationPage({
  searchParams,
}: {
  searchParams: Promise<{ supplier?: string }>;
}) {
  await requireAuth();
  const sp = await searchParams;
  const initialSupplierId = typeof sp.supplier === "string" ? sp.supplier : null;
  const selection = await getCurrentPeriodSelection();
  const source = await resolveAnalysisSource(selection);

  const title = "Supplier classification";
  const subtitle = "Combined exposure and performance positioning";

  if (source.kind === "empty") {
    return (
      <div className="flex flex-col gap-6">
        <div>
          <h1 className="text-2xl font-semibold">{title}</h1>
          <p className="text-sm text-muted-foreground">{subtitle}</p>
        </div>
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
          <div>
            <h1 className="text-2xl font-semibold">{title}</h1>
            <p className="text-sm text-muted-foreground">{subtitle}</p>
          </div>
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
      <div>
        <h1 className="text-2xl font-semibold">
          {title}
          {label ? ` — ${label}` : ""}
        </h1>
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      </div>
      <SupplierClassificationClient
        startDate={startDate}
        endDate={endDate}
        periodLabel={label}
        isRangeMode={source.kind === "range"}
        initialSupplierId={initialSupplierId}
      />
    </div>
  );
}
