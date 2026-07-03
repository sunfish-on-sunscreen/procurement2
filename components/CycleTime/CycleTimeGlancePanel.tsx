"use client";

import type { ReactNode } from "react";
import type { CycleTimeResult, KraljicQuadrant } from "@/lib/analysis-types";
import type { CycleSupplierRow, CycleCategoryRow } from "@/lib/cycle-time-types";
import { cardElevation } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STAGES = [
  { key: "pr_to_po", label: "PR to PO" },
  { key: "po_to_delivery", label: "PO to Delivery" },
  { key: "delivery_to_invoice", label: "Delivery to Invoice" },
  { key: "invoice_to_payment", label: "Invoice to Payment" },
] as const;

const QUAD_ORDER: KraljicQuadrant[] = ["Strategic", "Leverage", "Bottleneck", "Routine"];

const num0 = new Intl.NumberFormat("en-US");
const d0 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(0));
const d1 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(1));
const d2 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(2));
const formatP = (p: number) => (p < 0.001 ? p.toExponential(2) : p.toFixed(3));

/** "from 2024 to 2026" (range) / "in 2025" (single year), tolerant of label shape. */
function periodPhrase(periodLabel: string, isRangeMode: boolean): string {
  if (!periodLabel) return "in this period";
  if (isRangeMode) {
    const parts = periodLabel.split(/[–-]/).map((s) => s.trim());
    if (parts.length === 2 && parts[0] && parts[1]) return `from ${parts[0]} to ${parts[1]}`;
    return `over ${periodLabel}`;
  }
  return `in ${periodLabel}`;
}

function medianOf(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

/**
 * "Cycle at a glance" — narrative summary mirroring Spend Overview's InsightsPanel
 * pattern: a prose card (lead paragraph + "Where the time goes" + "Worth noting"
 * bullets + closing hint). The KPI cells that used to sit below it were removed
 * (they duplicated the stat grid + anomaly flags directly beneath). Every number
 * is computed client-side from the already-loaded cycle_time analysis + breakdown
 * roster/categories — no new API/Python. Clauses whose data is absent for the
 * selected period/range omit gracefully rather than render placeholders.
 */
export function CycleTimeGlancePanel({
  cycleTime,
  roster,
  categories,
  previousMedian,
  previousLabel,
  periodLabel,
  isRangeMode,
}: {
  cycleTime: CycleTimeResult;
  roster: CycleSupplierRow[];
  categories: CycleCategoryRow[];
  previousMedian: number | null;
  previousLabel: string | null;
  periodLabel: string;
  isRangeMode: boolean;
}) {
  const phrase = periodPhrase(periodLabel, isRangeMode);
  const dist = cycleTime.distribution;
  const median = dist.median;
  const n = dist.n;

  // Stage means → slowest stage + its mean-based share (matches the stat card and
  // the Stage-breakdown insight, so "% of cycle" is consistent page-wide).
  const stageMeans = STAGES.map((s) => ({
    label: s.label,
    mean: cycleTime.stage_breakdown[s.key]?.mean ?? 0,
  }));
  const stageTotal = stageMeans.reduce((s, x) => s + x.mean, 0);
  const slowest = stageMeans.reduce((m, c) => (c.mean > m.mean ? c : m), stageMeans[0]);
  const slowestPct = stageTotal > 0 ? Math.round((slowest.mean / stageTotal) * 100) : 0;
  const prToPoMean = cycleTime.stage_breakdown.pr_to_po?.mean ?? null;
  // "The delay is downstream, not internal" is only true when PR→PO (the internal
  // approval step) is actually a SMALL stage. Derive the direction from live shares
  // rather than assuming it: small = below the average stage share. If PR→PO is a
  // meaningful share we flip the wording; if it IS the slowest stage we self-omit.
  const prToPoPct =
    stageTotal > 0 && prToPoMean != null ? (prToPoMean / stageTotal) * 100 : null;
  const avgStageShare = stageMeans.length > 0 ? 100 / stageMeans.length : 0;
  const prToPoIsSmall = prToPoPct != null && prToPoPct < avgStageShare;
  const prToPoIsSlowest = slowest.label === "PR to PO";

  // YoY trend vs the previous period (single-year mode only; parent passes null in range).
  let trend: { dir: "down" | "up"; pct: number; prev: number } | null = null;
  if (!isRangeMode && previousMedian != null && previousMedian > 0 && median != null) {
    const deltaPct = ((median - previousMedian) / previousMedian) * 100;
    if (Math.abs(deltaPct) >= 0.5) {
      trend = { dir: deltaPct < 0 ? "down" : "up", pct: Math.abs(deltaPct), prev: previousMedian };
    }
  }

  // Within-period stability (Mann-Whitney midpoint split), when the test is computable.
  const cmp = cycleTime.period_comparison;
  const stability =
    cmp && !cmp.insufficient_data && cmp.p_value != null
      ? { p: cmp.p_value, significant: cmp.p_value < 0.05 }
      : null;

  // Slowest Kraljic-matrix quadrant by median cycle (empty quadrants excluded).
  const quads = QUAD_ORDER.map((q) => ({
    q,
    median: cycleTime.cycle_by_quadrant[q]?.median ?? null,
  })).filter((x): x is { q: KraljicQuadrant; median: number } => x.median != null);
  const slowestQuad = quads.length ? quads.reduce((m, c) => (c.median > m.median ? c : m)) : null;

  // Slowest category by mean total cycle.
  const slowestCat = categories.length
    ? [...categories].sort((a, b) => b.total_mean - a.total_mean)[0]
    : null;

  // Outliers (z > 2σ) + the worst cycle among them.
  const outlierRows = cycleTime.anomalies;
  const outliers = outlierRows.length;
  const maxOutlier = outliers ? Math.max(...outlierRows.map((a) => a.cycle_days ?? 0)) : 0;

  // Inconsistent suppliers (IQR > 1.5× portfolio-median IQR) — same rule as the anomaly card.
  const iqrMedian = medianOf(roster.map((r) => r.iqr));
  const iqrCutoff = iqrMedian * 1.5;
  const highIqr = roster.filter((r) => r.iqr > iqrCutoff).length;

  // Weakest 3-way-match quadrant.
  const worstQ = QUAD_ORDER.find((q) => cycleTime.three_way_match_by_quadrant[q]?.is_worst);
  const worstRate = worstQ ? cycleTime.three_way_match_by_quadrant[worstQ].pass_rate_pct : null;

  // Single Invoice→Payment-dominated supplier (a clean exception to the systemic
  // constraint) — only surfaced when exactly one supplier qualifies.
  const invDom = roster.filter((r) => r.slowest_stage === "invoice_to_payment");
  const exception = invDom.length === 1 ? invDom[0] : null;

  const bullets: ReactNode[] = [];
  if (outliers > 0) {
    bullets.push(
      <li key="outliers">
        <strong>{num0.format(outliers)}</strong> PO{outliers === 1 ? "" : "s"} run beyond 2σ
        {maxOutlier > 0 ? (
          <>
            {" "}
            (up to <strong>{num0.format(maxOutlier)}</strong> days)
          </>
        ) : null}{" "}
        — flagged for investigation.
      </li>,
    );
  }
  if (highIqr > 0) {
    bullets.push(
      <li key="iqr">
        <strong>{num0.format(highIqr)}</strong> supplier{highIqr === 1 ? "" : "s"} show high
        cycle-time variability (typical range &gt; 1.5× the portfolio median).
      </li>,
    );
  }
  if (worstQ && worstRate != null) {
    bullets.push(
      <li key="twm">
        <strong>{worstQ}</strong> suppliers have the weakest 3-way-match pass rate at{" "}
        <strong>{worstRate.toFixed(1)}%</strong>.
      </li>,
    );
  }
  if (exception) {
    bullets.push(
      <li key="exc">
        <strong>{exception.supplier_name}</strong> is the exception — Invoice to Payment dominates
        its cycle ({exception.slowest_stage_pct}%).
      </li>,
    );
  }

  return (
    <>
      <Card className={cardElevation}>
        <CardHeader>
          <CardTitle>Cycle at a glance</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4 text-sm leading-relaxed">
          <p>
            Adaro&apos;s procure-to-pay cycle runs a median of{" "}
            <strong>{d2(median)} days</strong> across {num0.format(n)} POs {phrase}.
            {trend && (
              <>
                {" "}
                That&apos;s {trend.dir} <strong>{trend.pct.toFixed(0)}%</strong> from {d2(trend.prev)}{" "}
                days{previousLabel ? ` in ${previousLabel}` : " the prior period"}.
              </>
            )}
            {median != null && dist.p25 != null && dist.p75 != null && (
              <>
                {" "}
                Half of all POs clear within{" "}
                <strong>
                  {d0(dist.p25)}–{d0(dist.p75)} days
                </strong>{" "}
                (typical range {d0(dist.iqr)} days).
              </>
            )}
            {stability && (
              <>
                {" "}
                Cycle time {stability.significant ? "shifted" : "held steady"} across the period
                (Mann-Whitney p = {formatP(stability.p)}).
              </>
            )}{" "}
            This cadence is typical of capital-intensive mining procurement.
          </p>

          {slowest.mean > 0 && (
            <div className="space-y-1">
              <h3 className="font-medium">Where the time goes</h3>
              <p>
                <strong>{slowest.label}</strong> is the binding constraint at{" "}
                <strong>{slowestPct}%</strong> of the cycle
                {prToPoMean != null &&
                  !prToPoIsSlowest &&
                  (prToPoIsSmall ? (
                    <>
                      , while PR to PO approval averages just {d1(prToPoMean)} days — the delay is
                      downstream, not internal
                    </>
                  ) : (
                    <>
                      , with PR to PO approval averaging {d1(prToPoMean)} days — a meaningful share of
                      the delay is internal
                    </>
                  ))}
                .
                {slowestQuad && (
                  <>
                    {" "}
                    Among Kraljic-matrix quadrants, <strong>{slowestQuad.q}</strong> suppliers run
                    slowest (median {d2(slowestQuad.median)} days).
                  </>
                )}
                {slowestCat && (
                  <>
                    {" "}
                    By category, <strong>{slowestCat.category}</strong> carries the longest mean
                    cycle ({d1(slowestCat.total_mean)} days).
                  </>
                )}
              </p>
            </div>
          )}

          {bullets.length > 0 && (
            <div className="space-y-1">
              <h3 className="font-medium">Worth noting</h3>
              <ul className="list-disc space-y-1 pl-5 text-muted-foreground">{bullets}</ul>
            </div>
          )}

          <p className="text-xs italic text-muted-foreground">
            Click any supplier row below for its per-stage drill-down, or use the anomaly cards to
            filter to outlier and stage-dominated POs.
          </p>
        </CardContent>
      </Card>
    </>
  );
}
