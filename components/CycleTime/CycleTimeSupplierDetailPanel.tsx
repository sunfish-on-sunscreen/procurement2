"use client";

import { useEffect, useState } from "react";
import { X, Loader2, TriangleAlert } from "lucide-react";
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import type { CycleSupplierDetail, CycleStageKey } from "@/lib/cycle-time-types";
import { ABC_COLORS, QUADRANT_COLORS, CHART_COLORS } from "@/lib/chart-colors";
import { panelElevation } from "@/lib/utils";
import { periodSpanLabel } from "@/lib/panel-format";
import { useTableSort } from "@/lib/use-table-sort";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { StatBlock } from "@/components/ui/stat-block";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { SortArrow } from "@/components/RankingCells";

// Slowest-stage colour family — same mapping the per-supplier section uses.
const STAGE_COLOR: Record<CycleStageKey, string> = {
  pr_to_po: CHART_COLORS[0],
  po_to_delivery: CHART_COLORS[1],
  delivery_to_invoice: CHART_COLORS[2],
  invoice_to_payment: CHART_COLORS[3],
};

// Classification chip — color-mix tint + token text; null → muted placeholder.
function Chip({ color, label }: { color: string | null; label: string }) {
  if (!color) {
    return (
      <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        {label}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`, color }}
    >
      {label}
    </span>
  );
}

function StageChip({ stage, label }: { stage: CycleStageKey; label: string }) {
  const color = STAGE_COLOR[stage];
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`, color }}
    >
      {label}
    </span>
  );
}

// ---- Section 3: per-stage breakdown (supplier vs portfolio) ---------------- #
function StageBars({ stages }: { stages: CycleSupplierDetail["stages"] }) {
  const data = stages.map((s) => ({
    name: s.label,
    supplier: s.supplier_median,
    portfolio: s.portfolio_median,
  }));
  return (
    <ChartFrame height={200}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}d`} />
        <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10 }} interval={0} />
        <Tooltip formatter={(v, n) => [`${Number(v).toFixed(2)} d`, n === "supplier" ? "This supplier" : "Portfolio median"]} cursor={{ fillOpacity: 0.06 }} />
        <Legend wrapperStyle={{ fontSize: 11 }} formatter={(n) => (n === "supplier" ? "This supplier" : "Portfolio median")} />
        <Bar dataKey="supplier" fill={CHART_COLORS[0]} radius={[0, 3, 3, 0]} isAnimationActive={false} />
        <Bar dataKey="portfolio" fill={CHART_COLORS[4]} radius={[0, 3, 3, 0]} isAnimationActive={false} />
      </BarChart>
    </ChartFrame>
  );
}

// ---- Section 5: PO list (sortable, anomaly-flagged) ------------------------ #
function PoHead({
  label,
  sortKey,
  active,
  dir,
  onSort,
  align = "left",
  defaultDir = "desc",
}: {
  label: string;
  sortKey: string;
  active: boolean;
  dir: "asc" | "desc";
  onSort: (key: string, defaultDir: "asc" | "desc") => void;
  align?: "left" | "right";
  defaultDir?: "asc" | "desc";
}) {
  return (
    <th className={`py-1.5 font-medium ${align === "right" ? "text-right" : "text-left"}`}>
      <button
        type="button"
        onClick={() => onSort(sortKey, defaultDir)}
        className={`inline-flex items-center gap-1 hover:text-foreground ${align === "right" ? "flex-row-reverse" : ""}`}
      >
        {label}
        <SortArrow active={active} dir={active ? dir : "desc"} />
      </button>
    </th>
  );
}

function PoList({ pos }: { pos: CycleSupplierDetail["pos"] }) {
  const { sorted, sort, toggle } = useTableSort<CycleSupplierDetail["pos"][number], string>(
    pos,
    (r, k) => (r as unknown as Record<string, number | string | boolean | null>)[k] as number | string | null,
    "total_cycle_days",
    "desc",
  );
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="border-b text-muted-foreground">
          <PoHead label="PO ID" sortKey="po_id" active={sort.key === "po_id"} dir={sort.dir} onSort={toggle} defaultDir="asc" />
          <PoHead label="Invoice date" sortKey="invoice_date" active={sort.key === "invoice_date"} dir={sort.dir} onSort={toggle} defaultDir="asc" />
          <PoHead label="Cycle days" sortKey="total_cycle_days" active={sort.key === "total_cycle_days"} dir={sort.dir} onSort={toggle} align="right" />
          <th className="py-1.5 text-left font-medium">Slowest stage</th>
        </tr>
      </thead>
      <tbody>
        {sorted.map((p) => (
          <tr key={p.po_id} className="border-b last:border-0">
            <td className="py-1.5 font-medium">
              <span className="inline-flex items-center gap-1">
                {p.is_anomaly && (
                  <TriangleAlert
                    className="h-3 w-3 text-destructive"
                    aria-label="Cycle-time anomaly (>2σ)"
                  />
                )}
                {p.po_id}
              </span>
            </td>
            <td className="py-1.5 tabular-nums text-muted-foreground">{p.invoice_date ?? "—"}</td>
            <td className={`py-1.5 text-right tabular-nums ${p.is_anomaly ? "font-semibold text-destructive" : ""}`}>
              {p.total_cycle_days}
            </td>
            <td className="py-1.5">
              <StageChip stage={p.slowest_stage} label={p.slowest_stage_label} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---- Panel ----------------------------------------------------------------- #
export function CycleTimeSupplierDetailPanel({
  supplierId,
  startDate,
  endDate,
  onClose,
}: {
  supplierId: string | null;
  startDate: string;
  endDate: string;
  onClose: () => void;
}) {
  const key = supplierId ? `${supplierId}_${startDate}_${endDate}` : "";
  const [state, setState] = useState<{ key: string; data?: CycleSupplierDetail; err?: string } | null>(null);
  const current = state?.key === key ? state : null;
  const loading = !!supplierId && !current;
  const span = periodSpanLabel(startDate, endDate);

  useEffect(() => {
    if (!supplierId) return;
    const k = `${supplierId}_${startDate}_${endDate}`;
    let cancelled = false;
    fetch(`/api/cycle-time/supplier-detail?supplierId=${supplierId}&start=${startDate}&end=${endDate}`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || "Failed to load");
        }
        return res.json() as Promise<CycleSupplierDetail>;
      })
      .then((d) => { if (!cancelled) setState({ key: k, data: d }); })
      .catch((e: unknown) => { if (!cancelled) setState({ key: k, err: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
  }, [supplierId, startDate, endDate]);

  const s = current?.data?.supplier;
  const cyc = current?.data?.cycle;

  return (
    <Dialog open={!!supplierId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        aria-label="Cycle time supplier detail"
        className={`flex max-h-[85vh] w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[680px] ${panelElevation}`}
      >
        <header className="flex items-start justify-between gap-2 border-b p-4">
          <div className="min-w-0">
            <DialogTitle className="truncate font-heading text-base font-medium leading-snug">
              {s?.name ?? "Loading…"}
            </DialogTitle>
            {s && (
              <p className="truncate text-xs text-muted-foreground">
                {[s.category, s.tier, s.country].filter(Boolean).join(" · ") || s.id}
              </p>
            )}
            <p className="mt-0.5 text-[11px] text-muted-foreground" title={span.full}>
              Showing {span.short}
            </p>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </header>

        {loading && (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading cycle detail…
          </div>
        )}
        {current?.err && <p className="p-4 text-sm text-destructive">{current.err}</p>}

        {current?.data && s && cyc && (
          <>
            {/* Section 2: classification context */}
            <div className="border-b p-4">
              <h4 className="mb-2 text-sm font-medium text-muted-foreground">Classification context</h4>
              <div className="flex flex-wrap items-center gap-2">
                <Chip color={s.abc_class ? ABC_COLORS[s.abc_class] : null} label={s.abc_class ? `Class ${s.abc_class}` : "Class —"} />
                <Chip color={s.kraljic_quadrant ? QUADRANT_COLORS[s.kraljic_quadrant] : null} label={s.kraljic_quadrant ?? "—"} />
                <span className="text-sm text-muted-foreground">
                  Performance{" "}
                  <span className="font-medium text-foreground tabular-nums">
                    {s.composite != null ? s.composite.toFixed(2) : "—"}
                  </span>
                  {s.composite != null ? " / 100" : ""}
                </span>
              </div>
            </div>

            {/* Section 3: cycle stats */}
            <div className="border-b p-4">
              <h4 className="mb-2 text-sm font-medium text-muted-foreground">Cycle stats</h4>
              <div className="grid grid-cols-3 gap-3">
                <StatBlock label="Median cycle" value={`${cyc.median_cycle.toFixed(2)} d`} />
                <StatBlock label="IQR (P25–P75)" value={`${cyc.p25.toFixed(0)}–${cyc.p75.toFixed(0)} d`} />
                <StatBlock label="POs" value={String(cyc.po_count)} />
              </div>
              <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
                Slowest stage
                <StageChip stage={cyc.slowest_stage} label={cyc.slowest_stage_label} />
              </div>
            </div>

            {/* Section 4: per-stage breakdown vs portfolio */}
            <div className="border-b p-4">
              <h4 className="mb-2 text-sm font-medium text-muted-foreground">
                Per-stage median — this supplier vs portfolio
              </h4>
              <StageBars stages={current.data.stages} />
            </div>

            {/* Section 5: PO list */}
            <div className="p-4">
              <h4 className="mb-2 text-sm font-medium text-muted-foreground">
                Purchase orders ({cyc.po_count})
              </h4>
              {current.data.pos.length > 0 ? (
                <PoList pos={current.data.pos} />
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No invoices in this period.
                </p>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
