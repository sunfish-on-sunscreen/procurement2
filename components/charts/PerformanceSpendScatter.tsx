"use client";

import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { ChartFrame } from "./ChartFrame";
import { QUADRANT_COLORS, ZONE_COLORS } from "@/lib/chart-colors";
import type {
  PerformanceSpendSupplier,
  KraljicQuadrant,
  PerformanceZone,
} from "@/lib/analysis-types";

const QUADRANT_ORDER: KraljicQuadrant[] = [
  "Strategic",
  "Leverage",
  "Bottleneck",
  "Routine",
];
const ZONE_ORDER: PerformanceZone[] = [
  "Stars",
  "Critical Issues",
  "Hidden Gems",
  "Long Tail",
];

const usd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);

type ScatterTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload: PerformanceSpendSupplier }>;
};

function ScatterTooltip({ active, payload }: ScatterTooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border bg-background p-2 text-xs shadow-sm">
      <div className="font-medium">{d.supplier_name}</div>
      <div className="text-muted-foreground">{d.tier}</div>
      <div className="mt-1 text-muted-foreground">
        Spend {usd(d.total_spend_usd)} &middot; Performance{" "}
        {d.performance_score.toFixed(1)}
      </div>
      <div className="mt-1">
        <span style={{ color: ZONE_COLORS[d.zone] }}>{d.zone}</span>{" "}
        <span className="text-muted-foreground">&middot;</span>{" "}
        <span style={{ color: QUADRANT_COLORS[d.kraljic_quadrant] }}>
          {d.kraljic_quadrant}
        </span>
      </div>
    </div>
  );
}

export function PerformanceSpendScatter({
  suppliers,
  thresholds,
  colorBy = "quadrant",
}: {
  suppliers: PerformanceSpendSupplier[];
  thresholds: { spend_median: number; performance_median: number };
  colorBy?: "zone" | "quadrant";
}) {
  const series =
    colorBy === "quadrant"
      ? QUADRANT_ORDER.map((q) => ({
          key: q,
          color: QUADRANT_COLORS[q],
          data: suppliers.filter((s) => s.kraljic_quadrant === q),
        }))
      : ZONE_ORDER.map((z) => ({
          key: z,
          color: ZONE_COLORS[z],
          data: suppliers.filter((s) => s.zone === z),
        }));
  const present = series.filter((s) => s.data.length > 0);

  return (
    <ChartFrame height={450}>
      <ScatterChart margin={{ left: 24, right: 24, top: 16, bottom: 28 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          type="number"
          dataKey="log_spend"
          name="Total Spend"
          domain={["auto", "auto"]}
          tick={{ fontSize: 11 }}
          label={{
            value: "Total Spend (log USD) →",
            position: "insideBottom",
            offset: -12,
            fontSize: 12,
          }}
        />
        <YAxis
          type="number"
          dataKey="performance_score"
          name="Performance"
          domain={[0, 100]}
          width={56}
          tick={{ fontSize: 11 }}
          label={{
            value: "Performance Score →",
            angle: -90,
            position: "insideLeft",
            offset: 10,
            fontSize: 12,
          }}
        />
        <Tooltip
          content={<ScatterTooltip />}
          cursor={{ strokeDasharray: "3 3" }}
        />
        <Legend />
        <ReferenceLine
          x={thresholds.spend_median}
          stroke="#94a3b8"
          strokeDasharray="6 4"
        />
        <ReferenceLine
          y={thresholds.performance_median}
          stroke="#94a3b8"
          strokeDasharray="6 4"
        />
        {present.map((s) => (
          <Scatter
            key={s.key}
            name={s.key}
            data={s.data}
            fill={s.color}
            fillOpacity={0.8}
          />
        ))}
      </ScatterChart>
    </ChartFrame>
  );
}
