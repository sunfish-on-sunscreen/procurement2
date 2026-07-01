"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { CycleTimeResult, RangeAnalyses } from "@/lib/analysis-types";
import type { CycleBreakdown, CycleFilterKey } from "@/lib/cycle-time-types";
import { CycleTimeGlancePanel } from "@/components/CycleTime/CycleTimeGlancePanel";
import { CycleTimeAnomalyCards } from "@/components/CycleTime/CycleTimeAnomalyCards";
import { CycleTimeView, type AnomalyFilter } from "@/components/CycleTimeView";
import {
  CycleSupplierSection,
  type RosterFilter,
} from "@/components/CycleTime/CycleSupplierSection";

const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * Client wrapper that owns the Cycle Time page's interactive coordination: the
 * "Cycle at a glance" panel, the anomaly action cards, and the filter + smooth-
 * scroll plumbing across the Anomalies table (in CycleTimeView) and the supplier
 * roster (in CycleSupplierSection). It holds the cycle_time analysis (server-
 * loaded in cached mode, fetched via compute-range in range mode) and the
 * breakdown roster (fetched once and passed down), so the glance/cards counts
 * and the two child tables all read one consistent dataset.
 */
export function CycleTimeClient({
  startDate,
  endDate,
  periodLabel,
  isRangeMode,
  cachedCycleTime,
  previousMedian,
  previousLabel,
}: {
  startDate: string;
  endDate: string;
  periodLabel: string;
  isRangeMode: boolean;
  cachedCycleTime: CycleTimeResult | null;
  previousMedian: number | null;
  previousLabel: string | null;
}) {
  const key = `${startDate}_${endDate}`;
  const [ctState, setCtState] = useState<{ key: string; data?: CycleTimeResult; err?: string } | null>(null);
  const [bdState, setBdState] = useState<{ key: string; data?: CycleBreakdown; err?: string } | null>(null);
  const [activeFilter, setActiveFilter] = useState<CycleFilterKey | null>(null);

  // Reset the filter on span change (render-time compare; no set-state-in-effect).
  const [prevKey, setPrevKey] = useState(key);
  if (prevKey !== key) {
    setPrevKey(key);
    if (activeFilter !== null) setActiveFilter(null);
  }

  const cycleTime = cachedCycleTime ?? (ctState?.key === key ? ctState.data : undefined);
  const cycleTimeErr = cachedCycleTime ? undefined : ctState?.key === key ? ctState.err : undefined;
  const breakdown = bdState?.key === key ? bdState.data : undefined;
  const breakdownErr = bdState?.key === key ? bdState.err : undefined;

  // Breakdown roster (always fetched client-side, span-scoped).
  useEffect(() => {
    let cancelled = false;
    const k = `${startDate}_${endDate}`;
    fetch(`/api/cycle-time/breakdown?start=${startDate}&end=${endDate}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || "Failed to load breakdown");
        return res.json() as Promise<CycleBreakdown>;
      })
      .then((d) => { if (!cancelled) setBdState({ key: k, data: d }); })
      .catch((e: unknown) => { if (!cancelled) setBdState({ key: k, err: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
  }, [startDate, endDate]);

  // cycle_time analysis — only fetched in range mode (cached mode passes it in).
  useEffect(() => {
    if (cachedCycleTime) return;
    let cancelled = false;
    const k = `${startDate}_${endDate}`;
    fetch("/api/analyses/compute-range", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate }),
    })
      .then(async (res) => {
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || "Compute failed");
        return res.json() as Promise<RangeAnalyses>;
      })
      .then((d) => { if (!cancelled) setCtState({ key: k, data: d.cycle_time ?? undefined }); })
      .catch((e: unknown) => { if (!cancelled) setCtState({ key: k, err: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
  }, [startDate, endDate, cachedCycleTime]);

  // Page-level fatal ONLY when cycle_time itself is unavailable — the glance
  // KPIs + every chart/table come from cycle_time, so they render independently
  // of the breakdown. A breakdown failure degrades only the anomaly cards +
  // roster (inline, non-fatal).
  if (cycleTimeErr) {
    return <p className="py-8 text-sm text-destructive">Failed to load cycle time: {cycleTimeErr}</p>;
  }
  if (!cycleTime) {
    return (
      <div className="flex items-center gap-2 py-16 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading cycle time…
      </div>
    );
  }

  // ---- Anomaly counts + filter wiring (breakdown-dependent) --------------- #
  const slowPos = cycleTime.anomalies.length;
  const iqrMedian = breakdown ? median(breakdown.bySupplier.map((r) => r.iqr)) : 0;
  // "Inconsistent" = IQR beyond 1.5× the portfolio median (Tukey 1.5×IQR
  // convention), so only genuinely high-variability suppliers are flagged
  // rather than the ~half that sit above the bare median.
  const iqrCutoff = iqrMedian * 1.5;
  const highIqr = breakdown ? breakdown.bySupplier.filter((r) => r.iqr > iqrCutoff).length : 0;
  const stageAnomalies = breakdown?.stageAnomalies ?? [];

  const clear = () => setActiveFilter(null);

  const anomalyFilter: AnomalyFilter | null =
    activeFilter === "slow_pos"
      ? { rows: cycleTime.anomalies, label: "Outlier POs (z > 2σ)", onClear: clear }
      : activeFilter === "stage_anomaly"
        ? { rows: stageAnomalies, label: "Stage-dominated POs (one stage > 60% of cycle)", onClear: clear }
        : null;

  const rosterFilter: RosterFilter | null =
    activeFilter === "high_iqr"
      ? { iqrThreshold: iqrCutoff, label: `Inconsistent suppliers (IQR > ${iqrCutoff.toFixed(1)}d)`, onClear: clear }
      : null;

  const handleSelect = (k: CycleFilterKey) => {
    const next = activeFilter === k ? null : k;
    setActiveFilter(next);
    if (next) {
      const id = next === "high_iqr" ? "cycle-roster" : "cycle-anomalies";
      requestAnimationFrame(() => {
        const el = document.getElementById(id);
        if (!el) return;
        const y = el.getBoundingClientRect().top + window.scrollY - 80;
        window.scrollTo({ top: y, behavior: "smooth" });
      });
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <CycleTimeGlancePanel
        cycleTime={cycleTime}
        roster={breakdown?.bySupplier ?? []}
        previousMedian={previousMedian}
        previousLabel={previousLabel}
        periodLabel={periodLabel}
        isRangeMode={isRangeMode}
      />

      {/* Anomaly cards — gated on the breakdown (non-fatal). */}
      {breakdownErr ? (
        <p className="text-sm text-destructive">Couldn&apos;t load anomaly breakdown: {breakdownErr}</p>
      ) : breakdown ? (
        <CycleTimeAnomalyCards
          counts={{ slow_pos: slowPos, high_iqr: highIqr, stage_anomaly: stageAnomalies.length }}
          activeFilter={activeFilter}
          onSelect={handleSelect}
        />
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading anomaly actions…
        </div>
      )}

      <CycleTimeView data={cycleTime} anomalyFilter={anomalyFilter} />

      {/* Supplier roster — gated on the breakdown (non-fatal). */}
      {breakdownErr ? (
        <p className="text-sm text-destructive">Couldn&apos;t load supplier breakdown: {breakdownErr}</p>
      ) : breakdown ? (
        <CycleSupplierSection
          startDate={startDate}
          endDate={endDate}
          data={breakdown}
          rosterFilter={rosterFilter}
        />
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading supplier breakdown…
        </div>
      )}
    </div>
  );
}
