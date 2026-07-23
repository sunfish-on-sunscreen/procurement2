"use client";

import { useEffect, useState, type ReactNode } from "react";
import { METHOD_LABEL } from "@/lib/cycle-mix";
import { X, Loader2, ArrowUp, ArrowDown, Minus } from "lucide-react";
import {
  BarChart,
  Bar,
  LineChart,
  Line,
  ReferenceLine,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
  Legend,
} from "recharts";
import { type CycleSupplierDetail, type CycleStageKey, type CyclePortfolioContext } from "@/lib/cycle-time-types";
import { CHART_COLORS } from "@/lib/chart-colors";
import { panelElevation } from "@/lib/utils";
import { periodSpanLabel } from "@/lib/panel-format";
import { useTableSort } from "@/lib/use-table-sort";
import { Button } from "@/components/ui/button";
import { CountryFlag } from "@/components/CountryFlag";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { SortArrow } from "@/components/RankingCells";
import { ViewToggle, type View } from "@/components/ViewToggle";

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
/** ISO "2025-02-03" → compact "Feb 3 '25" (null → "—"); year kept so range-mode
 * POs across years stay unambiguous. */
function fmtMilestone(isoDate: string | null): string {
  if (!isoDate) return "—";
  const [y, m, d] = isoDate.split("-");
  const mi = Number(m) - 1;
  if (mi < 0 || mi > 11 || !d) return isoDate;
  return `${MONTHS[mi]} ${Number(d)} '${y.slice(2)}`;
}

// Slowest-stage colour family — same mapping the per-supplier section uses.
const STAGE_COLOR: Record<CycleStageKey, string> = {
  pr_to_po: CHART_COLORS[0],
  po_to_delivery: CHART_COLORS[1],
  delivery_to_invoice: CHART_COLORS[2],
  invoice_to_payment: CHART_COLORS[3],
};

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
    supplier: s.supplier_mean,
    portfolio: s.portfolio_mean,
  }));
  return (
    <ChartFrame height={200}>
      <BarChart data={data} layout="vertical" margin={{ left: 8, right: 16, top: 4, bottom: 4 }}>
        <CartesianGrid strokeDasharray="3 3" horizontal={false} />
        <XAxis type="number" tick={{ fontSize: 10 }} tickFormatter={(v) => `${v}d`} />
        <YAxis type="category" dataKey="name" width={120} tick={{ fontSize: 10 }} interval={0} />
        <Tooltip formatter={(v, n) => [`${Number(v).toFixed(2)} d`, n === "supplier" ? "This supplier" : "Portfolio average"]} cursor={{ fillOpacity: 0.06 }} />
        <Legend wrapperStyle={{ fontSize: 11 }} formatter={(n) => (n === "supplier" ? "This supplier" : "Portfolio average")} />
        <Bar dataKey="supplier" fill={CHART_COLORS[0]} radius={[0, 3, 3, 0]} isAnimationActive={false} />
        <Bar dataKey="portfolio" fill={CHART_COLORS[4]} radius={[0, 3, 3, 0]} isAnimationActive={false} />
      </BarChart>
    </ChartFrame>
  );
}

// Card-specific explanation of the Inconsistent flag (why it shows here, not per-PO).
const INCONSISTENT_NOTE_TOOLTIP =
  "Inconsistent = this supplier's cycle times vary more widely than typical for suppliers in this period. It's a supplier-level pattern (about the spread across their POs), not tied to any single PO — which is why it's shown here, not as a per-PO tag.";

// ---- Cycle consistency: cycle days across the supplier's POs, in date order --- #
// X = order sequence (1, 2, 3… by payment date), NOT calendar dates — orders aren't
// evenly spaced in time, so a date axis would distort. The line is drawn against a
// TWO-BAND "inconsistency band" = this supplier's own median ± the FLAG's threshold
// (iqrCutoff = 1.5 × median of all suppliers' IQRs). The band half-width is the flag
// threshold ON PURPOSE: a supplier flagged Inconsistent has IQR > iqrCutoff, so its
// spread exceeds the half-width and its orders poke outside the band (red crossings);
// a non-flagged supplier stays mostly inside → crossings ⟺ flagged, by construction.
// The line is its base colour WITHIN the band and turns RED above the upper band or
// below the lower band (both directions — too slow / too fast). The colour flips at the
// band crossing via an injected vertex per crossing; with the monotone curve the visual
// crossing is approximate (curve bows near the vertex), but the colour junction is
// pinned ON the band line. (Do NOT reintroduce the old 4-order-window IQR segmenting.)
type ConsistencyPoint = {
  po_id: string;
  order: number;
  cycle: number;
  outlier: boolean;
  stageDom: boolean;
  slowest: string;
  pr: string | null;
  po: string | null;
  delivery: string | null;
  invoice: string | null;
  payment: string | null;
};

// A plotted vertex: either a REAL order (carries the full ConsistencyPoint payload) or
// an INJECTED band-crossing (cycle = the band y, no payload/dot). `base`/`red` hold the
// y-value only on the segments of that colour (null elsewhere) so two overlapping Lines
// draw the in-band vs out-of-band portions; `dotCycle` hosts the anomaly dot + tooltip
// on real orders only.
type PlotRow = Partial<ConsistencyPoint> & {
  order: number;
  cycle: number;
  injected: boolean;
  base: number | null;
  red: number | null;
  dotCycle: number | null;
};

/** Unified per-order dot: red circle (larger) if the order has ANY anomaly (Outlier
 *  and/or Stage-dominated); blue circle (smaller) if normal. Hover reveals which. */
function renderAnomalyDot(props: {
  cx?: number;
  cy?: number;
  index?: number;
  payload?: PlotRow;
}) {
  const { cx, cy, index, payload } = props;
  const key = `dot-${index}`;
  // Injected band-crossing vertices carry no order → no dot.
  if (cx == null || cy == null || payload?.injected) return <g key={key} />;
  if (payload?.outlier || payload?.stageDom) {
    return (
      <circle key={key} cx={cx} cy={cy} r={5} fill="var(--destructive)" stroke="var(--background)" strokeWidth={1.5} />
    );
  }
  return (
    <circle key={key} cx={cx} cy={cy} r={3} fill={CHART_COLORS[0]} stroke="var(--background)" strokeWidth={1} />
  );
}

/** Small tinted badge for the tooltip's anomaly labels (Outlier / Stage-dom). */
function TipBadge({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="inline-flex items-center rounded px-1 py-0.5 text-[10px] font-medium"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 15%, transparent)`, color }}
    >
      {label}
    </span>
  );
}

function ConsistencyTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload?: PlotRow }>;
}) {
  // The lines share one data row → read the row off whichever series is present.
  const d = payload?.find((p) => p?.payload)?.payload;
  // Real orders only — injected band-crossing vertices have no PO payload.
  if (!active || !d || d.injected || d.po_id == null) return null;
  return (
    <div className="max-w-[250px] rounded-md border bg-background p-2 text-xs shadow-sm">
      <div className="flex items-center gap-1.5">
        <span className="font-medium text-foreground">{d.po_id}</span>
        <span className="text-muted-foreground">· order {d.order}</span>
      </div>
      {(d.outlier || d.stageDom) && (
        <div className="mt-1 flex flex-wrap gap-1">
          {d.outlier && <TipBadge color="var(--warning)" label="Outlier" />}
          {d.stageDom && <TipBadge color="var(--destructive)" label="Stage-dom" />}
        </div>
      )}
      <div className="mt-1 space-y-0.5 text-muted-foreground">
        <div>
          Cycle: <span className="font-medium tabular-nums text-foreground">{d.cycle} days</span>
        </div>
        <div>Slowest stage: {d.slowest}</div>
        <div className="text-[10px] tabular-nums">
          PR {fmtMilestone(d.pr ?? null)} · PO {fmtMilestone(d.po ?? null)} · Del{" "}
          {fmtMilestone(d.delivery ?? null)} · Inv {fmtMilestone(d.invoice ?? null)} · Pay{" "}
          {fmtMilestone(d.payment ?? null)}
        </div>
      </div>
    </div>
  );
}

function CycleConsistencyChart({
  pos,
  median,
  bandHalfWidth,
  stageDominatedPoIds,
}: {
  pos: CycleSupplierDetail["pos"];
  median: number;
  // The Inconsistent flag's threshold (iqrCutoff = 1.5 × portfolio-median IQR) used as
  // the band half-width, so out-of-band crossings agree with the supplier-level flag.
  bandHalfWidth: number;
  stageDominatedPoIds: Set<string>;
}) {
  // 1–2 points can't show a meaningful swing.
  if (pos.length < 3) {
    return (
      <p className="py-4 text-center text-xs text-muted-foreground">
        Not enough POs to assess consistency (need 3+).
      </p>
    );
  }
  const ordered = [...pos].sort((a, b) =>
    (a.payment_date ?? "").localeCompare(b.payment_date ?? ""),
  );
  const n = ordered.length;
  const real: ConsistencyPoint[] = ordered.map((p, i) => ({
    po_id: p.po_id,
    order: i + 1,
    cycle: p.total_cycle_days,
    outlier: p.is_anomaly,
    stageDom: stageDominatedPoIds.has(p.po_id),
    slowest: p.slowest_stage_label,
    pr: p.pr_date,
    po: p.po_date,
    delivery: p.delivery_date,
    invoice: p.invoice_date,
    payment: p.payment_date,
  }));

  // Inconsistency band = this supplier's own median ± the flag threshold (iqrCutoff),
  // floored at 0 (a negative "too fast" edge is meaningless). Half-width = the flag's
  // threshold, so a flagged supplier (IQR > iqrCutoff) pokes out and a non-flagged one
  // stays in.
  const halfWidth = Math.max(0, bandHalfWidth);
  const upper = median + halfWidth;
  const lowerRaw = median - halfWidth;
  const lower = Math.max(0, lowerRaw);
  const hasLowerBand = lowerRaw > 0; // only a real "too fast" edge when > 0
  const thresholds = hasLowerBand ? [upper, lower] : [upper];

  // Build the plotted series = real orders + an interpolated vertex at each EXACT
  // band crossing, so the colour flips ON the band line (mid-segment), not at the
  // nearest order. For a segment (a → b) that straddles a threshold T:
  // t = (T − y0)/(y1 − y0), inject {order: a.order + t, cycle: T}.
  const plots: PlotRow[] = real.map((d) => ({
    ...d,
    injected: false,
    base: null,
    red: null,
    dotCycle: d.cycle,
  }));
  for (let i = 0; i < real.length - 1; i++) {
    const a = real[i];
    const b = real[i + 1];
    for (const T of thresholds) {
      if ((a.cycle < T && b.cycle > T) || (a.cycle > T && b.cycle < T)) {
        const t = (T - a.cycle) / (b.cycle - a.cycle); // 0 < t < 1
        plots.push({ order: a.order + t, cycle: T, injected: true, base: null, red: null, dotCycle: null });
      }
    }
  }
  plots.sort((p, q) => p.order - q.order);

  // Colour each segment by its MIDPOINT: red when out-of-band (above upper OR below
  // lower), base colour when within. Because every transition has an injected vertex
  // ON the band, no segment straddles it — red starts/ends exactly at the crossing.
  // The two overlapping Lines share the injected vertices (value = the band y), so
  // they meet on the band line.
  for (let i = 0; i < plots.length - 1; i++) {
    const a = plots[i];
    const b = plots[i + 1];
    const mid = (a.cycle + b.cycle) / 2;
    const out = mid > upper || mid < lower;
    if (out) {
      a.red = a.cycle;
      b.red = b.cycle;
    } else {
      a.base = a.cycle;
      b.base = b.cycle;
    }
  }

  const medLabel = Number.isInteger(median) ? String(median) : median.toFixed(1);
  const orderTicks = real.map((d) => d.order);

  return (
    <>
      <ChartFrame height={200}>
        {/* type="monotone" for the bendy look — the colour junctions stay pinned on the
            band line (injected vertices), the curve between points is approximate. */}
        <LineChart data={plots} margin={{ left: 4, right: 16, top: 8, bottom: 22 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="order"
            type="number"
            domain={[1, n]}
            ticks={orderTicks}
            allowDecimals={false}
            tick={{ fontSize: 10 }}
            tickMargin={6}
            label={{
              value: "order (by date) →",
              position: "insideBottom",
              offset: -8,
              fontSize: 10,
              fill: "var(--muted-foreground)",
            }}
          />
          <YAxis
            tick={{ fontSize: 10 }}
            tickFormatter={(v) => `${v}d`}
            domain={[0, (dataMax: number) => Math.ceil(Math.max(dataMax, upper)) + 1]}
            width={34}
          />
          <Tooltip content={<ConsistencyTooltip />} />
          {/* Inconsistency-band edges (dashed) + the supplier's median. */}
          <ReferenceLine
            y={upper}
            stroke="var(--muted-foreground)"
            strokeDasharray="4 4"
            label={{ value: `+ threshold ${upper.toFixed(0)}d`, position: "insideTopRight", fontSize: 10, fill: "var(--muted-foreground)" }}
          />
          <ReferenceLine
            y={median}
            stroke="var(--muted-foreground)"
            strokeDasharray="4 4"
            label={{ value: `Their median ${medLabel}d`, position: "insideRight", fontSize: 10, fill: "var(--muted-foreground)" }}
          />
          {hasLowerBand && (
            <ReferenceLine
              y={lower}
              stroke="var(--muted-foreground)"
              strokeDasharray="4 4"
              label={{ value: `− threshold ${lower.toFixed(0)}d`, position: "insideBottomRight", fontSize: 10, fill: "var(--muted-foreground)" }}
            />
          )}
          {/* Two overlapping lines: base colour within the band, red outside it.
              connectNulls=false so each draws only its own segments; they meet on the
              injected band-crossing vertices. */}
          <Line type="monotone" dataKey="base" stroke={CHART_COLORS[0]} strokeWidth={2} dot={false} activeDot={false} connectNulls={false} isAnimationActive={false} />
          <Line type="monotone" dataKey="red" stroke="var(--destructive)" strokeWidth={2} dot={false} activeDot={false} connectNulls={false} isAnimationActive={false} />
          {/* Invisible line hosting the unified anomaly dots + hover payload on the REAL
              orders only (injected vertices carry dotCycle=null → no dot). */}
          <Line type="monotone" dataKey="dotCycle" stroke="transparent" strokeWidth={0} dot={renderAnomalyDot} activeDot={{ r: 5 }} connectNulls={false} isAnimationActive={false} />
        </LineChart>
      </ChartFrame>
      {/* Legend — line colour marks per-order deviation from the inconsistency band. */}
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px] text-muted-foreground">
        <span className="inline-flex items-center gap-1.5">
          <svg width="16" height="8" aria-hidden="true">
            <line x1="0" y1="4" x2="16" y2="4" stroke={CHART_COLORS[0]} strokeWidth={2} />
          </svg>
          Within the band
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="16" height="8" aria-hidden="true">
            <line x1="0" y1="4" x2="16" y2="4" stroke="var(--destructive)" strokeWidth={2} />
          </svg>
          Outside the band (unusually slow or fast)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="16" height="8" aria-hidden="true">
            <line x1="0" y1="4" x2="16" y2="4" stroke="var(--muted-foreground)" strokeWidth={1.5} strokeDasharray="3 2" />
          </svg>
          Inconsistency band (median ± the flag&apos;s threshold)
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden="true">
            <circle cx="5" cy="5" r="4" fill="var(--destructive)" />
          </svg>
          Has anomalies
        </span>
        <span className="inline-flex items-center gap-1.5">
          <svg width="10" height="10" aria-hidden="true">
            <circle cx="5" cy="5" r="3" fill={CHART_COLORS[0]} />
          </svg>
          Normal
        </span>
      </div>
      <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
        Each point is one order&apos;s cycle time. <span className="text-foreground">Red</span> marks
        an individual order <span className="text-foreground">outside the band</span> — this
        supplier&apos;s median ± the flag&apos;s threshold (1.5× the portfolio-median IQR) — i.e. unusually
        slow (above) or fast (below) <em>for them</em>. That&apos;s a per-order signal: a supplier is
        flagged <span className="text-foreground">Inconsistent</span> only when their <em>overall</em>{" "}
        cycle spread is wide, so a stray red order doesn&apos;t by itself mean flagged (it just means
        that one order stood out). Red dots mark individual Outlier or Stage-dominated orders.
      </p>
    </>
  );
}

// ---- Section 2: cycle stats, styled to the Supplier-Classification aesthetic - #
// Soft ring cards + a coloured delta badge + a tinted spread chip + a speed-rank
// gauge — matching the Classification card's Performance section. Portfolio figures
// are the population median (delta) + roster medians (rank) already loaded; the
// wider/tighter chip is driven by the Inconsistent FLAG itself so it can never
// contradict it (a flagged supplier always reads "wider").
const FASTER_GREEN = "text-green-600 dark:text-green-500";
const SLOWER_RED = "text-red-600 dark:text-red-500";

/** Cycle delta badge — INVERTED vs performance: slower = worse = RED + up arrow;
 *  faster = better = GREEN + down arrow. */
function CycleDeltaBadge({ deltaDays }: { deltaDays: number }) {
  if (Math.abs(deltaDays) < 0.5) {
    return (
      <span className="inline-flex items-center gap-0.5 text-xs font-medium text-muted-foreground">
        <Minus className="h-3 w-3" />0d
      </span>
    );
  }
  const slower = deltaDays > 0;
  const Icon = slower ? ArrowUp : ArrowDown;
  return (
    <span className={`inline-flex items-center gap-0.5 text-xs font-medium tabular-nums ${slower ? SLOWER_RED : FASTER_GREEN}`}>
      <Icon className="h-3 w-3" />
      {Math.abs(Math.round(deltaDays))}d
    </span>
  );
}

/** Spread chip (QuadrantChip-style color-mix): amber "wider" (bad) / green "tighter". */
function SpreadChip({ wider }: { wider: boolean }) {
  const color = wider ? "var(--warning)" : "var(--success)";
  return (
    <span
      className="inline-flex items-center rounded-md px-1.5 py-0.5 text-[11px] font-medium"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 14%, transparent)`, color }}
    >
      {wider ? "wider" : "tighter"}
    </span>
  );
}

/** Soft ring stat card — matches the card's PerfSummaryButton / QuadrantTenureCard. */
function SoftStatCard({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="rounded-xl bg-card px-3.5 py-3 ring-1 ring-foreground/10">
      <div className="text-[11px] font-medium text-muted-foreground">{label}</div>
      {children}
    </div>
  );
}

function CycleStatsBlock({
  cyc,
  portfolio,
  inconsistent,
}: {
  cyc: CycleSupplierDetail["cycle"];
  portfolio?: CyclePortfolioContext;
  inconsistent: boolean;
}) {
  const pMed = portfolio?.median ?? null;

  // Median vs portfolio (population) median — signed (higher cycle = slower).
  const medDelta = pMed != null ? cyc.median_cycle - pMed : null;
  const medianSub =
    pMed == null || medDelta == null
      ? null
      : Math.abs(medDelta) < 0.5
        ? `≈ portfolio (${pMed.toFixed(0)}d)`
        : `${medDelta > 0 ? "slower" : "faster"} than portfolio (${pMed.toFixed(0)}d)`;

  // Wider/tighter is the Inconsistent FLAG itself (supplier IQR vs 1.5× median of
  // per-supplier IQRs), so the chip can NEVER contradict the flag. Peer-relative,
  // not vs the population range (which is inflated by between-supplier variation).
  const wider = inconsistent;

  // Percentile among all suppliers by median cycle.
  const meds = portfolio?.supplierMedians ?? [];
  let rankPct: number | null = null;
  let rankSlower = true;
  let slownessPct = 0;
  if (meds.length > 1) {
    const total = meds.length;
    const slower = meds.filter((m) => m < cyc.median_cycle).length;
    const faster = meds.filter((m) => m > cyc.median_cycle).length;
    slownessPct = Math.round((slower / total) * 100);
    rankSlower = slower >= faster;
    rankPct = Math.round(((rankSlower ? slower : faster) / total) * 100);
  }
  const gaugeColor =
    slownessPct >= 60 ? "var(--warning)" : slownessPct <= 40 ? "var(--success)" : "var(--primary)";

  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        <SoftStatCard label="Median cycle">
          <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <span className="text-[22px] font-medium leading-none tabular-nums">
              {cyc.median_cycle.toFixed(2)}
            </span>
            <span className="text-[11px] text-muted-foreground">d</span>
            {medDelta != null && <CycleDeltaBadge deltaDays={medDelta} />}
          </div>
          {medianSub && <div className="mt-1.5 text-[11px] text-muted-foreground">{medianSub}</div>}
        </SoftStatCard>

        <SoftStatCard label="Typical range">
          <div className="mt-1 flex flex-wrap items-baseline gap-x-1.5 gap-y-0.5">
            <span className="text-[22px] font-medium leading-none tabular-nums">
              {cyc.p25.toFixed(0)}–{cyc.p75.toFixed(0)}
            </span>
            <span className="text-[11px] text-muted-foreground">d</span>
            <SpreadChip wider={wider} />
          </div>
          <div className="mt-1.5 text-[11px] text-muted-foreground">vs typical supplier spread</div>
        </SoftStatCard>

        <SoftStatCard label="POs">
          <div className="mt-1 text-[22px] font-medium leading-none tabular-nums">{cyc.po_count}</div>
        </SoftStatCard>
      </div>

      {/* Speed-rank gauge (fast → slow), filled to the slowness percentile + a marker. */}
      {rankPct != null && (
        <div className="mt-3">
          <div className="mb-1 flex items-baseline justify-between text-[11px]">
            <span className="text-muted-foreground">Speed rank among suppliers</span>
            <span className="tabular-nums text-foreground">
              {rankSlower ? "slower" : "faster"} than {rankPct}%
            </span>
          </div>
          <div
            className="relative h-2 w-full rounded-full"
            style={{ backgroundColor: "color-mix(in srgb, var(--muted-foreground) 15%, transparent)" }}
          >
            <div
              className="absolute inset-y-0 left-0 rounded-full"
              style={{ width: `${slownessPct}%`, backgroundColor: gaugeColor }}
            />
            <div
              className="absolute inset-y-[-2px] w-[2px] rounded-full bg-foreground"
              style={{ left: `calc(${slownessPct}% - 1px)` }}
            />
          </div>
          <div className="mt-1 flex justify-between text-[10px] text-muted-foreground">
            <span>faster</span>
            <span>slower</span>
          </div>
        </div>
      )}

      {/* Slowest stage. */}
      <div className="mt-3 flex items-center gap-2 text-xs text-muted-foreground">
        Slowest stage
        <StageChip stage={cyc.slowest_stage} label={cyc.slowest_stage_label} />
      </div>
    </>
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

function PoList({
  pos,
  stageDominatedPoIds,
}: {
  pos: CycleSupplierDetail["pos"];
  // Span-scoped stage-dominated PO ids (one stage > 60% of cycle) — merged in from
  // the roster so both flag types (outlier + stage-dom) live in this one table.
  stageDominatedPoIds: Set<string>;
}) {
  const { sorted, sort, toggle } = useTableSort<CycleSupplierDetail["pos"][number], string>(
    pos,
    (r, k) => (r as unknown as Record<string, number | string | boolean | null>)[k] as number | string | null,
    "total_cycle_days",
    "desc",
  );
  return (
    // Horizontal scroll is a safety net — the 5 compact date columns fit the 680px
    // dialog on normal widths, but long PO IDs / narrow viewports can overflow.
    <div className="overflow-x-auto">
      <table className="w-full border-collapse text-xs">
        <thead>
          <tr className="border-b text-muted-foreground">
            <PoHead label="PO ID" sortKey="po_id" active={sort.key === "po_id"} dir={sort.dir} onSort={toggle} defaultDir="asc" />
            <PoHead label="PR" sortKey="pr_date" active={sort.key === "pr_date"} dir={sort.dir} onSort={toggle} defaultDir="asc" />
            <PoHead label="PO" sortKey="po_date" active={sort.key === "po_date"} dir={sort.dir} onSort={toggle} defaultDir="asc" />
            <PoHead label="Delivery" sortKey="delivery_date" active={sort.key === "delivery_date"} dir={sort.dir} onSort={toggle} defaultDir="asc" />
            <PoHead label="Invoice" sortKey="invoice_date" active={sort.key === "invoice_date"} dir={sort.dir} onSort={toggle} defaultDir="asc" />
            <PoHead label="Payment" sortKey="payment_date" active={sort.key === "payment_date"} dir={sort.dir} onSort={toggle} defaultDir="asc" />
            <PoHead label="Cycle days" sortKey="total_cycle_days" active={sort.key === "total_cycle_days"} dir={sort.dir} onSort={toggle} align="right" />
            <th className="py-1.5 pl-3 text-left font-medium">Anomalies</th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((p) => {
            const isStageDom = stageDominatedPoIds.has(p.po_id);
            const isFlagged = p.is_anomaly || isStageDom;
            return (
              <tr
                key={p.po_id}
                className="border-b last:border-0"
                // Faint amber tint on any flagged row (outlier or stage-dom, same
                // treatment) so anomalous rows are scannable at a glance.
                style={isFlagged ? { backgroundColor: "color-mix(in srgb, var(--warning) 9%, transparent)" } : undefined}
              >
                <td className="py-1.5 pr-3 font-medium">{p.po_id}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums text-muted-foreground">{fmtMilestone(p.pr_date)}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums text-muted-foreground">{fmtMilestone(p.po_date)}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums text-muted-foreground">{fmtMilestone(p.delivery_date)}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums text-muted-foreground">{fmtMilestone(p.invoice_date)}</td>
                <td className="py-1.5 pr-3 whitespace-nowrap tabular-nums text-muted-foreground">{fmtMilestone(p.payment_date)}</td>
                <td className="py-1.5 text-right tabular-nums">{p.total_cycle_days}</td>
                <td className="py-1.5 pl-3">
                  {isFlagged ? (
                    <span className="flex flex-wrap gap-1">
                      {p.is_anomaly && (
                        <>
                          <FlagBadge color="var(--warning)" label="Long cycle" />
                          {/* ⚠️ The buying method rides WITH the flag, never apart from
                              it. The long-cycle cut is effectively a proxy for "direct
                              award" (the only method whose cycle range reaches the
                              threshold), so a bare flag invites reading a process
                              failure into the expected shape of that channel. */}
                          {p.buying_method && (
                            <span className="text-[10px] text-muted-foreground">
                              {METHOD_LABEL[p.buying_method] ?? p.buying_method}
                            </span>
                          )}
                        </>
                      )}
                      {isStageDom && <FlagBadge color="var(--destructive)" label="Stage-dom" />}
                    </span>
                  ) : (
                    <span className="text-muted-foreground">—</span>
                  )}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ---- Flag badge (outlier / stage-dominated) — used in the PO table's Flags col #
function FlagBadge({ color, label }: { color: string; label: string }) {
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-muted px-1.5 py-0.5 text-[11px] font-medium text-muted-foreground"
    >
      <span className="h-1.5 w-1.5 rounded-full" style={{ backgroundColor: color }} />
      {label}
    </span>
  );
}

// ---- Panel ----------------------------------------------------------------- #
export function CycleTimeSupplierDetailPanel({
  supplierId,
  startDate,
  endDate,
  stageDominatedPoIds,
  inconsistent = false,
  portfolio,
  onClose,
}: {
  supplierId: string | null;
  startDate: string;
  endDate: string;
  // Span-scoped set of stage-dominated PO ids (one stage > 60% of cycle), passed
  // from the roster so this panel can flag them without an API change.
  stageDominatedPoIds: Set<string>;
  // Whether THIS supplier is flagged "Inconsistent" for the span (from the roster's
  // flagsBySupplier). Drives the "Flagged Inconsistent" note above the consistency chart.
  inconsistent?: boolean;
  // Portfolio-level cycle context (population median/range + all supplier medians),
  // for the cycle-stats comparison. From CycleTimeClient; absent → bare stats.
  portfolio?: CyclePortfolioContext;
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
                {(() => {
                  const parts = [s.category, s.abc_class, s.kraljic_quadrant, s.zone].filter(Boolean);
                  if (parts.length === 0 && !s.country) return s.id;
                  return (
                    <>
                      {parts.join(" · ")}
                      {s.country && (
                        <>
                          {parts.length > 0 ? " · " : ""}
                          {s.country}
                          <CountryFlag code={s.country} />
                        </>
                      )}
                    </>
                  );
                })()}
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

        <ProcessDetailBody
          supplierId={supplierId}
          data={current?.data}
          dataErr={current?.err}
          dataLoading={loading}
          stageDominatedPoIds={stageDominatedPoIds}
          inconsistent={inconsistent}
          portfolio={portfolio}
        />
      </DialogContent>
    </Dialog>
  );
}

// ---- Body (presentational; reused by the Action Priorities unified modal) --- #
export function ProcessDetailBody({
  supplierId,
  data,
  dataErr,
  dataLoading,
  stageDominatedPoIds,
  inconsistent = false,
  portfolio,
}: {
  supplierId: string | null;
  data: CycleSupplierDetail | undefined;
  dataErr: string | undefined;
  dataLoading: boolean;
  stageDominatedPoIds: Set<string>;
  inconsistent?: boolean;
  portfolio?: CyclePortfolioContext;
}) {
  const [poView, setPoView] = useState<View>("table");
  const [prevSupplierId, setPrevSupplierId] = useState(supplierId);
  if (prevSupplierId !== supplierId) {
    setPrevSupplierId(supplierId);
    setPoView("table");
  }
  const s = data?.supplier;
  const cyc = data?.cycle;

  return (
    <>
      {dataLoading && (
        <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading cycle detail…
        </div>
      )}
      {dataErr && <p className="p-4 text-sm text-destructive">{dataErr}</p>}

      {data && s && cyc && (
        <>
          {/* Section 2: cycle stats (enriched with portfolio comparison) */}
            <div className="border-b p-4">
              <h4 className="mb-2 text-sm font-medium text-muted-foreground">Cycle stats</h4>
              <CycleStatsBlock cyc={cyc} portfolio={portfolio} inconsistent={inconsistent} />
            </div>

            {/* Section 4: per-stage breakdown vs portfolio */}
            <div className="border-b p-4">
              <h4 className="mb-2 text-sm font-medium text-muted-foreground">
                Per-stage average — this supplier vs portfolio
              </h4>
              <StageBars stages={data.stages} />
            </div>

            {/* Section 5+6 merged: ONE convertible block — Table (5 milestone dates)
                ⇄ Chart (cycle-consistency line), same PO data in two views (Spend's
                ViewToggle pattern). The "Flagged Inconsistent" note sits ABOVE the
                toggle because it's the supplier-level flag — it applies to both views,
                not to the table or the chart specifically. */}
            <div className="p-4">
              <h4 className="mb-2 text-sm font-medium text-muted-foreground">
                Purchase orders ({cyc.po_count})
              </h4>
              {inconsistent && (
                <div
                  title={INCONSISTENT_NOTE_TOOLTIP}
                  className="mb-3 flex cursor-help items-start gap-2 rounded-md border px-3 py-2 text-xs leading-relaxed"
                  style={{
                    backgroundColor: "color-mix(in srgb, var(--warning) 10%, transparent)",
                    borderColor: "color-mix(in srgb, var(--warning) 35%, transparent)",
                  }}
                >
                  <span className="mt-1 h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: "var(--warning)" }} />
                  <span>
                    <span className="font-medium text-foreground">Flagged Inconsistent</span> — cycle
                    times vary more than typical for suppliers in this period.
                  </span>
                </div>
              )}
              {data.pos.length > 0 ? (
                <>
                  <ViewToggle view={poView} setView={setPoView} />
                  {poView === "table" ? (
                    <PoList pos={data.pos} stageDominatedPoIds={stageDominatedPoIds} />
                  ) : (
                    <>
                      <p className="mb-2 text-xs text-muted-foreground">
                        Cycle days per order (by date) · red = outside the inconsistency band (median ± the flag&apos;s threshold)
                      </p>
                      <CycleConsistencyChart
                        pos={data.pos}
                        median={cyc.median_cycle}
                        // Band half-width = the flag threshold (portfolio-median IQR × 1.5), so
                        // crossings ⟺ the Inconsistent flag. Absent portfolio → their own 1.5×IQR.
                        bandHalfWidth={portfolio?.iqrCutoff ?? 1.5 * cyc.iqr}
                        stageDominatedPoIds={stageDominatedPoIds}
                      />
                    </>
                  )}
                </>
              ) : (
                <p className="py-6 text-center text-sm text-muted-foreground">
                  No purchase orders in this period.
                </p>
              )}
            </div>
          </>
        )}
    </>
  );
}
