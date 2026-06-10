"use client";

import { PieChart, Pie, Cell, Tooltip, Legend } from "recharts";
import { ChartFrame } from "./ChartFrame";
import { CHART_COLORS } from "@/lib/chart-colors";

const usdCompact = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  notation: "compact",
  maximumFractionDigits: 1,
});

export function SpendByCategoryChart({
  data,
}: {
  data: { category: string; total: number }[];
}) {
  const total = data.reduce((sum, d) => sum + d.total, 0);

  return (
    <ChartFrame height={300}>
      <PieChart>
        <Pie
          data={data}
          dataKey="total"
          nameKey="category"
          innerRadius={60}
          outerRadius={100}
          paddingAngle={1}
        >
          {data.map((_, i) => (
            <Cell key={i} fill={CHART_COLORS[i % CHART_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value, name) => [
            `${usdCompact.format(Number(value))} (${total ? ((Number(value) / total) * 100).toFixed(1) : "0"}%)`,
            name,
          ]}
        />
        <Legend />
      </PieChart>
    </ChartFrame>
  );
}
