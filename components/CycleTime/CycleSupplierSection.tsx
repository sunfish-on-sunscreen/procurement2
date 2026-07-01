"use client";

import { useEffect, useMemo, useState } from "react";
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
  type CycleFlagKey,
  type SupplierFlagState,
} from "@/lib/cycle-time-types";
import { CHART_COLORS, ABC_COLORS, QUADRANT_COLORS } from "@/lib/chart-colors";
import { cardElevation, cn } from "@/lib/utils";
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

const truncate = (s: string, n: number) =>
  s.length > n ? `${s.slice(0, n - 1)}…` : s;

// Stacked-category colour family (still used by the per-category chart).
const STAGE_COLOR: Record<string, string> = {
  pr_to_po: CHART_COLORS[0],
  po_to_delivery: CHART_COLORS[1],
  delivery_to_invoice: CHART_COLORS[2],
  invoice_to_payment: CHART_COLORS[3],
};

// Supplier-flag identity — small colour dot + text label (never colour alone).
const FLAG_META: Record<CycleFlagKey, { label: string; color: string }> = {
  has_outlier: { label: "Outlier", color: "var(--warning)" },
  inconsistent: { label: "Inconsistent", color: "var(--primary)" },
  has_stage_dom: { label: "Stage-dom", color: "var(--destructive)" },
};
const FLAG_ORDER: CycleFlagKey[] = ["has_outlier", "inconsistent", "has_stage_dom"];

const CHIPS: { key: CycleFlagKey; label: string }[] = [
  { key: "has_outlier", label: "Has outlier POs" },
  { key: "inconsistent", label: "Inconsistent" },
  { key: "has_stage_dom", label: "Has stage-dominated POs" },
];

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

/** Per-supplier flag pills (muted bg + colour dot + label), or "—" if none. */
function FlagPills({ flags }: { flags?: SupplierFlagState }) {
  const on = flags ? FLAG_ORDER.filter((k) => flags[k]) : [];
  if (on.length === 0) return <span className="text-muted-foreground">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {on.map((k) => (
        <span
          key={k}
          className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
        >
          <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: FLAG_META[k].color }} />
          {FLAG_META[k].label}
        </span>
      ))}
    </div>
  );
}

/** Filter chips above the roster ([All] + one per flag). Synced with the flag
 * cards via the shared active-flag state owned by CycleTimeClient. */
function FilterChips({
  active,
  counts,
  onSelect,
}: {
  active: CycleFlagKey | null;
  counts: Record<CycleFlagKey, number>;
  onSelect: (k: CycleFlagKey | null) => void;
}) {
  const chip = (isActive: boolean) =>
    cn(
      "rounded-full border px-3 py-1 text-xs font-medium transition-colors",
      isActive
        ? "border-foreground/30 bg-foreground/10 text-foreground"
        : "bg-muted/30 text-muted-foreground hover:bg-muted/50",
    );
  return (
    <div className="flex flex-wrap gap-2">
      <button type="button" onClick={() => onSelect(null)} aria-pressed={active === null} className={chip(active === null)}>
        All
      </button>
      {CHIPS.map((c) => (
        <button
          key={c.key}
          type="button"
          onClick={() => onSelect(c.key)}
          aria-pressed={active === c.key}
          className={chip(active === c.key)}
        >
          {c.label} ({counts[c.key]})
        </button>
      ))}
    </div>
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
  flagsBySupplier,
  flagCounts,
  activeFlag,
  onSelectFlag,
  onSupplierClick,
  selectedSupplierId,
}: {
  rows: CycleBreakdown["bySupplier"];
  flagsBySupplier: Map<string, SupplierFlagState>;
  flagCounts: Record<CycleFlagKey, number>;
  activeFlag: CycleFlagKey | null;
  onSelectFlag: (k: CycleFlagKey | null) => void;
  onSupplierClick: (id: string) => void;
  selectedSupplierId: string | null;
}) {
  // Single filter drives BOTH the chart and the table (fixes the prior split
  // where the chart stayed unfiltered). `rows` arrives median-desc from the API,
  // so the filtered slice stays "the slowest N among the flagged set".
  const filteredRows = activeFlag
    ? rows.filter((r) => flagsBySupplier.get(r.supplier_id)?.[activeFlag])
    : rows;

  const top = filteredRows.slice(0, 15).map((r) => ({
    name: truncate(r.supplier_name, 22),
    full: r.supplier_name,
    median: r.median_cycle,
    iqr: r.iqr,
    po_count: r.po_count,
  }));

  const { sorted, sort, toggle } = useTableSort<CycleSupplierRow, string>(
    filteredRows,
    (r, k) => (r as unknown as Record<string, number | string | null>)[k],
    "median_cycle",
    "desc",
  );

  return (
    <Card id="cycle-roster" className={cardElevation}>
      <CardHeader>
        <CardTitle>Cycle Time by Supplier</CardTitle>
        <CardDescription>
          Median procure-to-pay days per supplier in the selected period. The 15
          slowest are charted; the full roster is in the table below. Click a row
          for the per-supplier drill-down. Use the flags to focus on suppliers with
          outlier, inconsistent, or stage-dominated cycles.
        </CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <FilterChips active={activeFlag} counts={flagCounts} onSelect={onSelectFlag} />
          {activeFlag && (
            <span className="text-xs text-muted-foreground">
              Showing {filteredRows.length} of {rows.length} suppliers
            </span>
          )}
        </div>

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
            {activeFlag ? "No suppliers match this flag." : "No supplier activity in this period."}
          </p>
        )}

        {filteredRows.length > 0 && (
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
                <TableHead className="w-[220px]">Flags</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {sorted.map((r) => (
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
                    <FlagPills flags={flagsBySupplier.get(r.supplier_id)} />
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
  flagsBySupplier,
  flagCounts,
  activeFlag,
  onSelectFlag,
}: {
  startDate: string;
  endDate: string;
  // When the parent supplies breakdown data (CycleTimeClient), this component is
  // presentational and skips its own fetch. Omitted → it fetches (standalone).
  data?: CycleBreakdown;
  flagsBySupplier: Map<string, SupplierFlagState>;
  flagCounts: Record<CycleFlagKey, number>;
  activeFlag: CycleFlagKey | null;
  onSelectFlag: (k: CycleFlagKey | null) => void;
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

  // Stage-dominated PO ids for the selected span → the drill-down cross-refs its
  // own POs against this set (no API change).
  const stageDominatedPoIds = useMemo(
    () => new Set((current?.data?.stageAnomalies ?? []).map((a) => a.po_id)),
    [current?.data],
  );

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
        flagsBySupplier={flagsBySupplier}
        flagCounts={flagCounts}
        activeFlag={activeFlag}
        onSelectFlag={onSelectFlag}
        onSupplierClick={setSelectedSupplierId}
        selectedSupplierId={selectedSupplierId}
      />
      <ByCategory rows={current.data.byCategory} />
      <CycleTimeSupplierDetailPanel
        supplierId={selectedSupplierId}
        startDate={startDate}
        endDate={endDate}
        stageDominatedPoIds={stageDominatedPoIds}
        onClose={() => setSelectedSupplierId(null)}
      />
    </>
  );
}
