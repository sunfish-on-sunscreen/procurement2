"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import {
  CYCLE_STAGES,
  type CycleBreakdown,
} from "@/lib/cycle-time-types";
import { CHART_COLORS } from "@/lib/chart-colors";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ChartFrame } from "@/components/charts/ChartFrame";

const truncate = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

// Slowest-stage colour family — reuse the shared chart palette so the stacked
// category chart and the per-supplier slowest-stage tags stay consistent.
const STAGE_COLOR: Record<string, string> = {
  pr_to_po: CHART_COLORS[0],
  po_to_delivery: CHART_COLORS[1],
  delivery_to_invoice: CHART_COLORS[2],
  invoice_to_payment: CHART_COLORS[3],
};

function SupplierBarTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: { full: string; median: number; iqr: number; po_count: number } }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="max-w-[240px] rounded-md border bg-background p-2 text-xs shadow-sm">
      <div className="font-medium">{d.full}</div>
      <div className="mt-1 text-muted-foreground">
        Median {d.median.toFixed(1)} d · IQR {d.iqr.toFixed(1)} d · {d.po_count} PO(s)
      </div>
    </div>
  );
}

function BySupplier({ rows }: { rows: CycleBreakdown["bySupplier"] }) {
  const top = rows.slice(0, 15).map((r) => ({
    name: truncate(r.supplier_name, 22),
    full: r.supplier_name,
    median: r.median_cycle,
    iqr: r.iqr,
    po_count: r.po_count,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Cycle Time by Supplier</CardTitle>
        <CardDescription>
          Median procure-to-pay days per supplier in the selected period. The 15
          slowest are charted; the full roster is in the table below. Slow
          suppliers are the targets for cycle-time improvement.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-6">
        {top.length > 0 ? (
          <ChartFrame height={Math.max(220, top.length * 26 + 24)}>
            <BarChart data={top} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis
                type="number"
                tick={{ fontSize: 10 }}
                tickFormatter={(v) => `${v}d`}
              />
              <YAxis
                type="category"
                dataKey="name"
                width={140}
                tick={{ fontSize: 10 }}
                interval={0}
              />
              <Tooltip content={<SupplierBarTooltip />} cursor={{ fillOpacity: 0.06 }} />
              <Bar dataKey="median" fill={CHART_COLORS[0]} radius={[0, 3, 3, 0]} isAnimationActive={false} />
            </BarChart>
          </ChartFrame>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No supplier activity in this period.
          </p>
        )}

        {rows.length > 0 && (
          <div className="max-h-[420px] overflow-y-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Supplier</TableHead>
                  <TableHead className="text-right">Median (d)</TableHead>
                  <TableHead className="text-right">IQR (d)</TableHead>
                  <TableHead className="text-right">POs</TableHead>
                  <TableHead>Slowest stage</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.supplier_id}>
                    <TableCell className="font-medium">{r.supplier_name}</TableCell>
                    <TableCell className="text-right">{r.median_cycle.toFixed(1)}</TableCell>
                    <TableCell className="text-right text-muted-foreground">
                      {r.p25.toFixed(0)}–{r.p75.toFixed(0)}
                    </TableCell>
                    <TableCell className="text-right text-muted-foreground">{r.po_count}</TableCell>
                    <TableCell>
                      <span
                        className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
                        style={{
                          backgroundColor: `color-mix(in srgb, ${STAGE_COLOR[r.slowest_stage]} 12%, transparent)`,
                          color: STAGE_COLOR[r.slowest_stage],
                        }}
                      >
                        {r.slowest_stage_label} ({r.slowest_stage_pct}%)
                      </span>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function ByCategory({ rows }: { rows: CycleBreakdown["byCategory"] }) {
  const data = rows.map((r) => ({
    name: truncate(r.category, 22),
    full: r.category,
    pr_to_po: r.pr_to_po,
    po_to_delivery: r.po_to_delivery,
    delivery_to_invoice: r.delivery_to_invoice,
    invoice_to_payment: r.invoice_to_payment,
  }));

  return (
    <Card>
      <CardHeader>
        <CardTitle>Stage Breakdown by Category</CardTitle>
        <CardDescription>
          Mean days in each procure-to-pay stage, per category. Reveals whether a
          category&apos;s delay is supplier-driven (PO → Delivery) or internal
          (PR → PO approval).
        </CardDescription>
      </CardHeader>
      <CardContent>
        {data.length > 0 ? (
          <ChartFrame height={Math.max(220, data.length * 34 + 40)}>
            <BarChart data={data} layout="vertical" margin={{ left: 8, right: 24, top: 4, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" horizontal={false} />
              <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}d`} />
              <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 10 }} interval={0} />
              <Tooltip
                formatter={(v, n) => [`${Number(v).toFixed(1)} d`, String(n)]}
                cursor={{ fillOpacity: 0.06 }}
              />
              <Legend wrapperStyle={{ fontSize: 11 }} />
              {CYCLE_STAGES.map((s) => (
                <Bar
                  key={s.key}
                  dataKey={s.key}
                  name={s.label}
                  stackId="stage"
                  fill={STAGE_COLOR[s.key]}
                  isAnimationActive={false}
                />
              ))}
            </BarChart>
          </ChartFrame>
        ) : (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No category activity in this period.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function CycleSupplierSection({
  startDate,
  endDate,
}: {
  startDate: string;
  endDate: string;
}) {
  // Keyed state (no synchronous setState in the effect — matches the
  // SpendDecompositionPanel pattern the eslint config requires). The result is
  // only "current" when its key matches the active span, so a span change
  // immediately shows the loading state without resetting state in the effect.
  const key = `${startDate}_${endDate}`;
  const [state, setState] = useState<{ key: string; data?: CycleBreakdown; err?: string } | null>(null);
  const current = state?.key === key ? state : null;

  useEffect(() => {
    let cancelled = false;
    const k = `${startDate}_${endDate}`;
    fetch(`/api/cycle-time/breakdown?start=${startDate}&end=${endDate}`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(
            ((await res.json().catch(() => ({}))) as { error?: string }).error ||
              "Failed to load",
          );
        }
        return res.json() as Promise<CycleBreakdown>;
      })
      .then((d) => {
        if (!cancelled) setState({ key: k, data: d });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ key: k, err: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate]);

  if (current?.err) {
    return <p className="text-sm text-destructive">{current.err}</p>;
  }
  if (!current?.data) {
    return (
      <div className="flex items-center gap-2 text-sm text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading supplier breakdown…
      </div>
    );
  }

  return (
    <>
      <BySupplier rows={current.data.bySupplier} />
      <ByCategory rows={current.data.byCategory} />
    </>
  );
}
