"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { CycleTimeResult, RangeAnalyses } from "@/lib/analysis-types";
import type { CycleBreakdown, CycleFlagKey } from "@/lib/cycle-time-types";
import { CycleTimeGlancePanel } from "@/components/CycleTime/CycleTimeGlancePanel";
import { CycleStatGrid } from "@/components/CycleTime/CycleStatGrid";
import { CycleTimeAnomalyCards } from "@/components/CycleTime/CycleTimeAnomalyCards";
import { CycleTimeView } from "@/components/CycleTimeView";
import { CycleSupplierSection } from "@/components/CycleTime/CycleSupplierSection";
import { StageBreakdownSection } from "@/components/CycleTime/StageBreakdownSection";
import { deriveCycleFlags } from "@/lib/cycle-flags";

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
  const [activeFlag, setActiveFlag] = useState<CycleFlagKey | null>(null);
  // Selected supplier for the drill-down panel — lifted here so BOTH the roster
  // rows and the box-plot outlier dots open the same panel.
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);

  // Reset the filter + drill-down on span change (render-time compare; no set-state-in-effect).
  const [prevKey, setPrevKey] = useState(key);
  if (prevKey !== key) {
    setPrevKey(key);
    if (activeFlag !== null) setActiveFlag(null);
    if (selectedSupplierId !== null) setSelectedSupplierId(null);
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

  // ---- Supplier-level flag derivation (breakdown-dependent) --------------- #
  // Derived CLIENT-SIDE from already-fetched data via the SHARED helper
  // (lib/cycle-flags) so the Action Priorities cross-page section computes the
  // exact same flags. The same flagsBySupplier map drives the cards, the roster
  // chips/column, and the roster filter, so a card's count always equals the
  // number of rows its filter shows.
  const roster = breakdown?.bySupplier ?? [];
  const stageAnomalies = breakdown?.stageAnomalies ?? [];
  const { flagsBySupplier, flagCounts, flagPoCounts, iqrCutoff } = deriveCycleFlags({
    roster,
    anomalies: cycleTime.anomalies,
    stageAnomalies,
  });

  // Portfolio cycle context for the drill-down panel's stat comparison: the
  // population median/typical-range (cycle_time.distribution) + every supplier's
  // median (roster) for percentile ranking. Display-derived, no new compute.
  const portfolio = {
    median: cycleTime.distribution.median,
    p25: cycleTime.distribution.p25,
    p75: cycleTime.distribution.p75,
    supplierMedians: roster.map((r) => r.median_cycle),
    // Flag threshold (1.5 × median supplier IQR) → the consistency chart's band
    // half-width, so out-of-band crossings agree with the Inconsistent flag.
    // Already null-guarded on an empty roster by deriveCycleFlags.
    iqrCutoff,
  };

  // Single active flag drives cards + chips (shared state). Cards scroll to the
  // roster; chips (already at the roster) don't. Clicking the active one clears.
  const setFlag = (k: CycleFlagKey | null, opts?: { scroll?: boolean }) => {
    const next = k === null ? null : activeFlag === k ? null : k;
    setActiveFlag(next);
    if (next && opts?.scroll) {
      requestAnimationFrame(() => {
        const el = document.getElementById("cycle-roster");
        if (!el) return;
        window.scrollTo({ top: el.getBoundingClientRect().top + window.scrollY - 80, behavior: "smooth" });
      });
    }
  };
  const handleCardSelect = (k: CycleFlagKey) => setFlag(k, { scroll: true });
  const handleChipSelect = (k: CycleFlagKey | null) => setFlag(k);

  return (
    <div className="flex flex-col gap-6">
      <CycleTimeGlancePanel
        cycleTime={cycleTime}
        roster={breakdown?.bySupplier ?? []}
        categories={breakdown?.byCategory ?? []}
        previousMedian={previousMedian}
        previousLabel={previousLabel}
        periodLabel={periodLabel}
        isRangeMode={isRangeMode}
        paymentTermsSplit={breakdown?.paymentTermsSplit}
      />

      {/* Stat grid (Change 4: sits above the anomaly flags; 5th "Slowest stage" card). */}
      <CycleStatGrid data={cycleTime} includeSlowest />

      {/* Anomaly cards — gated on the breakdown (non-fatal). */}
      {breakdownErr ? (
        <p className="text-sm text-destructive">Couldn&apos;t load anomaly breakdown: {breakdownErr}</p>
      ) : breakdown ? (
        <CycleTimeAnomalyCards
          counts={flagCounts}
          poCounts={flagPoCounts}
          activeFlag={activeFlag}
          onSelect={handleCardSelect}
        />
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading anomaly actions…
        </div>
      )}

      <CycleTimeView
        data={cycleTime}
        showAnomaliesTable={false}
        showMonthlyTrend={false}
        showStatGrid={false}
        showStageDecomposition={false}
        showDistributionInsight
        showMethodBreakdown
        controlExposure={breakdown?.controlExposure}
        onOutlierClick={setSelectedSupplierId}
      />

      {/* Merged "Stage breakdown" (dashboard-only): pipeline chart + decomposition
          table + stage insight + category bars. */}
      <StageBreakdownSection
        startDate={startDate}
        endDate={endDate}
        cycleTime={cycleTime}
        categories={breakdown?.byCategory ?? []}
      />

      {/* Supplier roster — gated on the breakdown (non-fatal). */}
      {breakdownErr ? (
        <p className="text-sm text-destructive">Couldn&apos;t load supplier breakdown: {breakdownErr}</p>
      ) : breakdown ? (
        <CycleSupplierSection
          startDate={startDate}
          endDate={endDate}
          data={breakdown}
          flagsBySupplier={flagsBySupplier}
          flagCounts={flagCounts}
          activeFlag={activeFlag}
          onSelectFlag={handleChipSelect}
          selectedSupplierId={selectedSupplierId}
          onSupplierClick={setSelectedSupplierId}
          portfolio={portfolio}
        />
      ) : (
        <div className="flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading supplier breakdown…
        </div>
      )}
    </div>
  );
}
