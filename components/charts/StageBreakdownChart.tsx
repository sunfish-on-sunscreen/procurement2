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
import type { StageBreakdown } from "@/lib/analysis-types";

const STAGES: { key: keyof StageBreakdown; label: string }[] = [
  { key: "pr_to_po", label: "PR → PO" },
  { key: "po_to_delivery", label: "PO → Delivery" },
  { key: "delivery_to_invoice", label: "Delivery → Invoice" },
  { key: "invoice_to_payment", label: "Invoice → Payment" },
];

type TipProps = {
  active?: boolean;
  label?: string;
  payload?: Array<{ name: string; value: number; color: string }>;
};

function StageTooltip({ active, payload, label }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-background p-2 text-xs shadow-sm">
      <div className="font-medium">{label}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ color: p.color }}>
          {p.name}: {p.value.toFixed(1)} d
        </div>
      ))}
    </div>
  );
}

export function StageBreakdownChart({
  pre,
  post,
}: {
  pre: StageBreakdown;
  post: StageBreakdown;
}) {
  const rows = STAGES.map((s) => ({
    stage: s.label,
    pre: pre[s.key] ?? 0,
    post: post[s.key] ?? 0,
  }));

  return (
    <ChartFrame height={300}>
      <BarChart
        layout="vertical"
        data={rows}
        margin={{ left: 16, right: 16, top: 8, bottom: 16 }}
      >
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis
          type="number"
          tick={{ fontSize: 11 }}
          label={{
            value: "Mean days",
            position: "insideBottom",
            offset: -6,
            fontSize: 11,
          }}
        />
        <YAxis
          type="category"
          dataKey="stage"
          width={120}
          tick={{ fontSize: 11 }}
        />
        <Tooltip content={<StageTooltip />} cursor={{ fill: "transparent" }} />
        <Legend />
        <Bar dataKey="pre" name="Pre (2024)" fill="#94a3b8" radius={[0, 4, 4, 0]} />
        <Bar
          dataKey="post"
          name="Post (2025)"
          fill="#10b981"
          radius={[0, 4, 4, 0]}
        />
      </BarChart>
    </ChartFrame>
  );
}
