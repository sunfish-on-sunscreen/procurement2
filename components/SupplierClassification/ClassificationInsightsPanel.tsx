"use client";

import type {
  KraljicResult,
  PerformanceSpendResult,
  AbcResult,
  KraljicQuadrant,
} from "@/lib/analysis-types";
import type { ClassificationPrevSummary } from "@/lib/supplier-classification-types";
import { computeSynthesis } from "@/lib/supplier-classification";
import { cardElevation } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const num0 = new Intl.NumberFormat("en-US");

/** "from 2024 to 2026" (range) / "in 2025" (single year). */
function periodPhrase(periodLabel: string, isRangeMode: boolean): string {
  if (!periodLabel) return "this period";
  if (isRangeMode) {
    const parts = periodLabel.split(/[–-]/).map((s) => s.trim());
    if (parts.length === 2 && parts[0] && parts[1]) return `${parts[0]}–${parts[1]}`;
    return periodLabel;
  }
  return periodLabel;
}

const SEGMENTS: KraljicQuadrant[] = ["Strategic", "Leverage", "Bottleneck", "Routine"];

/** "Strategic + Routine each ↓6, Leverage + Bottleneck each ↑4" from per-quadrant deltas. */
function quadShiftPhrase(changed: { q: KraljicQuadrant; d: number }[]): string {
  const groups = new Map<number, KraljicQuadrant[]>();
  for (const { q, d } of changed) {
    const arr = groups.get(d) ?? [];
    arr.push(q);
    groups.set(d, arr);
  }
  return [...groups.entries()]
    .sort((a, b) => Math.abs(b[0]) - Math.abs(a[0]))
    .map(([d, qs]) => {
      const arrow = d > 0 ? "↑" : "↓";
      const each = qs.length > 1 ? " each" : "";
      return `${qs.join(" + ")}${each} ${arrow}${Math.abs(d)}`;
    })
    .join(", ");
}

/** Mini KPI card — surface tint, sentence-case label, prominent tabular value. */
function KpiCell({ label, value, sub }: { label: string; value: string; sub: string }) {
  return (
    <div className="rounded-[10px] border bg-muted/30 p-3">
      <div className="text-xs text-muted-foreground">{label}</div>
      <div className="mt-0.5 text-xl font-medium leading-tight tabular-nums">{value}</div>
      <div className="mt-0.5 text-xs text-muted-foreground">{sub}</div>
    </div>
  );
}

/**
 * "Classification at a glance" — scannable summary (decision O): a 3-card KPI grid
 * (portfolio size, avg composite, Class-A count), the quadrant split on one line,
 * and a callout for Strategic suppliers below the median. Period-aware, computed
 * client-side.
 */
export function ClassificationInsightsPanel({
  kraljic,
  perf,
  abc,
  previous,
  periodLabel,
  isRangeMode,
}: {
  kraljic: KraljicResult | null;
  perf: PerformanceSpendResult;
  abc: AbcResult | null;
  previous: ClassificationPrevSummary | null;
  periodLabel: string;
  isRangeMode: boolean;
}) {
  const phrase = periodPhrase(periodLabel, isRangeMode);
  const total = perf.suppliers.length;
  const median = perf.axis_thresholds.performance_median;
  const avgPerf =
    total > 0
      ? perf.suppliers.reduce((s, x) => s + x.performance_score, 0) / total
      : 0;

  const countOf = (q: KraljicQuadrant) =>
    kraljic?.quadrant_profiles.find((p) => p.quadrant === q)?.n_suppliers ?? 0;

  const strategicUnder = computeSynthesis(perf).strategic_under.length;

  // Portfolio-level finding line (decision D). Single-year-with-prior → a YoY
  // read (avg composite + quadrant shifts); range → a static distribution note.
  let finding: React.ReactNode = null;
  if (!isRangeMode && previous) {
    const dir =
      avgPerf > previous.avg_performance ? "up" : avgPerf < previous.avg_performance ? "down" : "flat";
    const changed = SEGMENTS.map((q) => ({ q, d: countOf(q) - (previous.quadrant_counts[q] ?? 0) })).filter(
      (x) => x.d !== 0,
    );
    const shift = quadShiftPhrase(changed);
    finding = (
      <>
        Avg composite {dir}{" "}
        <span className="font-semibold tabular-nums text-foreground">
          {previous.avg_performance.toFixed(2)}
        </span>{" "}
        →{" "}
        <span className="font-semibold tabular-nums text-foreground">{avgPerf.toFixed(2)}</span>
        {shift ? <> — {shift}.</> : "."}
      </>
    );
  } else if (total > 0) {
    const largest = SEGMENTS.map((q) => ({ q, n: countOf(q) })).sort((a, b) => b.n - a.n)[0];
    finding = (
      <>
        Across {phrase}, <span className="font-medium text-foreground">{largest.q}</span> is the
        largest quadrant (
        <span className="font-semibold tabular-nums text-foreground">{largest.n}</span>); portfolio
        avg composite{" "}
        <span className="font-semibold tabular-nums text-foreground">{avgPerf.toFixed(2)}</span>.
      </>
    );
  }

  return (
    <Card className={cardElevation}>
      <CardHeader>
        <CardTitle>Classification at a glance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 1. KPI grid — portfolio size · avg composite · Class-A count */}
        <div className="grid grid-cols-3 gap-2">
          <KpiCell
            label="Portfolio size"
            value={num0.format(total)}
            sub={`active suppliers · ${phrase}`}
          />
          <KpiCell
            label="Avg composite"
            value={avgPerf.toFixed(2)}
            sub={`period median ${median.toFixed(2)}`}
          />
          <KpiCell
            label="Class-A suppliers"
            value={abc ? num0.format(abc.summary.A.n) : "—"}
            sub="top spend concentration"
          />
        </div>

        {/* Portfolio finding — one line (YoY single-year / static range). The
            per-quadrant counts live in the quadrant summary table, not here. */}
        {finding && <p className="text-sm text-muted-foreground">{finding}</p>}

        {/* 3. Callout — Strategic below median */}
        {strategicUnder > 0 ? (
          <div
            className="rounded-lg border px-3 py-2.5 text-sm"
            style={{
              backgroundColor: "color-mix(in srgb, var(--destructive) 8%, transparent)",
              borderColor: "color-mix(in srgb, var(--destructive) 35%, transparent)",
            }}
          >
            <span className="font-semibold tabular-nums">{strategicUnder}</span> Strategic
            supplier{strategicUnder === 1 ? "" : "s"} sit below the period median —
            warrant attention.
          </div>
        ) : (
          <div className="rounded-lg border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
            All Strategic suppliers sit at or above the period median this period.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
