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
import { useAnimatedDomain, paddedDomain, type Domain } from "./useAnimatedDomain";

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
  zoomQuadrant = null,
  onDotClick,
}: {
  assignments: QuadrantAssignment[];
  thresholds: { spend_median: number; risk_median: number };
  /** When set, the axes animate-zoom to fit this quadrant's suppliers (Change 1). */
  zoomQuadrant?: KraljicQuadrant | null;
  /** Fires with the supplier id when a point is clicked. */
  onDotClick?: (supplierId: string) => void;
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

  // Numeric full domains (the tween endpoints). X mirrors the buildSpendAxis
  // padded domain; Y mimics the [0,"auto"] top with a little headroom.
  const xsAll = assignments.map((a) => a.log_spend);
  const risksAll = assignments.map((a) => a.supply_risk_score);
  const fullX: Domain = axis.domain ?? [Math.min(...xsAll) - 0.5, Math.max(...xsAll) + 0.5];
  const fullY: Domain = [0, (risksAll.length ? Math.max(...risksAll) : 100) * 1.08];

  // Target = the zoomed group's padded bounds, or the full view.
  const group = zoomQuadrant ? assignments.filter((a) => a.quadrant === zoomQuadrant) : [];
  const zoomed = group.length > 0;
  const target = zoomed
    ? {
        x: paddedDomain(group.map((a) => a.log_spend), fullX[1] - fullX[0]),
        y: paddedDomain(group.map((a) => a.supply_risk_score), fullY[1] - fullY[0], {
          clamp: [0, 100],
        }),
      }
    : { x: fullX, y: fullY };

  const view = useAnimatedDomain(target);
  // At rest in the full view, render the ORIGINAL axis config (nice %-decade
  // ticks, [0,"auto"] top) so the default view is unchanged; use the interpolated
  // numeric domain only while zoomed/animating.
  const atFull =
    !zoomed &&
    Math.abs(view.x[0] - fullX[0]) < 1e-6 &&
    Math.abs(view.x[1] - fullX[1]) < 1e-6 &&
    Math.abs(view.y[1] - fullY[1]) < 1e-6;

  return (
    <ChartFrame height={450}>
      <ScatterChart margin={{ left: 24, right: 24, top: 16, bottom: 28 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          type="number"
          dataKey="log_spend"
          name="Profit Impact"
          domain={atFull ? axis.domain ?? ["auto", "auto"] : view.x}
          ticks={atFull ? axis.ticks : undefined}
          tickFormatter={axis.tickFormatter}
          allowDataOverflow
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
          domain={atFull ? [0, "auto"] : view.y}
          width={56}
          allowDataOverflow
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
            // When zoomed, show ONLY the selected group's dots (others → []), so
            // the zoomed frame isn't polluted by neighbours the padded window
            // happens to overlap. All series return on reset/zoom-out.
            data={zoomQuadrant && q !== zoomQuadrant ? [] : assignments.filter((a) => a.quadrant === q)}
            fill={QUADRANT_COLORS[q]}
            fillOpacity={0.8}
            shape={<PinnableDot onSelect={onDotClick} />}
            isAnimationActive={false}
          />
        ))}
      </ScatterChart>
    </ChartFrame>
  );
}
