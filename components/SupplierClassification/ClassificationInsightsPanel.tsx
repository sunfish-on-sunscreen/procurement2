"use client";

import type {
  KraljicResult,
  PerformanceSpendResult,
  AbcResult,
  KraljicQuadrant,
} from "@/lib/analysis-types";
import { computeSynthesis } from "@/lib/supplier-classification";
import { cardElevation } from "@/lib/utils";
import { QUADRANT_COLORS } from "@/lib/chart-colors";
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
  periodLabel,
  isRangeMode,
}: {
  kraljic: KraljicResult | null;
  perf: PerformanceSpendResult;
  abc: AbcResult | null;
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

        {/* 2. Quadrant breakdown — one line, bold counts */}
        {kraljic && (
          <div className="text-sm text-muted-foreground">
            Quadrant breakdown:{" "}
            {SEGMENTS.map((q, i) => (
              <span key={q}>
                {i > 0 && <span className="text-muted-foreground/40"> · </span>}
                <span className="font-semibold tabular-nums text-foreground">{countOf(q)}</span>{" "}
                <span style={{ color: QUADRANT_COLORS[q] }}>{q}</span>
              </span>
            ))}
          </div>
        )}

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
