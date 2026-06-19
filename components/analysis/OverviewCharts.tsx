"use client";

import { useState } from "react";
import type { SpendOverviewResult } from "@/lib/analysis-types";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { SpendByCategoryChart } from "@/components/charts/SpendByCategoryChart";
import { TopSuppliersChart } from "@/components/charts/TopSuppliersChart";
import { MonthlySpendTrendChart } from "@/components/charts/MonthlySpendTrendChart";

const ALL_CATEGORIES = "__all__";

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

/**
 * Top suppliers chart with a visibility-only category filter. "All Categories"
 * shows the overall top 10 (spend.top_suppliers); picking a category swaps in
 * that category's top suppliers (up to 10, fewer if fewer exist — no padding).
 * If the per-category field is absent (old cached rows), the filter is hidden
 * and the card behaves exactly as before.
 */
function TopSuppliersCard({ spend }: { spend: SpendOverviewResult }) {
  const byCategory = spend.top_suppliers_by_category;
  const categories = byCategory ? Object.keys(byCategory).sort() : [];
  const [selected, setSelected] = useState<string>(ALL_CATEGORIES);

  const showFilter = categories.length > 0;
  const isAll = selected === ALL_CATEGORIES;
  const data = isAll
    ? spend.top_suppliers
    : (byCategory?.[selected] ?? []);

  const items = [
    { value: ALL_CATEGORIES, label: "All Categories" },
    ...categories.map((c) => ({ value: c, label: c })),
  ];

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2 space-y-0">
        <CardTitle>{isAll ? "Top 10 Suppliers" : `Top Suppliers — ${selected}`}</CardTitle>
        {showFilter && (
          <Select
            items={items}
            value={selected}
            onValueChange={(v) => setSelected(v ?? ALL_CATEGORIES)}
          >
            <SelectTrigger className="w-[200px]">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_CATEGORIES}>All Categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>
                  {c}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </CardHeader>
      <CardContent>
        {data.length > 0 ? (
          <TopSuppliersChart data={data} />
        ) : (
          <p className="py-12 text-center text-sm text-muted-foreground">
            No suppliers in this category for the selected period.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

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
        <TopSuppliersCard spend={spend} />
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
