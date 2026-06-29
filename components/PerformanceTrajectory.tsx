"use client";

import { ArrowUp, ArrowDown, Minus } from "lucide-react";
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  CartesianGrid,
} from "recharts";
import type { SupplierEvolution } from "@/lib/spend-overview-types";
import { ABC_COLORS, QUADRANT_COLORS, CHART_COLORS } from "@/lib/chart-colors";
import { formatCompactCurrency } from "@/lib/utils";
import { ChartFrame } from "@/components/charts/ChartFrame";
import { usePortalTooltip, PortalTooltip } from "@/components/charts/PortalTooltip";

type SubKey = "quality" | "delivery" | "service" | "process" | "risk";
const SUBS: { key: SubKey; label: string; weight: number }[] = [
  { key: "quality", label: "Quality", weight: 25 },
  { key: "delivery", label: "Delivery", weight: 25 },
  { key: "service", label: "Service", weight: 15 },
  { key: "process", label: "Process", weight: 20 },
  { key: "risk", label: "Risk", weight: 15 },
];

const trendCls = (t: "up" | "down" | "flat") =>
  t === "up"
    ? "text-green-600 dark:text-green-500"
    : t === "down"
      ? "text-red-600 dark:text-red-500"
      : "text-muted-foreground";

// Tiny inline-SVG sparkline (line + dots), inherits `currentColor`. Preserves
// period gaps on the x-axis; renders a single dot for one point, nothing for 0.
// Each dot is hoverable + keyboard-focusable and shows a "{year}: {value}"
// tooltip (Fix 3); `years` is index-aligned with `values`.
function CardSparkline({ values, years }: { values: Array<number | null>; years: string[] }) {
  const tooltip = usePortalTooltip<{ year: string; value: number }>();
  const w = 92;
  const h = 46;
  const pad = 5;
  const n = values.length;
  const pts = values
    .map((v, i) => ({ v, i }))
    .filter((p): p is { v: number; i: number } => p.v != null);
  if (pts.length === 0) return <div style={{ height: h }} />;

  const vals = pts.map((p) => p.v);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;
  const x = (i: number) => (n > 1 ? pad + (i / (n - 1)) * (w - 2 * pad) : w / 2);
  const y = (v: number) => h - pad - ((v - min) / span) * (h - 2 * pad);
  const d = pts
    .map((p, k) => `${k === 0 ? "M" : "L"}${x(p.i).toFixed(1)},${y(p.v).toFixed(1)}`)
    .join(" ");

  return (
    <>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="group" aria-label="Sub-score trajectory">
        {pts.length >= 2 && (
          <path d={d} fill="none" stroke="currentColor" strokeWidth={1.5} strokeLinejoin="round" strokeLinecap="round" />
        )}
        {pts.map((p) => {
          const year = years[p.i] ?? "";
          return (
            <g
              key={p.i}
              tabIndex={0}
              role="img"
              aria-label={`${year}: ${p.v.toFixed(2)}`}
              style={{ cursor: "pointer" }}
              onMouseEnter={(e) => tooltip.show(e, { year, value: p.v })}
              onMouseMove={(e) => tooltip.move(e)}
              onMouseLeave={tooltip.hide}
              onFocus={(e) => {
                const r = (e.currentTarget as SVGGElement).getBoundingClientRect();
                tooltip.show({ clientX: r.left + r.width / 2, clientY: r.top }, { year, value: p.v });
              }}
              onBlur={tooltip.hide}
            >
              {/* Transparent hit target for a comfortable hover/focus area. */}
              <circle cx={x(p.i)} cy={y(p.v)} r={7} fill="transparent" />
              <circle cx={x(p.i)} cy={y(p.v)} r={2.5} fill="currentColor" />
            </g>
          );
        })}
      </svg>
      {tooltip.tip && (
        <PortalTooltip x={tooltip.tip.x} y={tooltip.tip.y}>
          <span className="font-medium tabular-nums">
            {tooltip.tip.data.year}: {tooltip.tip.data.value.toFixed(2)}
          </span>
        </PortalTooltip>
      )}
    </>
  );
}

function SubScoreCard({
  label,
  value,
  weight,
  trajectory,
  years,
  trend,
  delta,
}: {
  label: string;
  value: number | null;
  weight: number;
  trajectory: Array<number | null>;
  years: string[];
  trend: "up" | "down" | "flat";
  delta: number | null;
}) {
  const deltaTrend = delta == null ? "flat" : delta > 0 ? "up" : delta < 0 ? "down" : "flat";
  const DeltaIcon = deltaTrend === "up" ? ArrowUp : deltaTrend === "down" ? ArrowDown : Minus;
  return (
    <div className="flex flex-col gap-1 rounded-xl border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="text-[22px] font-medium leading-none tabular-nums">
        {value != null ? value.toFixed(2) : "—"}
      </div>
      <div className={`-mx-0.5 ${trendCls(trend)}`}>
        <CardSparkline values={trajectory} years={years} />
      </div>
      {/* Weight indicator: label + thin filled bar (decision C). */}
      <div className="flex flex-col gap-1">
        <div className="text-[11px] leading-none text-muted-foreground">
          <span className="font-medium text-foreground">{weight}%</span> weight
        </div>
        <div
          className="h-[3px] w-full overflow-hidden rounded-full"
          style={{ backgroundColor: "color-mix(in srgb, var(--muted-foreground) 18%, transparent)" }}
        >
          <div
            className="h-full rounded-full"
            style={{ width: `${weight}%`, backgroundColor: "var(--primary)" }}
          />
        </div>
      </div>
      {delta == null ? (
        <div className="text-[11px] text-muted-foreground">first year on record</div>
      ) : delta === 0 ? (
        // Zero-delta (Fix 2): "stable" instead of "0.00 vs prev".
        <div className={`inline-flex items-center gap-0.5 text-[11px] ${trendCls("flat")}`}>
          <Minus className="h-3 w-3" />
          stable
        </div>
      ) : (
        <div className={`inline-flex items-center gap-0.5 text-[11px] tabular-nums ${trendCls(deltaTrend)}`}>
          <DeltaIcon className="h-3 w-3" />
          {delta > 0 ? "+" : ""}
          {delta.toFixed(2)} vs prev
        </div>
      )}
    </div>
  );
}

// Composite-chart tooltip (Fix 5): year prominent on top, score below.
function PerfTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ value: number | null }>;
  label?: string | number;
}) {
  if (!active || !payload?.length) return null;
  const v = payload[0].value;
  return (
    <div className="rounded-md border bg-background p-2 shadow-sm">
      <div className="text-sm font-medium leading-none text-foreground">{label}</div>
      <div className="mt-1 text-xs text-muted-foreground tabular-nums">
        {v == null ? "—" : `${Number(v).toFixed(2)} / out of 100`}
      </div>
    </div>
  );
}

// Classification chip — color-mix tint + token text; null → muted "—".
function Chip({ color, label }: { color: string | null; label: string }) {
  if (!color) {
    return <span className="text-muted-foreground">—</span>;
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

// Classification history as a table (Spend Overview panel default).
function HistoryTable({ periods }: { periods: SupplierEvolution["periods"] }) {
  return (
    <div className="overflow-hidden rounded-md border">
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b bg-muted/40 text-left text-muted-foreground">
            <th className="px-2 py-1.5 font-medium">Year</th>
            <th className="px-2 py-1.5 text-right font-medium">Performance</th>
            <th className="px-2 py-1.5 font-medium">ABC</th>
            <th className="px-2 py-1.5 font-medium">Kraljic</th>
            <th className="px-2 py-1.5 text-right font-medium">Spend</th>
          </tr>
        </thead>
        <tbody>
          {periods.map((p) => {
            const inactive = p.spend <= 0 && p.invoiceCount <= 0;
            return (
              <tr key={p.year} className={`border-b last:border-0 ${inactive ? "opacity-50" : ""}`}>
                <td className="px-2 py-1.5 font-medium">{p.year}</td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {p.performanceScore != null ? p.performanceScore.toFixed(2) : "—"}
                </td>
                <td className="px-2 py-1.5">
                  <Chip color={p.abcClass ? ABC_COLORS[p.abcClass] : null} label={p.abcClass ?? "—"} />
                </td>
                <td className="px-2 py-1.5">
                  <Chip color={p.kraljicQuadrant ? QUADRANT_COLORS[p.kraljicQuadrant] : null} label={p.kraljicQuadrant ?? "—"} />
                </td>
                <td className="px-2 py-1.5 text-right tabular-nums">
                  {inactive ? "—" : formatCompactCurrency(p.spend)}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

/**
 * The performance expand content, shared by both detail panels: a composite line
 * chart, per-sub-score trajectory cards (value + sparkline + weight bar + delta),
 * and a classification history (compact table). All derived from the supplier's
 * all-years evolution data. `selectedYear` period-scopes ONLY the sub-score
 * sparklines (Fix 1): single-year → points up to & including that year; null
 * (range) → all years. The value/delta and the composite chart stay all-years.
 */
export function PerformanceTrajectory({
  data,
  selectedYear = null,
}: {
  data: SupplierEvolution;
  selectedYear?: string | null;
}) {
  const hasPerf = data.periods.some((p) => p.performanceScore != null);
  const years = data.periods.map((p) => p.year);
  // Which periods feed the sparkline: all in range mode; up to & including the
  // selected year in single-year mode.
  const sparkKeep = selectedYear
    ? data.periods.map((p) => p.year <= selectedYear)
    : data.periods.map(() => true);

  return (
    <div className="flex flex-col gap-5">
      <p className="text-[11px] text-muted-foreground">All years (not period-scoped).</p>

      {/* 1. Composite performance line */}
      {hasPerf ? (
        <section>
          <h5 className="mb-2 text-xs font-medium text-muted-foreground">Performance score</h5>
          <ChartFrame height={180}>
            <LineChart data={data.periods} margin={{ left: 4, right: 12, top: 8, bottom: 4 }}>
              <CartesianGrid strokeDasharray="3 3" />
              <XAxis dataKey="year" tick={{ fontSize: 11 }} />
              <YAxis domain={[0, 100]} tick={{ fontSize: 10 }} width={32} />
              <Tooltip content={<PerfTooltip />} />
              <Line type="monotone" dataKey="performanceScore" stroke={CHART_COLORS[1]} strokeWidth={2} dot={{ r: 3 }} isAnimationActive={false} />
            </LineChart>
          </ChartFrame>
        </section>
      ) : (
        <p className="text-sm text-muted-foreground">No performance history available.</p>
      )}

      {/* 2. Sub-score trajectory cards */}
      <section>
        <h5 className="mb-2 text-xs font-medium text-muted-foreground">Score components</h5>
        {/* auto-fit: 5 cols when wide, gracefully 3/2 as the panel narrows (Y). */}
        <div className="grid grid-cols-[repeat(auto-fit,minmax(110px,1fr))] gap-2">
          {SUBS.map(({ key, label, weight }) => {
            const trajectory = data.periods.map((p) => p.subScores?.[key] ?? null);
            const active = trajectory.filter((v): v is number => v != null);
            // value/delta/trend stay all-years (the card number is the latest).
            const value = active.length ? active[active.length - 1] : null;
            const first = active[0];
            const last = active[active.length - 1];
            const trend: "up" | "down" | "flat" =
              active.length >= 2 ? (last > first ? "up" : last < first ? "down" : "flat") : "flat";
            const delta = active.length >= 2 ? last - active[active.length - 2] : null;
            // Period-scoped sparkline series (Fix 1).
            const sparkValues = trajectory.filter((_, i) => sparkKeep[i]);
            const sparkYears = years.filter((_, i) => sparkKeep[i]);
            return (
              <SubScoreCard
                key={key}
                label={label}
                value={value}
                weight={weight}
                trajectory={sparkValues}
                years={sparkYears}
                trend={trend}
                delta={delta}
              />
            );
          })}
        </div>
      </section>

      {/* 3. Classification history (compact table, both panels — Fix 4). */}
      <section>
        <h5 className="mb-2 text-xs font-medium text-muted-foreground">Classification history</h5>
        <HistoryTable periods={data.periods} />
      </section>

      {data.insights.length > 0 && (
        <section>
          <h5 className="mb-1 text-xs font-medium text-muted-foreground">Insights</h5>
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
