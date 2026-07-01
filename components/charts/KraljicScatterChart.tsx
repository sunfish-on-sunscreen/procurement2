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
import { QUADRANT_COLORS } from "@/lib/chart-colors";
import type { QuadrantAssignment, KraljicQuadrant } from "@/lib/analysis-types";
import { buildSpendAxis, spendMoneyAndShare } from "@/lib/spend-axis";
import { PinnableDot } from "./PinnableDot";

// Stable legend order: high-priority quadrants first.
const QUADRANT_ORDER: KraljicQuadrant[] = [
  "Strategic",
  "Leverage",
  "Bottleneck",
  "Routine",
];

type ScatterTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload: QuadrantAssignment }>;
  // Injected by Recharts via cloneElement from the <Tooltip content> prop.
  total?: number;
};

function ScatterTooltip({ active, payload, total = 0 }: ScatterTooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border bg-background p-2 text-xs shadow-sm">
      <div className="font-medium">{d.supplier_name}</div>
      <div className="text-muted-foreground">
        <span style={{ color: QUADRANT_COLORS[d.quadrant] }}>{d.quadrant}</span>
      </div>
      <div className="mt-1 text-muted-foreground">
        {spendMoneyAndShare(Math.expm1(d.log_spend), total)} &middot; Risk{" "}
        {d.supply_risk_score.toFixed(1)}
      </div>
    </div>
  );
}

export function KraljicScatterChart({
  assignments,
  thresholds,
}: {
  assignments: QuadrantAssignment[];
  thresholds: { spend_median: number; risk_median: number };
}) {
  const present = QUADRANT_ORDER.filter((q) =>
    assignments.some((a) => a.quadrant === q),
  );

  // VIZ-ONLY %-of-spend axis: positions stay at log_spend; only the labels change.
  // Raw spend is recovered from log_spend (expm1) since QuadrantAssignment doesn't
  // carry it — a display derivation, no compute change.
  const total = assignments.reduce((sum, a) => sum + Math.expm1(a.log_spend), 0);
  const axis = buildSpendAxis(
    assignments.map((a) => a.log_spend),
    total,
  );

  return (
    <ChartFrame height={450}>
      <ScatterChart margin={{ left: 24, right: 24, top: 16, bottom: 28 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          type="number"
          dataKey="log_spend"
          name="Profit Impact"
          domain={axis.domain ?? ["auto", "auto"]}
          ticks={axis.ticks}
          tickFormatter={axis.tickFormatter}
          tick={{ fontSize: 11 }}
          label={{
            value: "Profit impact (% of total spend) →",
            position: "insideBottom",
            offset: -12,
            fontSize: 12,
          }}
        />
        <YAxis
          type="number"
          dataKey="supply_risk_score"
          name="Supply Risk"
          domain={[0, "auto"]}
          width={56}
          tick={{ fontSize: 11 }}
          label={{
            value: "Supply Risk (0–100) →",
            angle: -90,
            position: "insideLeft",
            offset: 10,
            fontSize: 12,
          }}
        />
        <Tooltip
          content={<ScatterTooltip total={total} />}
          cursor={{ strokeDasharray: "3 3" }}
        />
        {/* Top-aligned so the 4 quadrant labels don't collide with the bottom
            X-axis title (they previously overlapped/overflowed). */}
        <Legend verticalAlign="top" height={32} wrapperStyle={{ fontSize: 12 }} />
        <ReferenceLine
          x={thresholds.spend_median}
          stroke="#94a3b8"
          strokeDasharray="6 4"
        />
        <ReferenceLine
          y={thresholds.risk_median}
          stroke="#94a3b8"
          strokeDasharray="6 4"
        />
        {present.map((q) => (
          <Scatter
            key={q}
            name={q}
            data={assignments.filter((a) => a.quadrant === q)}
            fill={QUADRANT_COLORS[q]}
            fillOpacity={0.8}
            shape={<PinnableDot />}
            isAnimationActive={false}
          />
        ))}
      </ScatterChart>
    </ChartFrame>
  );
}
