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
import type { KraljicQuadrant, QuadrantCycleStats } from "@/lib/analysis-types";

const ORDER: KraljicQuadrant[] = [
  "Strategic",
  "Leverage",
  "Bottleneck",
  "Routine",
];

type TipProps = {
  active?: boolean;
  label?: string;
  payload?: Array<{ name: string; value: number | null; color: string }>;
};

function CycleTooltip({ active, payload, label }: TipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-background p-2 text-xs shadow-sm">
      <div className="font-medium">{label}</div>
      {payload.map((p) => (
        <div key={p.name} style={{ color: p.color }}>
          {p.name}: {p.value == null ? "—" : `${p.value.toFixed(1)} d`}
        </div>
      ))}
    </div>
  );
}

export function CycleByQuadrantChart({
  data,
}: {
  data: Record<KraljicQuadrant, QuadrantCycleStats | null>;
}) {
  const rows = ORDER.map((q) => {
    const s = data[q];
    return {
      quadrant: q,
      pre: s?.pre_mean ?? null,
      post: s?.post_mean ?? null,
    };
  });

  return (
    <ChartFrame height={300}>
      <BarChart data={rows} margin={{ left: 8, right: 16, top: 12, bottom: 8 }}>
        <CartesianGrid strokeDasharray="3 3" vertical={false} />
        <XAxis dataKey="quadrant" tick={{ fontSize: 12 }} />
        <YAxis
          width={48}
          tick={{ fontSize: 11 }}
          label={{
            value: "Invoice→payment (days)",
            angle: -90,
            position: "insideLeft",
            fontSize: 10,
          }}
        />
        <Tooltip content={<CycleTooltip />} cursor={{ fill: "transparent" }} />
        <Legend />
        <Bar dataKey="pre" name="Pre (2024)" fill="#94a3b8" radius={[4, 4, 0, 0]} />
        <Bar
          dataKey="post"
          name="Post (2025)"
          fill="#10b981"
          radius={[4, 4, 0, 0]}
        />
      </BarChart>
    </ChartFrame>
  );
}
