"use client";

import { useEffect, useState } from "react";
import { X, Loader2, BarChart3, Table as TableIcon } from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { SpendDetail, SupplierEvolution } from "@/lib/spend-overview-types";
import { ABC_COLORS, QUADRANT_COLORS, CHART_COLORS } from "@/lib/chart-colors";
import { formatCompactCurrency } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { StatBlock } from "@/components/ui/stat-block";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { PerformanceScoreCard } from "@/components/PerformanceScoreCard";
import { PerformanceTrajectory } from "@/components/PerformanceTrajectory";

const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

type Tab = "byItem" | "pos" | "evolution";
type View = "chart" | "table";

const truncate = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

function ViewToggle({ view, setView }: { view: View; setView: (v: View) => void }) {
  return (
    <div className="mb-2 flex justify-end">
      <button
        type="button"
        onClick={() => setView(view === "chart" ? "table" : "chart")}
        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
      >
        {view === "chart" ? <TableIcon className="h-3.5 w-3.5" /> : <BarChart3 className="h-3.5 w-3.5" />}
        {view === "chart" ? "View as table" : "View as chart"}
      </button>
    </div>
  );
}

// ---- Tab 1: spend by item (horizontal bars) ------------------------------- #
type ItemDatum = { name: string; full: string; value: number; count: number; avg: number; pct: number };

function ItemTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: ItemDatum }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="max-w-[220px] rounded-md border bg-background p-2 text-xs shadow-sm">
      <div className="font-medium">{d.full}</div>
      <div className="mt-1 text-muted-foreground">{usd0.format(d.value)} · {d.pct.toFixed(1)}% of total</div>
      <div className="text-muted-foreground">{d.count} invoice(s) · {usd0.format(d.avg)} avg</div>
    </div>
  );
}

function SpendByItemChart({ detail }: { detail: SpendDetail }) {
  const total = detail.stats.totalSpend || 1;
  const top = detail.byItem.slice(0, 15);
  const rest = detail.byItem.slice(15);
  const data: ItemDatum[] = top.map((it) => ({
    name: truncate(it.itemDescription, 22),
    full: it.itemDescription,
    value: it.totalSpend,
    count: it.poCount,
    avg: it.poCount > 0 ? it.totalSpend / it.poCount : 0,
    pct: (it.totalSpend / total) * 100,
  }));
  if (rest.length) {
    const spend = rest.reduce((s, r) => s + r.totalSpend, 0);
    const count = rest.reduce((s, r) => s + r.poCount, 0);
    data.push({ name: `Others (${rest.length})`, full: `${rest.length} more items`, value: spend, count, avg: count ? spend / count : 0, pct: (spend / total) * 100 });
  }
  const cum = detail.byItem.slice(0, 5).reduce((s, r) => s + r.totalSpend, 0);
  const top5pct = Math.round((cum / total) * 100);

  return (
    <div>
      <ChartFrame height={Math.max(220, data.length * 30 + 24)}>
        <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
          <CartesianGrid strokeDasharray="3 3" horizontal={false} />
          <XAxis type="number" tickFormatter={(v) => formatCompactCurrency(Number(v))} tick={{ fontSize: 10 }} />
          <YAxis type="category" dataKey="name" width={130} tick={{ fontSize: 10 }} interval={0} />
          <Tooltip content={<ItemTooltip />} cursor={{ fillOpacity: 0.06 }} />
          <Bar dataKey="value" fill={CHART_COLORS[0]} radius={[0, 3, 3, 0]} isAnimationActive={false} />
        </BarChart>
      </ChartFrame>
      <p className="mt-2 text-xs text-muted-foreground">
        Top 5 items account for {top5pct}% of spend · {detail.byItem.length} item(s) total.
      </p>
    </div>
  );
}

// ---- Tab 2: POs over time (bars) ------------------------------------------ #
type PoDatum = { date: string; value: number; poId: string; item: string };

function PoTooltip({ active, payload }: { active?: boolean; payload?: Array<{ payload: PoDatum }> }) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="max-w-[220px] rounded-md border bg-background p-2 text-xs shadow-sm">
      <div className="font-medium">{d.poId}</div>
      <div className="text-muted-foreground">{d.item}</div>
      <div className="mt-1 text-muted-foreground">{usd0.format(d.value)} · {d.date}</div>
    </div>
  );
}

function PosTimeChart({ detail }: { detail: SpendDetail }) {
  const data: PoDatum[] = [...detail.pos]
    .map((p) => ({ date: p.invoiceDate ?? p.prDate ?? "—", value: p.totalValueUsd, poId: p.poId, item: p.itemDescription }))
    .sort((a, b) => a.date.localeCompare(b.date));
  const dateRange =
    data.length > 0 ? `${data[0].date} to ${data[data.length - 1].date}` : "—";

  return (
    <div>
      <ChartFrame height={260}>
        <BarChart data={data} margin={{ left: 4, right: 8, top: 8, bottom: 24 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis dataKey="date" tick={{ fontSize: 9 }} angle={-35} textAnchor="end" height={48} interval="preserveStartEnd" />
          <YAxis tickFormatter={(v) => formatCompactCurrency(Number(v))} tick={{ fontSize: 10 }} width={48} />
          <Tooltip content={<PoTooltip />} cursor={{ fillOpacity: 0.06 }} />
          <Bar dataKey="value" fill={CHART_COLORS[0]} radius={[2, 2, 0, 0]} isAnimationActive={false} />
        </BarChart>
      </ChartFrame>
      <p className="mt-2 text-xs text-muted-foreground">{detail.pos.length} invoice(s) · {dateRange}.</p>
    </div>
  );
}

// ---- Tab 1/2 table fallbacks ---------------------------------------------- #
function ItemTable({ detail }: { detail: SpendDetail }) {
  return (
    <table className="w-full border-collapse text-sm">
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th className="py-1.5 text-right font-medium">Invoices</th>
          <th className="py-1.5 font-medium">Item</th>
          <th className="py-1.5 text-right font-medium">Total spend</th>
        </tr>
      </thead>
      <tbody>
        {detail.byItem.map((it) => (
          <tr key={it.itemDescription} className="border-b">
            <td className="py-1.5 text-right text-muted-foreground">{it.poCount}</td>
            <td className="py-1.5">{it.itemDescription}</td>
            <td className="py-1.5 text-right">{usd0.format(it.totalSpend)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function PosTable({ detail }: { detail: SpendDetail }) {
  const rows = [...detail.pos].sort((a, b) =>
    (b.invoiceDate ?? b.prDate ?? "").localeCompare(a.invoiceDate ?? a.prDate ?? ""),
  );
  return (
    <table className="w-full border-collapse text-xs">
      <thead>
        <tr className="border-b text-left text-muted-foreground">
          <th className="py-1.5 font-medium">PO ID</th>
          <th className="py-1.5 font-medium">Item</th>
          <th className="py-1.5 font-medium">Date</th>
          <th className="py-1.5 text-right font-medium">Total</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((p) => (
          <tr key={p.poId} className="border-b">
            <td className="py-1.5 font-medium">{p.poId}</td>
            <td className="py-1.5">{p.itemDescription}</td>
            <td className="py-1.5 text-muted-foreground">{p.invoiceDate ?? p.prDate ?? "—"}</td>
            <td className="py-1.5 text-right">{usd0.format(p.totalValueUsd)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ---- Tab 3: evolution ----------------------------------------------------- #
function EvolutionTab({ data }: { data: SupplierEvolution }) {
  const active = data.periods.filter((p) => p.spend > 0 || p.invoiceCount > 0);
  const hasPerf = data.periods.some((p) => p.performanceScore != null);

  // Product mix: top-5 items across years + Others residual per year.
  const totalByItem = new Map<string, number>();
  for (const p of data.periods)
    for (const it of p.topItems)
      totalByItem.set(it.itemDescription, (totalByItem.get(it.itemDescription) ?? 0) + it.spend);
  const topItemNames = [...totalByItem.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([n]) => n);
  const mix = data.periods.map((p) => {
    const row: Record<string, number | string> = { year: p.year };
    let shown = 0;
    for (const name of topItemNames) {
      const v = p.topItems.find((it) => it.itemDescription === name)?.spend ?? 0;
      row[name] = v;
      shown += v;
    }
    const others = Math.max(0, p.spend - shown);
    if (others > 0) row.Others = others;
    return row;
  });
  const mixKeys = [...topItemNames, ...(mix.some((r) => "Others" in r) ? ["Others"] : [])];

  return (
    <div className="flex flex-col gap-5">
      {active.length <= 1 && (
        <p className="rounded-md border border-amber-500/40 bg-amber-50 p-2 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
          Limited evolution data — supplier active{" "}
          {active.length === 1 ? `only in ${active[0].year}` : "in no periods"}.
        </p>
      )}

      {/* A: classification trajectory */}
      <section>
        <h4 className="mb-2 text-xs font-medium text-muted-foreground">Classification</h4>
        <div className="flex flex-wrap items-center gap-1.5">
          {data.periods.map((p, i) => (
            <div key={p.year} className="flex items-center gap-1.5">
              {i > 0 && <span className="text-muted-foreground">→</span>}
              <span className="rounded-md border px-2 py-1 text-xs">
                <span className="text-muted-foreground">{p.year}: </span>
                <span style={{ color: p.abcClass ? ABC_COLORS[p.abcClass] : undefined }}>{p.abcClass ?? "—"}</span>
                {" / "}
                <span style={{ color: p.kraljicQuadrant ? QUADRANT_COLORS[p.kraljicQuadrant] : undefined }}>
                  {p.kraljicQuadrant ?? "—"}
                </span>
              </span>
            </div>
          ))}
        </div>
      </section>

      {/* B: spend trajectory */}
      <section>
        <h4 className="mb-2 text-xs font-medium text-muted-foreground">Annual spend</h4>
        <ChartFrame height={180}>
          <LineChart data={data.periods} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="year" tick={{ fontSize: 11 }} />
            <YAxis tickFormatter={(v) => formatCompactCurrency(Number(v))} tick={{ fontSize: 10 }} width={48} />
            <Tooltip formatter={(v) => [usd0.format(Number(v)), "Spend"]} />
            <Line type="monotone" dataKey="spend" stroke={CHART_COLORS[0]} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
          </LineChart>
        </ChartFrame>
      </section>

      {/* C: performance trajectory (only if any data) */}
      {hasPerf && (
        <section>
          <h4 className="mb-2 text-xs font-medium text-muted-foreground">Performance score</h4>
          <ChartFrame height={180}>
            <LineChart data={data.periods} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} width={32} />
              <Tooltip formatter={(v) => [v == null ? "—" : Number(v).toFixed(2), "Performance"]} />
              {/* No connectNulls: an inactive year is a real gap, not a straight
                  interpolation between the surrounding periods. */}
              <Line type="monotone" dataKey="performanceScore" stroke={CHART_COLORS[1]} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
            </LineChart>
          </ChartFrame>
        </section>
      )}

      {/* D: product mix over time */}
      {mixKeys.length > 0 && (
        <section>
          <h4 className="mb-2 text-xs font-medium text-muted-foreground">Product mix over time</h4>
          <ChartFrame height={200}>
            <BarChart data={mix} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" vertical={false} />
              <XAxis dataKey="year" tick={{ fontSize: 11 }} />
              <YAxis tickFormatter={(v) => formatCompactCurrency(Number(v))} tick={{ fontSize: 10 }} width={48} />
              <Tooltip formatter={(v, n) => [usd0.format(Number(v)), truncate(String(n), 24)]} />
              {mixKeys.map((k, i) => (
                <Bar key={k} dataKey={k} stackId="mix" fill={CHART_COLORS[i % CHART_COLORS.length]} isAnimationActive={false} />
              ))}
            </BarChart>
          </ChartFrame>
        </section>
      )}

      {/* E: insights */}
      {data.insights.length > 0 && (
        <section>
          <h4 className="mb-1 text-xs font-medium text-muted-foreground">Insights</h4>
          <ul className="list-disc space-y-0.5 pl-5 text-sm text-muted-foreground">
            {data.insights.map((t, i) => (
              <li key={i}>{t}</li>
            ))}
          </ul>
        </section>
      )}
    </div>
  );
}

// Classification chip — same style as the ranking table (color-mix tint + token
// text). `color` null renders a neutral placeholder so the layout is preserved.
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

// ---- Panel ---------------------------------------------------------------- #
export function SpendDecompositionPanel({
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
  const detailKey = supplierId ? `${supplierId}_${startDate}_${endDate}` : "";
  const [detailState, setDetailState] = useState<{ key: string; detail?: SpendDetail; err?: string } | null>(null);
  const [evo, setEvo] = useState<{ id: string; data?: SupplierEvolution; err?: string } | null>(null);
  const [tab, setTab] = useState<Tab>("byItem");
  const [itemView, setItemView] = useState<View>("chart");
  const [posView, setPosView] = useState<View>("chart");
  const [perfOpen, setPerfOpen] = useState(false);

  const detail = detailState?.key === detailKey ? detailState.detail : undefined;
  const detailErr = detailState?.key === detailKey ? detailState.err : undefined;
  const detailLoading = !!supplierId && !detail && !detailErr;

  // Reset transient UI when the supplier changes.
  const [prevId, setPrevId] = useState(supplierId);
  if (prevId !== supplierId) {
    setPrevId(supplierId);
    setTab("byItem");
    setItemView("chart");
    setPosView("chart");
    setPerfOpen(false);
  }

  // Period-scoped spend detail (refetch on supplier OR span change).
  useEffect(() => {
    if (!supplierId) return;
    const key = `${supplierId}_${startDate}_${endDate}`;
    let cancelled = false;
    const qs = startDate && endDate ? `?start=${startDate}&end=${endDate}` : "";
    fetch(`/api/suppliers/${supplierId}/spend-detail${qs}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || "Failed to load");
        return res.json() as Promise<SpendDetail>;
      })
      .then((d) => { if (!cancelled) setDetailState({ key, detail: d }); })
      .catch((e: unknown) => { if (!cancelled) setDetailState({ key, err: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
  }, [supplierId, startDate, endDate]);

  // All-years evolution (refetch on supplier change only).
  useEffect(() => {
    if (!supplierId) return;
    const sid = supplierId;
    let cancelled = false;
    fetch(`/api/suppliers/${sid}/evolution`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load evolution");
        return res.json() as Promise<SupplierEvolution>;
      })
      .then((d) => { if (!cancelled) setEvo({ id: sid, data: d }); })
      .catch((e: unknown) => { if (!cancelled) setEvo({ id: sid, err: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
  }, [supplierId]);

  const evoData = evo?.id === supplierId ? evo.data : undefined;

  const s = detail?.supplier;
  const st = detail?.stats;
  // No purchases in the selected period — render an honest "absent" view.
  const absent = st != null && st.poCount === 0;

  return (
    <Dialog open={!!supplierId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        aria-label="Spend decomposition"
        className="flex max-h-[85vh] w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[680px]"
      >
        <header className="flex items-start justify-between gap-2 border-b p-4">
          <div className="min-w-0">
            <DialogTitle className="truncate font-heading text-base font-medium leading-snug">{s?.name ?? "Loading…"}</DialogTitle>
            {s && (
              <p className="truncate text-xs text-muted-foreground">
                {[s.category, s.tier, s.country].filter(Boolean).join(" · ") || s.id}
              </p>
            )}
            <p className="mt-0.5 text-[11px] text-muted-foreground">
              Showing {startDate} to {endDate}
            </p>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </header>

        {detailLoading && (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading spend detail…
          </div>
        )}
        {detailErr && <p className="p-4 text-sm text-destructive">{detailErr}</p>}

        {detail && st && s && (
          <>
            {/* Section 1: spend stats */}
            <div className="border-b p-4">
              <h4 className="mb-2 text-sm font-medium text-muted-foreground">Spend at a glance</h4>
              <div className="grid grid-cols-3 gap-4">
                <StatBlock label="Total spend" value={absent ? "—" : usd0.format(st.totalSpend)} />
                <StatBlock label="Invoices" value={absent ? "—" : String(st.poCount)} />
                <StatBlock label="Avg invoice" value={absent ? "—" : usd0.format(st.avgPoValue)} />
              </div>
            </div>

            {/* Section 2: performance + classification */}
            <div className="border-b p-4">
              <h4 className="mb-2 text-sm font-medium text-muted-foreground">Performance &amp; classification</h4>
              <div className="grid grid-cols-3 gap-4">
                <PerformanceScoreCard
                  perf={s.performance}
                  open={perfOpen}
                  onToggle={() => setPerfOpen((o) => !o)}
                />
                <div className="col-span-2 flex flex-wrap content-start items-start gap-2">
                  <Chip
                    color={s.abcClass ? ABC_COLORS[s.abcClass] : null}
                    label={s.abcClass ? `Class ${s.abcClass}` : "Class —"}
                  />
                  <Chip
                    color={s.kraljicQuadrant ? QUADRANT_COLORS[s.kraljicQuadrant] : null}
                    label={s.kraljicQuadrant ?? "—"}
                  />
                </div>
              </div>
              {perfOpen && (
                <div className="mt-4 border-t pt-3">
                  {s.performance.score == null ? (
                    <p className="text-xs text-muted-foreground">No data for this period.</p>
                  ) : evo?.err ? (
                    <p className="text-sm text-destructive">{evo.err}</p>
                  ) : evoData ? (
                    <PerformanceTrajectory data={evoData} />
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading trajectory…
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Section 3: activity span */}
            <div className="border-b p-4">
              <h4 className="mb-2 text-sm font-medium text-muted-foreground">Activity</h4>
              <p className="text-xs text-muted-foreground">
                {absent
                  ? "No activity in this period"
                  : st.earliestDate && st.latestDate
                    ? `${st.earliestDate} → ${st.latestDate}`
                    : "—"}
              </p>
            </div>

            <div className="flex gap-1 border-b px-4 pt-3">
              {([["byItem", "Spend by item"], ["pos", "All POs"], ["evolution", "Annual breakdown"]] as const).map(([k, lbl]) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setTab(k)}
                  className={`-mb-px border-b-2 px-3 py-1.5 text-sm transition-colors ${tab === k ? "border-primary font-medium" : "border-transparent text-muted-foreground hover:text-foreground"}`}
                >
                  {lbl}
                </button>
              ))}
            </div>

            <div className="p-4">
              {tab === "byItem" && (
                absent ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No items purchased in this period.</p>
                ) : (
                  <>
                    <ViewToggle view={itemView} setView={setItemView} />
                    {itemView === "chart" ? <SpendByItemChart detail={detail} /> : <ItemTable detail={detail} />}
                  </>
                )
              )}
              {tab === "pos" && (
                absent ? (
                  <p className="py-8 text-center text-sm text-muted-foreground">No purchase orders in this period.</p>
                ) : (
                  <>
                    <ViewToggle view={posView} setView={setPosView} />
                    {posView === "chart" ? <PosTimeChart detail={detail} /> : <PosTable detail={detail} />}
                  </>
                )
              )}
              {tab === "evolution" && (
                <>
                  <p className="mb-3 text-[11px] text-muted-foreground">All years (not period-scoped).</p>
                  {evo?.err ? (
                    <p className="text-sm text-destructive">{evo.err}</p>
                  ) : evoData ? (
                    <EvolutionTab data={evoData} />
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading evolution…
                    </div>
                  )}
                </>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
