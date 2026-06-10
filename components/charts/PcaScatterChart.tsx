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
import { CHART_COLORS } from "@/lib/chart-colors";
import type { ClusterAssignment } from "@/lib/analysis-types";

type ScatterTooltipProps = {
  active?: boolean;
  payload?: Array<{ payload: ClusterAssignment }>;
};

function ScatterTooltip({ active, payload }: ScatterTooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border bg-background p-2 text-xs shadow-sm">
      <div className="font-medium">{d.supplier_name}</div>
      <div className="text-muted-foreground">
        {d.tier} &middot; Cluster {d.cluster}
      </div>
    </div>
  );
}

export function PcaScatterChart({
  data,
  explainedVariance,
}: {
  data: ClusterAssignment[];
  explainedVariance: { pc1: number; pc2: number };
}) {
  const clusters = Array.from(new Set(data.map((d) => d.cluster))).sort(
    (a, b) => a - b,
  );

  return (
    <ChartFrame height={450}>
      <ScatterChart margin={{ left: 16, right: 16, top: 12, bottom: 24 }}>
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
          tick={{ fontSize: 11 }}
          label={{
            value: `PC2 (${explainedVariance.pc2.toFixed(1)}% variance)`,
            angle: -90,
            position: "insideLeft",
            fontSize: 12,
          }}
        />
        <Tooltip content={<ScatterTooltip />} cursor={{ strokeDasharray: "3 3" }} />
        <Legend />
        {clusters.map((c) => (
          <Scatter
            key={c}
            name={`Cluster ${c}`}
            data={data.filter((d) => d.cluster === c)}
            fill={CHART_COLORS[c % CHART_COLORS.length]}
          />
        ))}
      </ScatterChart>
    </ChartFrame>
  );
}
