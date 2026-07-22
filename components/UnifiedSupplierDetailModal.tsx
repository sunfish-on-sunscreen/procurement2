"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { SpendDetail, SupplierEvolution } from "@/lib/spend-overview-types";
import type {
  KraljicResult,
  PerformanceSpendResult,
  CycleTimeResult,
} from "@/lib/analysis-types";
import type {
  CycleSupplierDetail,
  CycleBreakdown,
  CyclePortfolioContext,
} from "@/lib/cycle-time-types";
import { panelElevation } from "@/lib/utils";
import { periodSpanLabel } from "@/lib/panel-format";
import { Button } from "@/components/ui/button";
import { CountryFlag } from "@/components/CountryFlag";
import { RetiredBadge } from "@/components/RankingCells";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { PillTabs } from "@/components/PillTabs";
import { ClassificationDetailBody } from "@/components/SupplierClassification/SupplierClassificationDetailPanel";
import { SpendDetailBody } from "@/components/SpendOverview/SpendDecompositionPanel";
import { ProcessDetailBody } from "@/components/CycleTime/CycleTimeSupplierDetailPanel";

type Tab = "classification" | "spend" | "process";

// Same population-median helper CycleTimeClient uses for the Inconsistent cutoff.
const median = (xs: number[]) => {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
};

/**
 * ONE centered modal on Action Priorities that stacks all three per-supplier
 * analyses behind top-level tabs (Classification / Spend / Process), reusing the
 * bodies extracted from the three page panels. Shared identity header; the
 * spend-detail + evolution fetch is done ONCE and fed to both the Classification
 * and Spend bodies (no double fetch); the Process tab lazily fetches the
 * cycle-time breakdown roster + per-supplier detail on first open and derives the
 * full roster context (iqrCutoff / inconsistent / portfolio / stage-dominated POs)
 * exactly as CycleTimeClient + CycleSupplierSection do.
 */
export function UnifiedSupplierDetailModal({
  supplierId,
  startDate,
  endDate,
  kraljic,
  perf,
  cycleTime,
  onClose,
  onSupplierClick,
  initialTab = "classification",
}: {
  supplierId: string | null;
  startDate: string;
  endDate: string;
  kraljic: KraljicResult | null;
  perf: PerformanceSpendResult;
  cycleTime: CycleTimeResult | null;
  onClose: () => void;
  onSupplierClick: (id: string) => void;
  /** Which tab opens first. Defaults to Classification (all existing callers);
   *  the Anomaly-exposure rows pass "process" to land on the cycle detail. */
  initialTab?: Tab;
}) {
  const [tab, setTab] = useState<Tab>(initialTab);
  // Process is fetched only after its tab is first opened (seeded true when the
  // modal is asked to open directly on Process).
  const [processOpened, setProcessOpened] = useState(initialTab === "process");

  // Reset the tab + lazy Process flag whenever the supplier OR span changes
  // (render-time compare — no set-state-in-effect). Resets to whichever tab the
  // opener requested, so re-opening on Process re-lands on Process.
  const resetKey = `${supplierId}_${startDate}_${endDate}`;
  const [prevReset, setPrevReset] = useState(resetKey);
  if (prevReset !== resetKey) {
    setPrevReset(resetKey);
    setTab(initialTab);
    setProcessOpened(initialTab === "process");
  }

  const openTab = (t: Tab) => {
    setTab(t);
    if (t === "process") setProcessOpened(true);
  };

  // ---- shared spend-detail + evolution (Classification + Spend + header) ---- #
  const detailKey = supplierId ? `${supplierId}_${startDate}_${endDate}` : "";
  const [detailState, setDetailState] = useState<{ key: string; detail?: SpendDetail; err?: string } | null>(null);
  const [evoState, setEvoState] = useState<{ id: string; data?: SupplierEvolution; err?: string } | null>(null);

  const detail = detailState?.key === detailKey ? detailState.detail : undefined;
  const detailErr = detailState?.key === detailKey ? detailState.err : undefined;
  const detailLoading = !!supplierId && !detail && !detailErr;
  const evoData = evoState?.id === supplierId ? evoState.data : undefined;
  const evoErr = evoState?.id === supplierId ? evoState.err : undefined;

  useEffect(() => {
    if (!supplierId) return;
    const key = `${supplierId}_${startDate}_${endDate}`;
    let cancelled = false;
    const qs = startDate && endDate ? `?start=${startDate}&end=${endDate}` : "";
    fetch(`/api/suppliers/${supplierId}/spend-detail${qs}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || "Failed to load");
        return res.json() as Promise<SpendDetail>;
      })
      .then((d) => { if (!cancelled) setDetailState({ key, detail: d }); })
      .catch((e: unknown) => { if (!cancelled) setDetailState({ key, err: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
  }, [supplierId, startDate, endDate]);

  useEffect(() => {
    if (!supplierId) return;
    const sid = supplierId;
    let cancelled = false;
    fetch(`/api/suppliers/${sid}/evolution`)
      .then(async (res) => {
        if (!res.ok) throw new Error("Failed to load evolution");
        return res.json() as Promise<SupplierEvolution>;
      })
      .then((d) => { if (!cancelled) setEvoState({ id: sid, data: d }); })
      .catch((e: unknown) => { if (!cancelled) setEvoState({ id: sid, err: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
  }, [supplierId]);

  // ---- Process (lazy): breakdown roster + per-supplier cycle detail --------- #
  const [bdState, setBdState] = useState<{ key: string; data?: CycleBreakdown; err?: string } | null>(null);
  const [cycState, setCycState] = useState<{ key: string; data?: CycleSupplierDetail; err?: string } | null>(null);

  useEffect(() => {
    if (!processOpened) return;
    const k = `${startDate}_${endDate}`;
    let cancelled = false;
    fetch(`/api/cycle-time/breakdown?start=${startDate}&end=${endDate}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || "Failed to load breakdown");
        return res.json() as Promise<CycleBreakdown>;
      })
      .then((d) => { if (!cancelled) setBdState({ key: k, data: d }); })
      .catch((e: unknown) => { if (!cancelled) setBdState({ key: k, err: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
  }, [processOpened, startDate, endDate]);

  useEffect(() => {
    if (!processOpened || !supplierId) return;
    const k = `${supplierId}_${startDate}_${endDate}`;
    let cancelled = false;
    fetch(`/api/cycle-time/supplier-detail?supplierId=${supplierId}&start=${startDate}&end=${endDate}`)
      .then(async (res) => {
        if (!res.ok) throw new Error(((await res.json().catch(() => ({}))) as { error?: string }).error || "Failed to load");
        return res.json() as Promise<CycleSupplierDetail>;
      })
      .then((d) => { if (!cancelled) setCycState({ key: k, data: d }); })
      .catch((e: unknown) => { if (!cancelled) setCycState({ key: k, err: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
  }, [processOpened, supplierId, startDate, endDate]);

  // Roster-derived Process context (mirrors CycleTimeClient + CycleSupplierSection).
  const bdKey = `${startDate}_${endDate}`;
  const breakdown = bdState?.key === bdKey ? bdState.data : undefined;
  const roster = breakdown?.bySupplier ?? [];
  const iqrCutoff = roster.length ? median(roster.map((r) => r.iqr)) * 1.5 : 0;
  const stageDominatedPoIds = new Set((breakdown?.stageAnomalies ?? []).map((a) => a.po_id));
  const myRow = supplierId ? roster.find((r) => r.supplier_id === supplierId) : undefined;
  const inconsistent = myRow ? myRow.iqr > iqrCutoff : false;
  const portfolio: CyclePortfolioContext | undefined = cycleTime
    ? {
        median: cycleTime.distribution.median,
        p25: cycleTime.distribution.p25,
        p75: cycleTime.distribution.p75,
        supplierMedians: roster.map((r) => r.median_cycle),
        iqrCutoff: roster.length ? iqrCutoff : null,
      }
    : undefined;

  const cycKey = supplierId ? `${supplierId}_${startDate}_${endDate}` : "";
  const cycData = cycState?.key === cycKey ? cycState.data : undefined;
  const cycErr = cycState?.key === cycKey ? cycState.err : undefined;
  const cycLoading = processOpened && !!supplierId && !cycData && !cycErr;

  // Shared identity header, sourced from spend-detail (same fields the Spend panel uses).
  const s = detail?.supplier;
  const span = periodSpanLabel(startDate, endDate);

  return (
    <Dialog open={!!supplierId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        aria-label="Supplier detail"
        className={`flex max-h-[85vh] w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[680px] ${panelElevation}`}
      >
        <header className="flex items-start justify-between gap-2 border-b p-4">
          <div className="min-w-0">
            <div className="flex items-center gap-2">
              <DialogTitle className="truncate font-heading text-base font-medium leading-snug">
                {s?.name ?? "Loading…"}
              </DialogTitle>
              {s?.retired && <RetiredBadge />}
            </div>
            {s && (
              <p className="truncate text-xs text-muted-foreground">
                {(() => {
                  const parts = [s.category, s.abcClass, s.kraljicQuadrant, s.zone].filter(Boolean);
                  if (parts.length === 0 && !s.country) return s.id;
                  return (
                    <>
                      {parts.join(" · ")}
                      {s.country && (
                        <>
                          {parts.length > 0 ? " · " : ""}
                          {s.country}
                          <CountryFlag code={s.country} />
                        </>
                      )}
                    </>
                  );
                })()}
              </p>
            )}
            <p className="mt-0.5 text-[11px] text-muted-foreground" title={span.full}>
              Showing {span.short}
            </p>
          </div>
          <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Close" onClick={onClose}>
            <X className="h-4 w-4" />
          </Button>
        </header>

        {/* Top-level analysis tabs. */}
        <div className="border-b px-4 pt-3 pb-2">
          <PillTabs
            tabs={[["classification", "Classification"], ["spend", "Spend"], ["process", "Process"]] as const}
            active={tab}
            onChange={openTab}
          />
        </div>

        {tab === "classification" && (
          <ClassificationDetailBody
            supplierId={supplierId}
            startDate={startDate}
            endDate={endDate}
            kraljic={kraljic}
            perf={perf}
            onSupplierClick={onSupplierClick}
            detail={detail}
            detailErr={detailErr}
            detailLoading={detailLoading}
            evo={evoData}
          />
        )}
        {tab === "spend" && (
          <SpendDetailBody
            supplierId={supplierId}
            startDate={startDate}
            endDate={endDate}
            detail={detail}
            detailErr={detailErr}
            detailLoading={detailLoading}
            evo={evoData}
            evoErr={evoErr}
          />
        )}
        {tab === "process" && (
          <ProcessDetailBody
            supplierId={supplierId}
            data={cycData}
            dataErr={cycErr}
            dataLoading={cycLoading}
            stageDominatedPoIds={stageDominatedPoIds}
            inconsistent={inconsistent}
            portfolio={portfolio}
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
