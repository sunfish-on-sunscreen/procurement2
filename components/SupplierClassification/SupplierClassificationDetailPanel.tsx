"use client";

import { useEffect, useState } from "react";
import { X, Loader2 } from "lucide-react";
import type { SpendDetail, SupplierEvolution } from "@/lib/spend-overview-types";
import { ABC_COLORS, QUADRANT_COLORS } from "@/lib/chart-colors";
import { panelElevation } from "@/lib/utils";
import { periodSpanLabel } from "@/lib/panel-format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { PerformanceScoreCard } from "@/components/PerformanceScoreCard";
import { PerformanceTrajectory } from "@/components/PerformanceTrajectory";
import { ActivityBar } from "@/components/ActivityBar";

const usd0 = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// Classification chip — color-mix tint + token text; null → muted placeholder.
function Chip({ color, label }: { color: string | null; label: string }) {
  if (!color) {
    return (
      <span className="inline-flex items-center rounded-md bg-muted px-2 py-0.5 text-xs font-medium text-muted-foreground">
        {label}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`, color }}
    >
      {label}
    </span>
  );
}

// ---- Panel ----------------------------------------------------------------- #
export function SupplierClassificationDetailPanel({
  supplierId,
  startDate,
  endDate,
  onClose,
}: {
  supplierId: string | null;
  startDate: string;
  endDate: string;
  onClose: () => void;
}) {
  const detailKey = supplierId ? `${supplierId}_${startDate}_${endDate}` : "";
  const [detailState, setDetailState] = useState<{ key: string; detail?: SpendDetail; err?: string } | null>(null);
  const [evo, setEvo] = useState<{ id: string; data?: SupplierEvolution; err?: string } | null>(null);
  const [perfOpen, setPerfOpen] = useState(false);
  const [everExpanded, setEverExpanded] = useState(false);

  const detail = detailState?.key === detailKey ? detailState.detail : undefined;
  const detailErr = detailState?.key === detailKey ? detailState.err : undefined;
  const detailLoading = !!supplierId && !detail && !detailErr;

  const [prevId, setPrevId] = useState(supplierId);
  if (prevId !== supplierId) {
    setPrevId(supplierId);
    setPerfOpen(false);
    setEverExpanded(false);
  }
  const span = periodSpanLabel(startDate, endDate);

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
      .then((d) => { if (!cancelled) setEvo({ id: sid, data: d }); })
      .catch((e: unknown) => { if (!cancelled) setEvo({ id: sid, err: e instanceof Error ? e.message : String(e) }); });
    return () => { cancelled = true; };
  }, [supplierId]);

  const evoData = evo?.id === supplierId ? evo.data : undefined;

  const s = detail?.supplier;
  const st = detail?.stats;
  const absent = st != null && st.poCount === 0;

  return (
    <Dialog open={!!supplierId} onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        aria-label="Supplier classification detail"
        className={`flex max-h-[85vh] w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[680px] ${panelElevation}`}
      >
        <header className="flex items-start justify-between gap-2 border-b p-4">
          <div className="min-w-0">
            <DialogTitle className="truncate font-heading text-base font-medium leading-snug">{s?.name ?? "Loading…"}</DialogTitle>
            {s && (
              <p className="truncate text-xs text-muted-foreground">
                {[s.category, s.tier, s.country].filter(Boolean).join(" · ") || s.id}
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

        {detailLoading && (
          <div className="flex items-center gap-2 p-4 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading detail…
          </div>
        )}
        {detailErr && <p className="p-4 text-sm text-destructive">{detailErr}</p>}

        {detail && st && s && (
          <>
            {/* Section 1 (emphasized): Performance & classification.
                Click the performance score to expand the trajectory. */}
            <div className="border-b p-4">
              <h4 className="mb-2 text-sm font-medium text-muted-foreground">Performance &amp; classification</h4>
              {/* auto 1fr: score left, chips stacked vertically on the right (B). */}
              <div className="grid grid-cols-[auto_1fr] items-start gap-4">
                <PerformanceScoreCard
                  perf={s.performance}
                  open={perfOpen}
                  onToggle={() => { setPerfOpen((o) => !o); setEverExpanded(true); }}
                  showHint={!perfOpen && !everExpanded}
                />
                <div className="flex flex-col items-start gap-2 pt-1">
                  <Chip color={s.abcClass ? ABC_COLORS[s.abcClass] : null} label={s.abcClass ? `Class ${s.abcClass}` : "Class —"} />
                  <Chip color={s.kraljicQuadrant ? QUADRANT_COLORS[s.kraljicQuadrant] : null} label={s.kraljicQuadrant ?? "—"} />
                </div>
              </div>
              {perfOpen && (
                <div className="mt-4 border-t pt-3">
                  {s.performance.score == null ? (
                    <p className="text-xs text-muted-foreground">No data for this period.</p>
                  ) : evo?.err ? (
                    <p className="text-sm text-destructive">{evo.err}</p>
                  ) : evoData ? (
                    <PerformanceTrajectory data={evoData} historyLayout="timeline" />
                  ) : (
                    <div className="flex items-center gap-2 text-sm text-muted-foreground">
                      <Loader2 className="h-4 w-4 animate-spin" /> Loading trajectory…
                    </div>
                  )}
                </div>
              )}
            </div>

            {/* Section 2 (secondary): Spend context — compact single line (E). */}
            <div className="border-b p-4">
              <h4 className="mb-2 text-sm font-medium text-muted-foreground">Spend context</h4>
              {absent ? (
                <p className="text-sm text-muted-foreground">No spend in this period.</p>
              ) : (
                <p className="text-sm text-muted-foreground">
                  <span className="font-medium text-foreground">{usd0.format(st.totalSpend)}</span> across{" "}
                  <span className="font-medium text-foreground">{st.poCount}</span> invoice{st.poCount === 1 ? "" : "s"} ·{" "}
                  avg <span className="font-medium text-foreground">{usd0.format(st.avgPoValue)}</span>
                </p>
              )}
            </div>

            {/* Section 3: Activity — visual bar (F). */}
            <div className="p-4">
              <h4 className="mb-2 text-sm font-medium text-muted-foreground">Activity</h4>
              <ActivityBar
                earliest={absent ? null : st.earliestDate}
                latest={absent ? null : st.latestDate}
                periodStart={startDate}
                periodEnd={endDate}
                descriptor={`within ${span.short}`}
              />
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
