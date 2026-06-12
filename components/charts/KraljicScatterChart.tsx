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
};

function ScatterTooltip({ active, payload }: ScatterTooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border bg-background p-2 text-xs shadow-sm">
      <div className="font-medium">{d.supplier_name}</div>
      <div className="text-muted-foreground">
        <span style={{ color: QUADRANT_COLORS[d.quadrant] }}>{d.quadrant}</span>{" "}
        &middot; {d.tier}
      </div>
      <div className="mt-1 text-muted-foreground">
        Log spend {d.log_spend.toFixed(2)} &middot; Risk{" "}
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

  return (
    <ChartFrame height={450}>
      <ScatterChart margin={{ left: 24, right: 24, top: 16, bottom: 28 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          type="number"
          dataKey="log_spend"
          name="Profit Impact"
          domain={["auto", "auto"]}
          tick={{ fontSize: 11 }}
          label={{
            value: "Profit Impact (log spend) →",
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
          />
        ))}
      </ScatterChart>
    </ChartFrame>
  );
}
