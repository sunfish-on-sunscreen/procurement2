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

/**
 * "Classification at a glance" — scannable summary (decision O): big portfolio
 * count, the quadrant split, the avg composite, and a callout for Strategic
 * suppliers below the median. Period-aware, computed client-side.
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
      <CardContent className="space-y-5">
        {/* 1. Portfolio size */}
        <div>
          <div className="text-3xl font-semibold leading-none tabular-nums">{num0.format(total)}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            suppliers in portfolio · {phrase}
          </div>
        </div>

        {/* 2. Quadrant segments */}
        {kraljic && (
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            {SEGMENTS.map((q, i) => (
              <span key={q} className="inline-flex items-center gap-1.5">
                {i > 0 && <span className="text-muted-foreground/40">·</span>}
                <span className="font-semibold tabular-nums">{countOf(q)}</span>
                <span style={{ color: QUADRANT_COLORS[q] }}>{q}</span>
              </span>
            ))}
          </div>
        )}

        {/* 3. Average composite */}
        <div>
          <div className="text-3xl font-semibold leading-none tabular-nums">{avgPerf.toFixed(2)}</div>
          <div className="mt-1 text-sm text-muted-foreground">
            avg composite performance · period median {median.toFixed(2)}
            {abc ? ` · ${abc.summary.A.n} Class-A suppliers` : ""}
          </div>
        </div>

        {/* 4. Callout — Strategic below median */}
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
