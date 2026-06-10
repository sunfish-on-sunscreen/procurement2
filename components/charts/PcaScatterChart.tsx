"use client";

import {
  ScatterChart,
  Scatter,
  XAxis,
  YAxis,
  Tooltip,
  Legend,
  CartesianGrid,
} from "recharts";
import { ChartFrame } from "./ChartFrame";
import { SEGMENT_COLORS } from "@/lib/chart-colors";
import type { ClusterAssignment } from "@/lib/analysis-types";

// Stable legend order (best -> peripheral).
const SEGMENT_ORDER = [
  "Star Performers",
  "Reliable Specialists",
  "Strategic Underperformers",
  "Tail Spenders",
];

type ScatterTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload: ClusterAssignment }>;
  segmentNames: Record<number, string>;
};

function ScatterTooltip({ active, payload, segmentNames }: ScatterTooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  const segment = segmentNames[d.cluster] ?? `Cluster ${d.cluster}`;
  return (
    <div className="rounded-md border bg-background p-2 text-xs shadow-sm">
      <div className="font-medium">{d.supplier_name}</div>
      <div className="text-muted-foreground">
        {segment} &middot; {d.tier}
      </div>
    </div>
  );
}

export function PcaScatterChart({
  data,
  explainedVariance,
  segmentNames,
}: {
  data: ClusterAssignment[];
  explainedVariance: { pc1: number; pc2: number };
  segmentNames: Record<number, string>;
}) {
  const present = SEGMENT_ORDER.filter((name) =>
    data.some((d) => segmentNames[d.cluster] === name),
  );

  return (
    <ChartFrame height={450}>
      <ScatterChart margin={{ left: 24, right: 16, top: 12, bottom: 24 }}>
        <CartesianGrid strokeDasharray="3 3" />
        <XAxis
          type="number"
          dataKey="pca1"
          name="PC1"
          tick={{ fontSize: 11 }}
          label={{
            value: `PC1 (${explainedVariance.pc1.toFixed(1)}% variance)`,
            position: "insideBottom",
            offset: -10,
            fontSize: 12,
          }}
        />
        <YAxis
          type="number"
          dataKey="pca2"
          name="PC2"
          width={56}
          tick={{ fontSize: 11 }}
          label={{
            value: `PC2 (${explainedVariance.pc2.toFixed(1)}% variance)`,
            angle: -90,
            position: "insideLeft",
            offset: 10,
            fontSize: 12,
          }}
        />
        <Tooltip
          content={<ScatterTooltip segmentNames={segmentNames} />}
          cursor={{ strokeDasharray: "3 3" }}
        />
        <Legend />
        {present.map((name) => (
          <Scatter
            key={name}
            name={name}
            data={data.filter((d) => segmentNames[d.cluster] === name)}
            fill={SEGMENT_COLORS[name]}
          />
        ))}
      </ScatterChart>
    </ChartFrame>
  );
}
