"use client";

import type {
  KraljicResult,
  PerformanceSpendResult,
  AbcResult,
  KraljicQuadrant,
} from "@/lib/analysis-types";
import { computeSynthesis } from "@/lib/supplier-classification";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

const num0 = new Intl.NumberFormat("en-US");
const pct1 = (v: number) => `${v.toFixed(1)}%`;

/** "from 2024 to 2026" (range) / "in 2025" (single year). */
function periodPhrase(periodLabel: string, isRangeMode: boolean): string {
  if (!periodLabel) return "in this period";
  if (isRangeMode) {
    const parts = periodLabel.split(/[–-]/).map((s) => s.trim());
    if (parts.length === 2 && parts[0] && parts[1]) return `from ${parts[0]} to ${parts[1]}`;
    return `over ${periodLabel}`;
  }
  return `in ${periodLabel}`;
}

/**
 * "Classification at a glance" — narrative summary of the combined Kraljic +
 * performance picture, mirroring Spend Overview's InsightsPanel. Computed
 * client-side from the already-loaded analyses; period-aware.
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

  const profileOf = (q: KraljicQuadrant) =>
    kraljic?.quadrant_profiles.find((p) => p.quadrant === q);
  const strategic = profileOf("Strategic");
  const leverage = profileOf("Leverage");

  const groups = computeSynthesis(perf);
  const strategicUnder = groups.strategic_under.length;
  const workhorse = groups.leverage_workhorse.length;
  const bottleneckCritical = groups.bottleneck_critical.length;

  const zoneOf = (z: PerformanceSpendResult["zone_profiles"][number]["zone"]) =>
    perf.zone_profiles.find((p) => p.zone === z);
  const critical = zoneOf("Critical Issues");
  const gems = zoneOf("Hidden Gems");

  return (
    <Card>
      <CardHeader>
        <CardTitle>Classification at a glance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm leading-relaxed">
        <p>
          Of {num0.format(total)} suppliers active {phrase},{" "}
          {strategic ? (
            <>
              <strong>{strategic.n_suppliers}</strong> sit in the{" "}
              <strong>Strategic</strong> quadrant (
              {pct1(strategic.pct_of_total_spend)} of spend) — high-spend,
              hard-to-replace relationships that warrant senior-level management
            </>
          ) : (
            <>the Kraljic split is unavailable for this period</>
          )}
          . Average composite performance is <strong>{avgPerf.toFixed(1)}</strong>,
          against a period median of <strong>{median.toFixed(1)}</strong>.
        </p>

        <div className="space-y-1">
          <h3 className="font-medium">Where the two lenses meet</h3>
          <p>
            {strategicUnder > 0 ? (
              <>
                <strong>{strategicUnder}</strong> Strategic supplier
                {strategicUnder === 1 ? "" : "s"} sit below the median — the
                highest-priority engagement target{strategicUnder === 1 ? "" : "s"},
                where high dependence meets weak performance.
              </>
            ) : (
              <>Every Strategic supplier performs at or above the median this period.</>
            )}{" "}
            {workhorse > 0 && (
              <>
                Conversely, <strong>{workhorse}</strong> Leverage workhorse
                {workhorse === 1 ? "" : "s"} pair competitive spend with
                above-median performance — dependable volume to consolidate around.
              </>
            )}
          </p>
        </div>

        <div className="space-y-1">
          <h3 className="font-medium">Patterns worth noting</h3>
          <ul className="list-disc space-y-1 pl-5 text-muted-foreground">
            {critical && (
              <li>
                {critical.n_suppliers} supplier
                {critical.n_suppliers === 1 ? "" : "s"} fall in the Critical
                Issues zone (high spend, low performance), absorbing{" "}
                {pct1(critical.pct_of_total_spend)} of spend.
              </li>
            )}
            {gems && gems.n_suppliers > 0 && (
              <li>
                {gems.n_suppliers} Hidden Gem
                {gems.n_suppliers === 1 ? "" : "s"} perform above the median on
                modest spend — promotion candidates worth a closer look.
              </li>
            )}
            {bottleneckCritical > 0 && (
              <li>
                {bottleneckCritical} Bottleneck supplier
                {bottleneckCritical === 1 ? "" : "s"} are both hard to replace and
                underperforming — small dollars, outsized supply risk.
              </li>
            )}
            {leverage && (
              <li>
                Leverage suppliers carry {pct1(leverage.pct_of_total_spend)} of
                spend in competitive categories — the natural arena for negotiation
                and RFx.
              </li>
            )}
            {abc && (
              <li>
                ABC concentration: {abc.summary.A.n} Class-A suppliers account for{" "}
                {pct1(abc.summary.A.pct_of_spend * 100)} of spend.
              </li>
            )}
          </ul>
        </div>

        <p className="text-xs italic text-muted-foreground">
          Click a cross-classification card or any supplier row for detail. Use the
          period selector above to change the window.
        </p>
      </CardContent>
    </Card>
  );
}
