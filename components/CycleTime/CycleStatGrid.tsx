"use client";

import type { CycleTimeResult } from "@/lib/analysis-types";
import { StatBlock } from "@/components/ui/stat-block";
import { Sparkline } from "@/components/charts/Sparkline";

const STAGES = [
  { key: "pr_to_po", label: "PR → PO" },
  { key: "po_to_delivery", label: "PO → Delivery" },
  { key: "delivery_to_invoice", label: "Delivery → Invoice" },
  { key: "invoice_to_payment", label: "Invoice → Payment" },
] as const;

const d0 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(0));
const d1 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(1));
const d2 = (v: number | null | undefined) => (v == null ? "—" : v.toFixed(2));

/**
 * Cycle-time distribution stat cards. Shared so the dashboard and reports render
 * one visual language. `includeSlowest` adds a 5th "Slowest stage" card (dashboard
 * only) — it self-omits when no stage medians are available. Without it the grid
 * is the original 4-card layout, byte-identical for the report path.
 */
export function CycleStatGrid({
  data,
  embedded = false,
  includeSlowest = false,
}: {
  data: CycleTimeResult;
  embedded?: boolean;
  includeSlowest?: boolean;
}) {
  const d = data.distribution;

  // Slowest stage by mean + its mean-based share (stage mean ÷ Σ stage means) so
  // "% of total time" is consistent with the Stage-breakdown insight
  // (PO → Delivery = 49%), wired to real data.
  const stageMeans = STAGES.map((s) => ({
    label: s.label,
    mean: data.stage_breakdown[s.key]?.mean ?? 0,
  }));
  const stageTotal = stageMeans.reduce((s, x) => s + x.mean, 0);
  const slowest = stageMeans.reduce((m, c) => (c.mean > m.mean ? c : m), stageMeans[0]);
  const slowestPct = stageTotal > 0 ? Math.round((slowest.mean / stageTotal) * 100) : 0;
  const showSlowest = includeSlowest && slowest.mean > 0;

  const cols = showSlowest ? "sm:grid-cols-3 lg:grid-cols-5" : "lg:grid-cols-4";

  return (
    <div className={`grid grid-cols-2 gap-4 ${cols}`}>
      <StatBlock
        size="comfortable"
        label="Median cycle time"
        value={
          embedded ? (
            <span className="flex items-end justify-between gap-2">
              {`${d2(d.median)} days`}
              <span className="text-primary">
                <Sparkline data={data.monthly_trend.map((m) => m.median_cycle_days)} />
              </span>
            </span>
          ) : (
            `${d2(d.median)} days`
          )
        }
      />
      <StatBlock
        size="comfortable"
        label="Typical range"
        value={`${d0(d.p25)}–${d0(d.p75)} d`}
        sublabel={`spread ${d0(d.iqr)} d`}
      />
      <StatBlock size="comfortable" label="Average cycle time" value={`${d1(d.mean)} d`} />
      <StatBlock size="comfortable" label="Range" value={`${d0(d.min)}–${d0(d.max)} d`} />
      {showSlowest && (
        <StatBlock
          size="comfortable"
          label="Slowest stage"
          value={slowest.label}
          sublabel={`${slowestPct}% of total time`}
        />
      )}
    </div>
  );
}
