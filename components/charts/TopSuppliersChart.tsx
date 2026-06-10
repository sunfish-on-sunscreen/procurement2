"use client";

import {
  BarChart,
  Bar,
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

export function TopSuppliersChart({
  data,
}: {
  data: { supplier_name: string; total: number }[];
}) {
  return (
    <ChartFrame height={Math.max(300, data.length * 36)}>
      <BarChart data={data} layout="vertical" margin={{ left: 20, right: 24 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          tickFormatter={(value) => usdCompact.format(Number(value))}
          tick={{ fontSize: 11 }}
        />
        <YAxis
          type="category"
          dataKey="supplier_name"
          width={170}
          tick={{ fontSize: 11 }}
        />
        <Tooltip formatter={(value) => usd0.format(Number(value))} />
        <Bar dataKey="total" fill={CHART_COLORS[0]} radius={[0, 4, 4, 0]} />
      </BarChart>
    </ChartFrame>
  );
}
