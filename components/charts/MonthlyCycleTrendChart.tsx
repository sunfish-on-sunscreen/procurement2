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

/**
 * Monthly mean total-cycle-time with a trailing 3-month rolling average
 * overlay (dashed). No SLA target or benchmark line — actual data only.
 */
export function MonthlyCycleTrendChart({
  trend,
  rolling,
}: {
  trend: { month: string; avg_cycle_days: number; po_count: number }[];
  rolling: { month: string; rolling_3mo: number }[];
}) {
  const rollByMonth = new Map(rolling.map((r) => [r.month, r.rolling_3mo]));
  const data = trend.map((t) => ({
    month: t.month,
    avg_cycle_days: t.avg_cycle_days,
    rolling_3mo: rollByMonth.get(t.month) ?? null,
    po_count: t.po_count,
  }));

  return (
    <ChartFrame height={320}>
      <LineChart data={data} margin={{ left: 10, right: 24, top: 16, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="month" tick={{ fontSize: 10 }} />
        <YAxis
          width={48}
          tick={{ fontSize: 11 }}
          label={{ value: "days", angle: -90, position: "insideLeft", fontSize: 11 }}
        />
        <Tooltip
          formatter={(value, name) =>
            value == null
              ? ["—", name as string]
              : [`${Number(value).toFixed(1)} days`, name as string]
          }
        />
        <Legend />
        <Line
          type="monotone"
          dataKey="avg_cycle_days"
          name="Monthly mean"
          stroke={CHART_COLORS[0]}
          strokeWidth={2}
          dot={{ r: 2 }}
        />
        <Line
          type="monotone"
          dataKey="rolling_3mo"
          name="3-month rolling avg"
          stroke={CHART_COLORS[1]}
          strokeWidth={2}
          strokeDasharray="5 4"
          dot={false}
          connectNulls
        />
      </LineChart>
    </ChartFrame>
  );
}
