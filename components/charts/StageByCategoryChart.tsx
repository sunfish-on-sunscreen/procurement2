"use client";

import { BarChart, Bar, XAxis, YAxis, Tooltip, CartesianGrid, Legend } from "recharts";
import { CYCLE_STAGES, type CycleCategoryRow } from "@/lib/cycle-time-types";
import { CHART_COLORS } from "@/lib/chart-colors";
import { ChartFrame } from "@/components/charts/ChartFrame";

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

// Same stage-colour family used elsewhere on the page.
const STAGE_COLOR: Record<string, string> = {
  pr_to_po: CHART_COLORS[0],
  po_to_delivery: CHART_COLORS[1],
  delivery_to_invoice: CHART_COLORS[2],
  invoice_to_payment: CHART_COLORS[3],
};

/**
 * Horizontal stacked bars: mean days in each of the 4 procure-to-pay stages, per
 * category. Renders only the chart — the caller supplies the card/heading.
 */
export function StageByCategoryChart({ rows }: { rows: CycleCategoryRow[] }) {
  const data = rows.map((r) => ({
    name: truncate(r.category, 22),
    full: r.category,
    pr_to_po: r.pr_to_po,
    po_to_delivery: r.po_to_delivery,
    delivery_to_invoice: r.delivery_to_invoice,
    invoice_to_payment: r.invoice_to_payment,
  }));

  if (data.length === 0) {
    return (
      <p className="py-6 text-center text-sm text-muted-foreground">
        No category activity in this period.
      </p>
    );
  }

  return (
    <ChartFrame height={Math.max(360, data.length * 40 + 56)}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}d`} />
        <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10 }} interval={0} />
        <Tooltip
          formatter={(v, n) => [`${Number(v).toFixed(1)} d`, String(n)]}
          cursor={{ fillOpacity: 0.06 }}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        {CYCLE_STAGES.map((s) => (
          <Bar
            key={s.key}
            dataKey={s.key}
            name={s.label}
            stackId="stage"
            fill={STAGE_COLOR[s.key]}
            isAnimationActive={false}
          />
        ))}
      </BarChart>
    </ChartFrame>
  );
}
