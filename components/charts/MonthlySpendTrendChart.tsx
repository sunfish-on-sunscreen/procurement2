"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { ChartFrame } from "./ChartFrame";
import { CHART_COLORS } from "@/lib/chart-colors";

const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});
const usd0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
});

export function MonthlySpendTrendChart({
  data,
}: {
  data: { month: string; total: number }[];
}) {
  return (
    <ChartFrame height={300}>
      <LineChart data={data} margin={{ left: 10, right: 24, top: 10, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis dataKey="month" tick={{ fontSize: 11 }} />
        <YAxis
          width={72}
          tickFormatter={(value) => usdCompact.format(Number(value))}
          tick={{ fontSize: 11 }}
        />
        <Tooltip formatter={(value) => usd0.format(Number(value))} />
        <Line
          type="monotone"
          dataKey="total"
          stroke={CHART_COLORS[0]}
          strokeWidth={2}
          dot={{ r: 3 }}
        />
      </LineChart>
    </ChartFrame>
  );
}
