"use client";

import { useEffect, useMemo, useState } from "react";
import { Loader2 } from "lucide-react";
import type { SpendOverviewResult } from "@/lib/analysis-types";
import type { SupplierRankingRow } from "@/lib/spend-overview-types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SpendByCategoryChart } from "@/components/charts/SpendByCategoryChart";
import { MonthlySpendTrendChart } from "@/components/charts/MonthlySpendTrendChart";
import { TopSuppliersCard } from "@/components/analysis/OverviewCharts";
import { PinProvider } from "@/components/Reports/PinContext";
import { SupplierRankingTable } from "./SupplierRankingTable";
import { SpendDecompositionPanel } from "./SpendDecompositionPanel";

const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const usd0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const num0 = new Intl.NumberFormat("en-US");

function KpiCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent>
        <div className="text-2xl font-semibold">{value}</div>
      </CardContent>
    </Card>
  );
}

type PageData = { spend_overview: SpendOverviewResult; ranking: SupplierRankingRow[] };

/**
 * Client wrapper for the Spend Overview page. Fetches page data for the span
 * (charts + supplier ranking), owns the selected-supplier drill-down, and wires
 * Top-10 bar clicks to the panel via a dashboard-scoped PinProvider.
 */
export function SpendOverviewClient({
  startDate,
  endDate,
}: {
  startDate: string;
  endDate: string;
}) {
  // Loaded data / error are tagged with the span key they belong to, so loading
  // is derived (no synchronous setState in the effect — matches ReportEditor).
  const spanKey = `${startDate}_${endDate}`;
  const [loaded, setLoaded] = useState<{ key: string; data: PageData } | null>(null);
  const [errored, setErrored] = useState<{ key: string; msg: string } | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);

  const data = loaded?.key === spanKey ? loaded.data : null;
  const error = errored?.key === spanKey ? errored.msg : null;

  // Clear the drill-down when the span changes (different supplier population).
  const [prevSpanKey, setPrevSpanKey] = useState(spanKey);
  if (prevSpanKey !== spanKey) {
    setPrevSpanKey(spanKey);
    if (selectedSupplierId !== null) setSelectedSupplierId(null);
  }

  useEffect(() => {
    const key = `${startDate}_${endDate}`;
    let cancelled = false;
    fetch("/api/spend-overview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const e = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(e.error || "Failed to load");
        }
        return res.json() as Promise<PageData>;
      })
      .then((d) => {
        if (!cancelled) setLoaded({ key, data: d });
      })
      .catch((e: unknown) => {
        if (!cancelled)
          setErrored({ key, msg: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate]);

  const pinValue = useMemo(
    () => ({
      pinnedSupplierId: selectedSupplierId,
      pin: (id: string) => setSelectedSupplierId(id),
      clear: () => setSelectedSupplierId(null),
    }),
    [selectedSupplierId],
  );

  if (error) {
    return <p className="py-16 text-center text-sm text-destructive">{error}</p>;
  }
  if (!data) {
    return (
      <div className="flex items-center gap-2 py-16 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading spend overview…
      </div>
    );
  }

  const spend = data.spend_overview;
  const avgPoValue = spend.total_pos > 0 ? spend.total_spend / spend.total_pos : 0;

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Spend" value={usdCompact.format(spend.total_spend)} />
        <KpiCard label="Total invoices" value={num0.format(spend.total_pos)} />
        <KpiCard label="Active Suppliers" value={num0.format(spend.active_suppliers)} />
        <KpiCard label="Avg PO Value" value={usd0.format(avgPoValue)} />
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Spend by Category</CardTitle>
          </CardHeader>
          <CardContent>
            <SpendByCategoryChart data={spend.by_category} />
          </CardContent>
        </Card>
        {/* Top-10 bar clicks open the decomposition panel via this provider. */}
        <PinProvider value={pinValue}>
          <TopSuppliersCard spend={spend} />
        </PinProvider>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>Monthly Spend Trend</CardTitle>
          <CardDescription>
            Realized spend, bucketed by supplier invoice date.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <MonthlySpendTrendChart data={spend.monthly_trend} />
        </CardContent>
      </Card>

      <SupplierRankingTable
        rows={data.ranking}
        onSupplierClick={setSelectedSupplierId}
        selectedSupplierId={selectedSupplierId}
      />

      <SpendDecompositionPanel
        supplierId={selectedSupplierId}
        onClose={() => setSelectedSupplierId(null)}
      />
    </>
  );
}
