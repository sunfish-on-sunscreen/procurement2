import { requireAuth } from "@/lib/auth";
import {
  getCurrentPeriodSelection,
  resolveAnalysisSource,
  getDateRangeFromSelection,
} from "@/lib/period";
import { getSupplierCategoryMap, getSupplierDirectory } from "@/lib/suppliers";
import { EmptyState } from "@/components/EmptyState";
import { SupplierSelectionClient } from "@/components/SupplierSelection/SupplierSelectionClient";

export default async function SupplierSelectionPage() {
  await requireAuth();
  const selection = await getCurrentPeriodSelection();
  const source = await resolveAnalysisSource(selection);
  const label = source.kind === "empty" ? "" : source.periodLabel;

  let body: React.ReactNode;
  if (source.kind === "empty") {
    body = <EmptyState />;
  } else {
    // Span (both modes) + the GLOBAL catalog maps (category + country) the analysis
    // rows don't carry. The client fetches the span-scoped perf + kraljic and runs
    // the pure blend — no new endpoint, no compute change.
    const [span, categoryById, directory] = await Promise.all([
      getDateRangeFromSelection(selection),
      getSupplierCategoryMap(),
      getSupplierDirectory(),
    ]);
    if (!span) {
      body = <EmptyState />;
    } else {
      const start = span.startDate.toISOString().slice(0, 10);
      const end = span.endDate.toISOString().slice(0, 10);
      const countryById: Record<string, string> = {};
      for (const [id, d] of Object.entries(directory)) countryById[id] = d.country;
      body = (
        <SupplierSelectionClient
          key={`${start}_${end}`}
          startDate={start}
          endDate={end}
          categoryById={categoryById}
          countryById={countryById}
        />
      );
    }
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">
          Supplier Selection{label ? ` — ${label}` : ""}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          The best-fit supplier per procurement category — Performance, Safety, and Price, blended.
        </p>
      </div>
      {body}
    </div>
  );
}
