"use client";

import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import { ChartFrame } from "./ChartFrame";
import { CHART_COLORS } from "@/lib/chart-colors";
import type { TopSupplier } from "@/lib/analysis-types";
import { usePin } from "@/components/Reports/PinContext";

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

type TooltipProps = {
  active?: boolean;
  payload?: Array<{ payload: TopSupplier }>;
};

function TopSupplierTooltip({ active, payload }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-md border bg-background p-2 text-xs shadow-sm">
      <div className="font-medium">{d.supplier_name}</div>
      <div className="text-muted-foreground">{usd0.format(d.total)}</div>
    </div>
  );
}

export function TopSuppliersChart({ data }: { data: TopSupplier[] }) {
  const { pinnedSupplierId, pin } = usePin();
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
        <Tooltip content={<TopSupplierTooltip />} cursor={{ fillOpacity: 0.06 }} />
        <Bar
          dataKey="total"
          radius={[0, 4, 4, 0]}
          isAnimationActive={false}
          onClick={(_d, index) => {
            const id = data[index]?.supplier_id;
            if (id) pin(id);
          }}
          className="cursor-pointer"
        >
          {data.map((d, i) => {
            const pinned = d.supplier_id != null && d.supplier_id === pinnedSupplierId;
            return (
              <Cell
                key={i}
                fill={CHART_COLORS[0]}
                stroke={pinned ? "currentColor" : undefined}
                strokeWidth={pinned ? 2 : undefined}
              />
            );
          })}
        </Bar>
      </BarChart>
    </ChartFrame>
  );
}
