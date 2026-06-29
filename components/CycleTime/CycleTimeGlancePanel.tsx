"use client";

import { ArrowDown, ArrowUp } from "lucide-react";
import type { CycleTimeResult } from "@/lib/analysis-types";
import type { CycleSupplierRow } from "@/lib/cycle-time-types";
import { cardElevation } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

const STAGES = [
  { key: "pr_to_po", label: "PR → PO" },
  { key: "po_to_delivery", label: "PO → Delivery" },
  { key: "delivery_to_invoice", label: "Delivery → Invoice" },
  { key: "invoice_to_payment", label: "Invoice → Payment" },
] as const;

/** "2024–2026" (range) / "2025" (single). */
function periodPhrase(periodLabel: string, isRangeMode: boolean): string {
  if (!periodLabel) return "this period";
  if (isRangeMode) {
    const parts = periodLabel.split(/[–-]/).map((s) => s.trim());
    if (parts.length === 2 && parts[0] && parts[1]) return `${parts[0]}–${parts[1]}`;
  }
  return periodLabel;
}

/** Mini KPI card — same pattern as Classification at a glance. */
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
 * "Cycle at a glance" — data-driven replacement for the old generic intro
 * paragraph. KPI grid (median / outliers / slowest stage) + period-aware
 * observation segments + a destructive-tint outlier callout. Computed
 * client-side from the already-loaded cycle_time analysis + breakdown roster.
 */
export function CycleTimeGlancePanel({
  cycleTime,
  roster,
  previousMedian,
  previousLabel,
  periodLabel,
  isRangeMode,
}: {
  cycleTime: CycleTimeResult;
  roster: CycleSupplierRow[];
  previousMedian: number | null;
  previousLabel: string | null;
  periodLabel: string;
  isRangeMode: boolean;
}) {
  const phrase = periodPhrase(periodLabel, isRangeMode);
  const median = cycleTime.distribution.median;
  const outliers = cycleTime.anomalies.length;

  // Slowest stage by median + its share of the summed stage medians.
  const stageMedians = STAGES.map((s) => ({
    label: s.label,
    median: cycleTime.stage_breakdown[s.key]?.median ?? 0,
  }));
  const stageTotal = stageMedians.reduce((s, x) => s + x.median, 0);
  const slowest = stageMedians.reduce((m, c) => (c.median > m.median ? c : m), stageMedians[0]);
  const slowestPct = stageTotal > 0 ? Math.round((slowest.median / stageTotal) * 100) : 0;

  // Suppliers consistently above the 60-day threshold.
  const overThreshold = roster.filter((r) => r.median_cycle > 60).length;

  // Trend vs the previous period (single-year mode only).
  let trend: { dir: "up" | "down"; pct: number } | null = null;
  if (!isRangeMode && previousMedian != null && previousMedian > 0 && median != null) {
    const deltaPct = ((median - previousMedian) / previousMedian) * 100;
    if (Math.abs(deltaPct) >= 0.5) {
      trend = { dir: deltaPct < 0 ? "down" : "up", pct: Math.abs(deltaPct) };
    }
  }

  return (
    <Card className={cardElevation}>
      <CardHeader>
        <CardTitle>Cycle at a glance</CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {/* 1. KPI grid */}
        <div className="grid grid-cols-3 gap-2">
          <KpiCell
            label="Median cycle time"
            value={median != null ? median.toFixed(2) : "—"}
            sub={`days · ${phrase}`}
          />
          <KpiCell
            label="Outlier POs"
            value={String(outliers)}
            sub="z-score > 2σ"
          />
          <KpiCell
            label="Slowest stage"
            value={slowest.median > 0 ? slowest.label : "—"}
            sub={slowest.median > 0 ? `${slowestPct}% of total time` : "no data"}
          />
        </div>

        {/* 2. Observation segments */}
        <div className="text-sm text-muted-foreground">
          {trend && (
            <span className="inline-flex items-center">
              {trend.dir === "down" ? (
                <ArrowDown className="mr-0.5 h-3.5 w-3.5 text-green-600 dark:text-green-500" />
              ) : (
                <ArrowUp className="mr-0.5 h-3.5 w-3.5 text-red-600 dark:text-red-500" />
              )}
              Cycle {trend.dir === "down" ? "decreased" : "increased"}{" "}
              <span className="font-medium text-foreground tabular-nums">{trend.pct.toFixed(0)}%</span>{" "}
              vs {previousLabel}
              {(overThreshold > 0 || slowest.median > 0) && <span className="text-muted-foreground/40"> · </span>}
            </span>
          )}
          {overThreshold > 0 && (
            <span>
              <span className="font-medium text-foreground tabular-nums">{overThreshold}</span>{" "}
              supplier{overThreshold === 1 ? "" : "s"} exceed the 60-day threshold
              {slowest.median > 0 && <span className="text-muted-foreground/40"> · </span>}
            </span>
          )}
          {slowest.median > 0 && (
            <span>
              <span className="text-foreground">{slowest.label}</span> accounts for{" "}
              <span className="font-medium text-foreground tabular-nums">{slowestPct}%</span> of total cycle time
            </span>
          )}
        </div>

        {/* 3. Outlier callout */}
        {outliers > 0 && (
          <div
            className="rounded-lg border px-3 py-2.5 text-sm"
            style={{
              backgroundColor: "color-mix(in srgb, var(--destructive) 8%, transparent)",
              borderColor: "color-mix(in srgb, var(--destructive) 35%, transparent)",
            }}
          >
            <span className="font-semibold tabular-nums">{outliers}</span> PO
            {outliers === 1 ? "" : "s"} flagged as outliers — warrant investigation.
          </div>
        )}
      </CardContent>
    </Card>
  );
}
