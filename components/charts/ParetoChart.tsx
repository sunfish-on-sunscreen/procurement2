"use client";

import {
  ComposedChart,
  Bar,
  Line,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
  Legend,
} from "recharts";
import { ChartFrame } from "./ChartFrame";
import { ABC_COLORS } from "@/lib/chart-colors";
import type { AbcClassification } from "@/lib/analysis-types";

// Minimal shape of the props Recharts injects into a custom tooltip (the
// exported TooltipProps type changed in Recharts 3).
type ParetoTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload: AbcClassification }>;
};

const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

function ParetoTooltip({ active, payload }: ParetoTooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border bg-background p-2 text-xs shadow-sm">
      <div className="font-medium">{d.supplier_name}</div>
      <div className="text-muted-foreground">
        Rank #{d.rank} &middot; Class {d.abc_class} &middot; {d.tier}
      </div>
      <div>Spend: {usdCompact.format(d.total)}</div>
      <div>Cumulative: {(d.cumulative_pct * 100).toFixed(1)}%</div>
    </div>
  );
}

export function ParetoChart({ data }: { data: AbcClassification[] }) {
  return (
    <ChartFrame height={400}>
      <ComposedChart data={data} margin={{ left: 12, right: 16, top: 12, bottom: 12 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="rank"
          tick={{ fontSize: 10 }}
          label={{ value: "Supplier rank (by spend)", position: "insideBottom", offset: -6, fontSize: 12 }}
        />
        <YAxis
          yAxisId="left"
          width={72}
          tick={{ fontSize: 11 }}
          tickFormatter={(value) => usdCompact.format(Number(value))}
        />
        <YAxis
          yAxisId="right"
          orientation="right"
          domain={[0, 1]}
          tick={{ fontSize: 11 }}
          tickFormatter={(value) => `${(Number(value) * 100).toFixed(0)}%`}
        />
        <Tooltip content={<ParetoTooltip />} />
        <Legend />
        <Bar yAxisId="left" dataKey="total" name="Spend">
          {data.map((d, i) => (
            <Cell key={i} fill={ABC_COLORS[d.abc_class]} />
          ))}
        </Bar>
        <Line
          yAxisId="right"
          type="monotone"
          dataKey="cumulative_pct"
          name="Cumulative %"
          stroke="#334155"
          strokeWidth={2}
          dot={false}
        />
        <ReferenceLine
          yAxisId="right"
          y={0.8}
          stroke={ABC_COLORS.A}
          strokeDasharray="4 4"
          label={{ value: "80%", position: "right", fontSize: 11 }}
        />
        <ReferenceLine
          yAxisId="right"
          y={0.95}
          stroke={ABC_COLORS.B}
          strokeDasharray="4 4"
          label={{ value: "95%", position: "right", fontSize: 11 }}
        />
      </ComposedChart>
    </ChartFrame>
  );
}
