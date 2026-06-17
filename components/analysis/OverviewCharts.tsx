"use client";

import type { SpendOverviewResult } from "@/lib/analysis-types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SpendByCategoryChart } from "@/components/charts/SpendByCategoryChart";
import { TopSuppliersChart } from "@/components/charts/TopSuppliersChart";
import { MonthlySpendTrendChart } from "@/components/charts/MonthlySpendTrendChart";

const usd0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});
const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
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

export function OverviewCharts({ spend }: { spend: SpendOverviewResult }) {
  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Spend" value={usdCompact.format(spend.total_spend)} />
        <KpiCard label="Total POs" value={num0.format(spend.total_pos)} />
        <KpiCard label="Active Suppliers" value={num0.format(spend.active_suppliers)} />
        <KpiCard label="Avg Cycle Time" value={`${spend.avg_cycle_time.toFixed(1)} days`} />
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
        <Card>
          <CardHeader>
            <CardTitle>Top 10 Suppliers</CardTitle>
          </CardHeader>
          <CardContent>
            <TopSuppliersChart data={spend.top_suppliers} />
          </CardContent>
        </Card>
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

      <p className="text-sm text-muted-foreground">
        This period totaled {usd0.format(spend.total_spend)} across{" "}
        {num0.format(spend.total_pos)} purchase orders from{" "}
        {num0.format(spend.active_suppliers)} active suppliers, with an average
        procure-to-pay cycle time of {spend.avg_cycle_time.toFixed(1)} days.
      </p>
    </>
  );
}
