"use client";

import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { ChartFrame } from "./ChartFrame";
import { QUADRANT_COLORS } from "@/lib/chart-colors";
import type { KraljicQuadrant } from "@/lib/analysis-types";

const QUADRANT_ORDER: KraljicQuadrant[] = [
  "Strategic",
  "Leverage",
  "Bottleneck",
  "Routine",
];

type BarTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload: { quadrant: string; performance: number } }>;
};

function BarTooltip({ active, payload }: BarTooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border bg-background p-2 text-xs shadow-sm">
      <div className="font-medium">{d.quadrant}</div>
      <div className="text-muted-foreground">
        Avg performance {d.performance.toFixed(1)}
      </div>
    </div>
  );
}

export function PerformanceByQuadrantChart({
  data,
}: {
  data: Record<KraljicQuadrant, number>;
}) {
  const rows = QUADRANT_ORDER.map((q) => ({
    quadrant: q,
    performance: data[q] ?? 0,
  }));

  return (
    <ChartFrame height={300}>
      <BarChart data={rows} margin={{ left: 8, right: 16, top: 12, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="quadrant" tick={{ fontSize: 12 }} />
        <YAxis domain={[0, 100]} width={40} tick={{ fontSize: 11 }} />
        <Tooltip content={<BarTooltip />} cursor={{ fill: "transparent" }} />
        <ReferenceLine
          y={50}
          stroke="#94a3b8"
          strokeDasharray="6 4"
          label={{ value: "neutral (50)", position: "right", fontSize: 10 }}
        />
        <Bar dataKey="performance" radius={[4, 4, 0, 0]}>
          {rows.map((r) => (
            <Cell key={r.quadrant} fill={QUADRANT_COLORS[r.quadrant]} />
          ))}
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}
