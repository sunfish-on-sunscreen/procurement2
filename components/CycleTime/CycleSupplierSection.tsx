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
  type CycleSupplierRow,
} from "@/lib/cycle-time-types";
import { CHART_COLORS, ABC_COLORS, QUADRANT_COLORS } from "@/lib/chart-colors";
import { cardElevation } from "@/lib/utils";
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
import { PerfBar, SortArrow } from "@/components/RankingCells";
import { useTableSort, type SortDir } from "@/lib/use-table-sort";
import { CycleTimeSupplierDetailPanel } from "@/components/CycleTime/CycleTimeSupplierDetailPanel";
import { CycleFilterBanner } from "@/components/CycleTime/CycleFilterBanner";

/** Roster filter from the "Inconsistent suppliers" anomaly card. */
export type RosterFilter = { iqrThreshold: number; label: string; onClear: () => void };

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

// Chip — color-mix tint + token text; null → muted "—".
function Chip({ color, label }: { color: string | null; label: string | null }) {
  if (!color || !label) return <span className="text-muted-foreground">—</span>;
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`, color }}
    >
      {label}
    </span>
  );
}

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

// Sortable shadcn TableHead + shared SortArrow.
function SortHead({
  label,
  sortKey,
  active,
  dir,
  onSort,
  align = "left",
  defaultDir = "desc",
  width,
}: {
  label: string;
  sortKey: string;
  active: boolean;
  dir: SortDir;
  onSort: (key: string, defaultDir: SortDir) => void;
  align?: "left" | "right" | "center";
  defaultDir?: SortDir;
  width?: string;
}) {
  const alignText = align === "right" ? "text-right" : align === "center" ? "text-center" : "text-left";
  const alignJustify = align === "right" ? "flex-row-reverse" : align === "center" ? "justify-center" : "";
  return (
    <TableHead className={`${alignText} ${width ?? ""}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey, defaultDir)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${alignJustify}`}
      >
        {label}
        <SortArrow active={active} dir={active ? dir : "desc"} />
      </button>
    </TableHead>
  );
}

function BySupplier({
  rows,
  onSupplierClick,
  selectedSupplierId,
  rosterFilter,
}: {
  rows: CycleBreakdown["bySupplier"];
  onSupplierClick: (id: string) => void;
  selectedSupplierId: string | null;
  rosterFilter?: RosterFilter | null;
}) {
  const top = rows.slice(0, 15).map((r) => ({
    name: truncate(r.supplier_name, 22),
    full: r.supplier_name,
    median: r.median_cycle,
    iqr: r.iqr,
    po_count: r.po_count,
  }));

  const { sorted, sort, toggle } = useTableSort<CycleSupplierRow, string>(
    rows,
    (r, k) => (r as unknown as Record<string, number | string | null>)[k],
    "median_cycle",
    "desc",
  );

  // When the "Inconsistent suppliers" card is active, show only high-IQR
  // suppliers, ordered by IQR descending (decision C). Otherwise the normal
  // user-sortable view.
  const view = rosterFilter
    ? rows.filter((r) => r.iqr > rosterFilter.iqrThreshold).sort((a, b) => b.iqr - a.iqr)
    : sorted;

  return (
    <Card id="cycle-roster" className={cardElevation}>
      <CardHeader>
        <CardTitle>Cycle Time by Supplier</CardTitle>
        <CardDescription>
          Median procure-to-pay days per supplier in the selected period. The 15
          slowest are charted; the full roster is in the table below. Click a row
          for the per-supplier drill-down. Slow suppliers are the targets for
          cycle-time improvement.
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

        {rosterFilter && (
          <CycleFilterBanner
            label={rosterFilter.label}
            count={view.length}
            onClear={rosterFilter.onClear}
          />
        )}

        {rows.length > 0 && (
          <Table>
            <TableHeader>
              <TableRow>
                <SortHead label="Supplier" sortKey="supplier_name" active={sort.key === "supplier_name"} dir={sort.dir} onSort={toggle} defaultDir="asc" />
                <SortHead label="Median (d)" sortKey="median_cycle" active={sort.key === "median_cycle"} dir={sort.dir} onSort={toggle} align="right" />
                <SortHead label="IQR (d)" sortKey="iqr" active={sort.key === "iqr"} dir={sort.dir} onSort={toggle} align="right" />
                <SortHead label="POs" sortKey="po_count" active={sort.key === "po_count"} dir={sort.dir} onSort={toggle} align="right" />
                <SortHead label="ABC" sortKey="abc_class" active={sort.key === "abc_class"} dir={sort.dir} onSort={toggle} align="center" defaultDir="asc" width="w-[64px]" />
                <SortHead label="Exposure" sortKey="kraljic_quadrant" active={sort.key === "kraljic_quadrant"} dir={sort.dir} onSort={toggle} align="center" defaultDir="asc" width="w-[120px]" />
                <SortHead label="Performance" sortKey="composite" active={sort.key === "composite"} dir={sort.dir} onSort={toggle} align="right" width="w-[140px]" />
                <TableHead>Slowest stage</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {view.map((r) => (
                <TableRow
                  key={r.supplier_id}
                  onClick={() => onSupplierClick(r.supplier_id)}
                  className={`cursor-pointer ${
                    r.supplier_id === selectedSupplierId
                      ? "bg-foreground/5 ring-1 ring-inset ring-foreground/30"
                      : "hover:bg-muted/40"
                  }`}
                >
                  <TableCell className="font-medium">{r.supplier_name}</TableCell>
                  <TableCell className="text-right tabular-nums">{r.median_cycle.toFixed(1)}</TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">
                    {r.p25.toFixed(0)}–{r.p75.toFixed(0)}
                  </TableCell>
                  <TableCell className="text-right tabular-nums text-muted-foreground">{r.po_count}</TableCell>
                  <TableCell className="text-center">
                    <Chip color={r.abc_class ? ABC_COLORS[r.abc_class] : null} label={r.abc_class} />
                  </TableCell>
                  <TableCell className="text-center">
                    <Chip color={r.kraljic_quadrant ? QUADRANT_COLORS[r.kraljic_quadrant] : null} label={r.kraljic_quadrant} />
                  </TableCell>
                  <TableCell className="text-right">
                    <PerfBar score={r.composite} />
                  </TableCell>
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
    <Card className={cardElevation}>
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
  data: dataProp,
  rosterFilter,
}: {
  startDate: string;
  endDate: string;
  // When the parent supplies breakdown data (CycleTimeClient), this component is
  // presentational and skips its own fetch. Omitted → it fetches (standalone).
  data?: CycleBreakdown;
  rosterFilter?: RosterFilter | null;
}) {
  // Keyed state (no synchronous setState in the effect — matches the
  // SpendDecompositionPanel pattern the eslint config requires). The result is
  // only "current" when its key matches the active span, so a span change
  // immediately shows the loading state without resetting state in the effect.
  const key = `${startDate}_${endDate}`;
  const [state, setState] = useState<{ key: string; data?: CycleBreakdown; err?: string } | null>(null);
  const current = dataProp ? { data: dataProp, err: undefined } : state?.key === key ? state : null;
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);

  // Clear the open drill-down when the span changes (render-time compare; no
  // set-state-in-effect, matching the codebase's eslint rule).
  const [prevKey, setPrevKey] = useState(key);
  if (prevKey !== key) {
    setPrevKey(key);
    if (selectedSupplierId !== null) setSelectedSupplierId(null);
  }

  useEffect(() => {
    if (dataProp) return; // parent supplies data — no self-fetch
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
  }, [startDate, endDate, dataProp]);

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
      <BySupplier
        rows={current.data.bySupplier}
        onSupplierClick={setSelectedSupplierId}
        selectedSupplierId={selectedSupplierId}
        rosterFilter={rosterFilter}
      />
      <ByCategory rows={current.data.byCategory} />
      <CycleTimeSupplierDetailPanel
        supplierId={selectedSupplierId}
        startDate={startDate}
        endDate={endDate}
        onClose={() => setSelectedSupplierId(null)}
      />
    </>
  );
}
