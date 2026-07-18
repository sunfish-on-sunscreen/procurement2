"use client";

import { PieChart, Pie, Cell, Tooltip, Legend } from "recharts";
import { ChartFrame } from "./ChartFrame";
import { CATEGORY_COLORS } from "@/lib/chart-colors";

// Tooltips use FULL numbers (matches TopSuppliers / MonthlyTrend tooltips and
// the report convention); axes/labels elsewhere stay compact.
const usd0 = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
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
            <Cell key={i} fill={CATEGORY_COLORS[i % CATEGORY_COLORS.length]} />
          ))}
        </Pie>
        <Tooltip
          formatter={(value, name) => [
            `${usd0.format(Number(value))} (${total ? ((Number(value) / total) * 100).toFixed(1) : "0"}%)`,
            name,
          ]}
        />
        <Legend />
      </PieChart>
    </ChartFrame>
  );
}
