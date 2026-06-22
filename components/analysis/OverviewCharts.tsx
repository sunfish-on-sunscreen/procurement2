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
import { Sparkline } from "@/components/charts/Sparkline";

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
export function TopSuppliersCard({ spend }: { spend: SpendOverviewResult }) {
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

function KpiCard({
  label,
  value,
  spark,
}: {
  label: string;
  value: string;
  // Batch 6c: editor-only sparkline (omit to render a plain card).
  spark?: Array<number | null | undefined>;
}) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardDescription>{label}</CardDescription>
      </CardHeader>
      <CardContent className="flex items-end justify-between gap-2">
        <div className="text-2xl font-semibold">{value}</div>
        {spark && (
          <div className="text-primary">
            <Sparkline data={spark} />
          </div>
        )}
      </CardContent>
    </Card>
  );
}

const SpendByCategoryCard = ({ spend }: { spend: SpendOverviewResult }) => (
  <Card>
    <CardHeader>
      <CardTitle>Spend by Category</CardTitle>
    </CardHeader>
    <CardContent>
      <SpendByCategoryChart data={spend.by_category} />
    </CardContent>
  </Card>
);

const MonthlyTrendCard = ({ spend }: { spend: SpendOverviewResult }) => (
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
);

const OVERVIEW_TABS = [
  { key: "trend", label: "Monthly trend" },
  { key: "category", label: "By category" },
  { key: "suppliers", label: "Top suppliers" },
] as const;
type OverviewTab = (typeof OVERVIEW_TABS)[number]["key"];

/**
 * Spend Overview charts. `embedded` (report editor) adds KPI sparklines and a
 * tab switcher that shows one sub-view at a time to save vertical space; the
 * other panels stay in the DOM (`export-reveal`) so PDF export reveals all
 * three. On the standalone Overview page (`embedded` false) every view stacks.
 */
export function OverviewCharts({
  spend,
  embedded = false,
}: {
  spend: SpendOverviewResult;
  embedded?: boolean;
}) {
  const [tab, setTab] = useState<OverviewTab>("trend");
  const spendSpark = embedded
    ? spend.monthly_trend.map((m) => m.total)
    : undefined;
  const poSpark = embedded
    ? spend.monthly_trend.map((m) => m.po_count)
    : undefined;

  const summary = (
    <p className="text-sm text-muted-foreground">
      This period totaled {usd0.format(spend.total_spend)} across{" "}
      {num0.format(spend.total_pos)} purchase orders from{" "}
      {num0.format(spend.active_suppliers)} active suppliers, with an average
      procure-to-pay cycle time of {spend.avg_cycle_time.toFixed(1)} days.
    </p>
  );

  return (
    <>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <KpiCard label="Total Spend" value={usdCompact.format(spend.total_spend)} spark={spendSpark} />
        <KpiCard label="Total POs" value={num0.format(spend.total_pos)} spark={poSpark} />
        <KpiCard label="Active Suppliers" value={num0.format(spend.active_suppliers)} />
        <KpiCard label="Avg Cycle Time" value={`${spend.avg_cycle_time.toFixed(1)} days`} />
      </div>

      {embedded ? (
        <>
          <div className="no-print flex gap-1 border-b">
            {OVERVIEW_TABS.map((t) => (
              <button
                key={t.key}
                type="button"
                onClick={() => setTab(t.key)}
                className={`-mb-px border-b-2 px-3 py-1.5 text-sm transition-colors ${
                  tab === t.key
                    ? "border-primary font-medium"
                    : "border-transparent text-muted-foreground hover:text-foreground"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          <div className="export-reveal" hidden={tab !== "trend"}>
            <MonthlyTrendCard spend={spend} />
          </div>
          <div className="export-reveal" hidden={tab !== "category"}>
            <SpendByCategoryCard spend={spend} />
          </div>
          <div className="export-reveal" hidden={tab !== "suppliers"}>
            <TopSuppliersCard spend={spend} />
          </div>
        </>
      ) : (
        <>
          <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
            <SpendByCategoryCard spend={spend} />
            <TopSuppliersCard spend={spend} />
          </div>
          <MonthlyTrendCard spend={spend} />
        </>
      )}

      {summary}
    </>
  );
}
