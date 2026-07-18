"use client";

import type { ReactNode } from "react";
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
import { StatBlock } from "@/components/ui/stat-block";

const num0 = new Intl.NumberFormat("en-US");

/** Prose span phrase for the narrative ("in 2025" / "from 2024 to 2026"). */
function periodPhraseProse(periodLabel: string, isRangeMode: boolean): string {
  if (!periodLabel) return "in this period";
  if (isRangeMode) {
    const parts = periodLabel.split(/[–-]/).map((s) => s.trim());
    if (parts.length === 2 && parts[0] && parts[1]) return `from ${parts[0]} to ${parts[1]}`;
    return `over ${periodLabel}`;
  }
  return `in ${periodLabel}`;
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

/**
 * "Classification at a glance" — a NARRATIVE prose summary mirroring the Cycle-at-a-glance
 * pattern (lead paragraph + self-omitting "Worth noting" bullets + closing hint), with the
 * stat cells relocated BELOW the prose. Every number is computed client-side from the
 * already-loaded analyses; clauses whose data is absent for the period omit gracefully
 * rather than render a placeholder or a hardcoded shape claim.
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
  const prose = periodPhraseProse(periodLabel, isRangeMode);
  const total = perf.suppliers.length;
  const median = perf.axis_thresholds.performance_median;
  const avgPerf =
    total > 0
      ? perf.suppliers.reduce((s, x) => s + x.performance_score, 0) / total
      : 0;

  const countOf = (q: KraljicQuadrant) =>
    kraljic?.quadrant_profiles.find((p) => p.quadrant === q)?.n_suppliers ?? 0;

  // F14: portfolio size = the SAME population the quadrant counts come from (the
  // kraljic roster), so the counts always sum to it. Falls back to the perf set
  // when kraljic is absent. (avgPerf keeps its own denominator `total`.)
  const portfolioSize = kraljic
    ? kraljic.quadrant_profiles.reduce((s, p) => s + p.n_suppliers, 0)
    : total;

  const strategicCount = countOf("Strategic");
  const strategicUnder = computeSynthesis(perf).strategic_under.length;
  const classA = abc?.summary.A.n ?? null;

  // Distribution sentence: YoY read (single-year with prior) or a static
  // largest-quadrant note. Self-omits when neither applies.
  let distributionSentence: ReactNode = null;
  if (!isRangeMode && previous) {
    const dir =
      avgPerf > previous.avg_performance
        ? "up"
        : avgPerf < previous.avg_performance
          ? "down"
          : "unchanged";
    const changed = SEGMENTS.map((q) => ({
      q,
      d: countOf(q) - (previous.quadrant_counts[q] ?? 0),
    })).filter((x) => x.d !== 0);
    const shift = quadShiftPhrase(changed);
    distributionSentence = (
      <>
        {" "}
        Average performance {dir === "unchanged" ? "held at" : `moved ${dir} from`}{" "}
        {dir !== "unchanged" && (
          <>
            <strong className="tabular-nums">{previous.avg_performance.toFixed(2)}</strong> to{" "}
          </>
        )}
        <strong className="tabular-nums">{avgPerf.toFixed(2)}</strong>
        {shift ? <>, with {shift}.</> : "."}
      </>
    );
  } else if (kraljic && total > 0) {
    const largest = SEGMENTS.map((q) => ({ q, n: countOf(q) })).sort((a, b) => b.n - a.n)[0];
    if (largest && largest.n > 0) {
      distributionSentence = (
        <>
          {" "}
          <strong>{largest.q}</strong> is the largest quadrant (
          <strong className="tabular-nums">{largest.n}</strong> supplier
          {largest.n === 1 ? "" : "s"}).
        </>
      );
    }
  }

  // "Worth noting" bullets — each self-omits when its data doesn't apply.
  const bullets: ReactNode[] = [];
  if (strategicUnder > 0) {
    bullets.push(
      <li key="strategic-under">
        <strong className="tabular-nums">{strategicUnder}</strong> Strategic supplier
        {strategicUnder === 1 ? "" : "s"} sit at or below the period median — warrant attention.
      </li>,
    );
  } else if (strategicCount > 0) {
    bullets.push(
      <li key="strategic-above">
        All <strong className="tabular-nums">{strategicCount}</strong> Strategic suppliers sit
        above the period median this period.
      </li>,
    );
  }
  if (classA != null && classA > 0) {
    bullets.push(
      <li key="class-a">
        <strong className="tabular-nums">{num0.format(classA)}</strong> supplier
        {classA === 1 ? "" : "s"} carry the top spend concentration (ABC Class A).
      </li>,
    );
  }

  return (
    <>
    <Card className={cardElevation}>
      <CardHeader>
        <CardTitle>Classification at a glance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4 text-sm leading-relaxed">
        <p>
          Your active supplier portfolio holds{" "}
          <strong className="tabular-nums">{num0.format(portfolioSize)}</strong> supplier
          {portfolioSize === 1 ? "" : "s"} {prose}
          {kraljic ? ", positioned across the four Kraljic-matrix quadrants by spend and supply risk" : ""}.
          {total > 0 && (
            <>
              {" "}
              Performance averages{" "}
              <strong className="tabular-nums">{avgPerf.toFixed(2)}</strong> against a period median
              of <strong className="tabular-nums">{median.toFixed(2)}</strong>.
            </>
          )}
          {distributionSentence}
        </p>

        {bullets.length > 0 && (
          <div className="space-y-1">
            <h3 className="font-medium">Worth noting</h3>
            <ul className="list-disc space-y-1 pl-5 text-muted-foreground">{bullets}</ul>
          </div>
        )}

        <p className="text-xs italic text-muted-foreground">
          Click a group in Classification views to see who sits there, a scatter point for a
          supplier&apos;s profile, or any table row below.
        </p>
      </CardContent>
    </Card>

    {/* Stat grid — the prominent StatBlock KPI row shared with Process Health /
        Action Priorities / Spend Overview. All values already computed above. */}
    <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
      <StatBlock
        size="comfortable"
        label="Portfolio size"
        value={num0.format(portfolioSize)}
        sublabel="active suppliers"
      />
      <StatBlock
        size="comfortable"
        label="Avg performance"
        value={avgPerf.toFixed(2)}
        sublabel={`period median ${median.toFixed(2)}`}
      />
      <StatBlock
        size="comfortable"
        label="Strategic suppliers"
        value={num0.format(strategicCount)}
        sublabel="high spend × high risk"
      />
      {classA != null && (
        <StatBlock
          size="comfortable"
          label="Class A suppliers"
          value={num0.format(classA)}
          sublabel="top spend concentration"
        />
      )}
    </div>
    </>
  );
}
