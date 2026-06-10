"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  ReferenceLine,
} from "recharts";
import { ChartFrame } from "./ChartFrame";
import { CHART_COLORS } from "@/lib/chart-colors";

export function MonthlyCycleTrendChart({
  data,
}: {
  data: { month: string; mean_days: number }[];
}) {
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
        <Tooltip formatter={(value) => [`${Number(value).toFixed(1)} days`, "Mean"]} />
        <ReferenceLine
          x="2025-01"
          stroke="#ef4444"
          strokeDasharray="4 4"
          label={{
            value: "Automation introduced",
            position: "top",
            fontSize: 11,
            fill: "#ef4444",
          }}
        />
        <Line
          type="monotone"
          dataKey="mean_days"
          stroke={CHART_COLORS[0]}
          strokeWidth={2}
          dot={{ r: 2 }}
        />
      </LineChart>
    </ChartFrame>
  );
}
