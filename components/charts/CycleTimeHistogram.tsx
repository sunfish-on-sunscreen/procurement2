"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import { ChartFrame } from "./ChartFrame";
import type { HypothesisResult } from "@/lib/analysis-types";

export function CycleTimeHistogram({ data }: { data: HypothesisResult }) {
  const h = data.histogram;
  if (!h || h.bin_centers.length === 0) return null;

  const chartData = h.bin_centers.map((center, i) => ({
    bin: center,
    pre: h.pre[i] ?? 0,
    post: h.post[i] ?? 0,
  }));

  return (
    <ChartFrame height={320}>
      <BarChart data={chartData} margin={{ left: 8, right: 16, top: 12, bottom: 22 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          dataKey="bin"
          tick={{ fontSize: 10 }}
          label={{
            value: "invoice-to-payment days",
            position: "insideBottom",
            offset: -10,
            fontSize: 11,
          }}
        />
        <YAxis width={36} tick={{ fontSize: 11 }} />
        <Tooltip />
        <Legend />
        <Bar dataKey="pre" name="Pre (2024)" fill="#3b82f6" fillOpacity={0.6} />
        <Bar dataKey="post" name="Post (2025)" fill="#10b981" fillOpacity={0.6} />
      </BarChart>
    </ChartFrame>
  );
}
