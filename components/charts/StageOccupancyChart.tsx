"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import { ChartFrame } from "./ChartFrame";
import { CHART_COLORS } from "@/lib/chart-colors";
import type { StageOccupancyRow } from "@/lib/cycle-time-types";

// Same colour family as the stage tags elsewhere on the page (CHART_COLORS[0–3]).
const SERIES = [
  { key: "pr_active", label: "PR active", color: CHART_COLORS[0] },
  { key: "po_active", label: "PO active", color: CHART_COLORS[1] },
  { key: "delivery_active", label: "Delivery active", color: CHART_COLORS[2] },
  { key: "invoice_active", label: "Invoice active", color: CHART_COLORS[3] },
] as const;

type OccTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload: StageOccupancyRow }>;
};

function OccupancyTooltip({ active, payload }: OccTooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border bg-background p-2 text-xs shadow-sm">
      <div className="font-medium">{d.month}</div>
      {SERIES.map((s) => (
        <div key={s.key} className="mt-0.5 flex items-center gap-1.5 text-muted-foreground">
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: s.color }} />
          {s.label} <span className="tabular-nums">{d[s.key].toFixed(0)}</span>
        </div>
      ))}
    </div>
  );
}

/**
 * Whole-integer count of POs active in each of the four stages per month. Four
 * lines; no rolling-average overlay. Y = number of POs in that stage during the
 * month (a PO is counted once in every stage it touches, so per-month totals can
 * exceed the PO count). Fed span-scoped data from the API route.
 */
export function StageOccupancyChart({ data }: { data: StageOccupancyRow[] }) {
  return (
    <ChartFrame height={320}>
      <LineChart data={data} margin={{ left: 12, right: 24, top: 16, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="month" tick={{ fontSize: 10 }} />
        <YAxis
          width={60}
          tick={{ fontSize: 11 }}
          label={{
            value: "POs active",
            angle: -90,
            position: "insideLeft",
            fontSize: 11,
          }}
        />
        <Tooltip content={<OccupancyTooltip />} />
        <Legend />
        {SERIES.map((s) => (
          <Line
            key={s.key}
            type="monotone"
            dataKey={s.key}
            name={s.label}
            stroke={s.color}
            strokeWidth={2}
            dot={{ r: 2 }}
          />
        ))}
      </LineChart>
    </ChartFrame>
  );
}
