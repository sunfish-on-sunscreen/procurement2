"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import type { ClassificationPageData, SynthesisKey } from "@/lib/supplier-classification-types";
import { computeSynthesis, SYNTHESIS_META } from "@/lib/supplier-classification";
import { ClassificationInsightsPanel } from "./ClassificationInsightsPanel";
import { CrossClassificationCard } from "./CrossClassificationCard";
import { ClassificationTabs } from "./ClassificationTabs";
import { SupplierClassificationTable } from "./SupplierClassificationTable";
import { SupplierClassificationDetailPanel } from "./SupplierClassificationDetailPanel";

/**
 * Client wrapper for the Supplier Classification page. Fetches the combined
 * Kraljic + performance data for the span, owns the supplier drill-down and the
 * cross-classification table filter. Mirrors SpendOverviewClient.
 */
export function SupplierClassificationClient({
  startDate,
  endDate,
  periodLabel,
  isRangeMode,
}: {
  startDate: string;
  endDate: string;
  periodLabel: string;
  isRangeMode: boolean;
}) {
  const spanKey = `${startDate}_${endDate}`;
  const [loaded, setLoaded] = useState<{ key: string; data: ClassificationPageData } | null>(null);
  const [errored, setErrored] = useState<{ key: string; msg: string } | null>(null);
  const [selectedSupplierId, setSelectedSupplierId] = useState<string | null>(null);
  const [activeSynthesis, setActiveSynthesis] = useState<SynthesisKey | null>(null);
  const tableRef = useRef<HTMLDivElement>(null);

  // Apply the cross-classification filter, then scroll the (now-filtered) table
  // into view with a small offset so it isn't flush to the viewport top.
  const handleSynthesisSelect = (key: SynthesisKey | null) => {
    setActiveSynthesis(key);
    if (key === null) return;
    requestAnimationFrame(() => {
      const el = tableRef.current;
      if (!el) return;
      const y = el.getBoundingClientRect().top + window.scrollY - 80;
      window.scrollTo({ top: y, behavior: "smooth" });
    });
  };

  const data = loaded?.key === spanKey ? loaded.data : null;
  const error = errored?.key === spanKey ? errored.msg : null;

  // Reset transient selection/filter when the span changes.
  const [prevSpanKey, setPrevSpanKey] = useState(spanKey);
  if (prevSpanKey !== spanKey) {
    setPrevSpanKey(spanKey);
    if (selectedSupplierId !== null) setSelectedSupplierId(null);
    if (activeSynthesis !== null) setActiveSynthesis(null);
  }

  useEffect(() => {
    const key = `${startDate}_${endDate}`;
    let cancelled = false;
    fetch("/api/supplier-classification", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const e = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(e.error || "Failed to load");
        }
        return res.json() as Promise<ClassificationPageData>;
      })
      .then((d) => {
        if (!cancelled) setLoaded({ key, data: d });
      })
      .catch((e: unknown) => {
        if (!cancelled) setErrored({ key, msg: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate]);

  // Synthesis-filtered ranking (when a cross-classification card is selected).
  const filteredRanking = useMemo(() => {
    if (!data) return [];
    if (!activeSynthesis) return data.ranking;
    const groups = computeSynthesis(data.performance_spend);
    const ids = new Set(groups[activeSynthesis].map((s) => s.supplier_id));
    return data.ranking.filter((r) => ids.has(r.supplier_id));
  }, [data, activeSynthesis]);

  if (error) {
    return <p className="py-16 text-center text-sm text-destructive">{error}</p>;
  }
  if (!data) {
    return (
      <div className="flex items-center gap-2 py-16 text-muted-foreground">
        <Loader2 className="h-4 w-4 animate-spin" /> Loading supplier classification…
      </div>
    );
  }

  return (
    <>
      <ClassificationInsightsPanel
        kraljic={data.kraljic}
        perf={data.performance_spend}
        abc={data.abc}
        previous={data.previous}
        periodLabel={periodLabel}
        isRangeMode={isRangeMode}
      />

      <CrossClassificationCard
        perf={data.performance_spend}
        selectedSupplierId={selectedSupplierId}
        onSupplierClick={setSelectedSupplierId}
        activeKey={activeSynthesis}
        onSelect={handleSynthesisSelect}
      />

      <ClassificationTabs
        kraljic={data.kraljic}
        perf={data.performance_spend}
        onSupplierClick={setSelectedSupplierId}
      />

      <div ref={tableRef} className="scroll-mt-20">
        <SupplierClassificationTable
          rows={filteredRanking}
          onSupplierClick={setSelectedSupplierId}
          selectedSupplierId={selectedSupplierId}
          filterLabel={activeSynthesis ? SYNTHESIS_META[activeSynthesis].title : null}
          onClearFilter={() => setActiveSynthesis(null)}
        />
      </div>

      <SupplierClassificationDetailPanel
        supplierId={selectedSupplierId}
        startDate={startDate}
        endDate={endDate}
        kraljic={data.kraljic}
        perf={data.performance_spend}
        onClose={() => setSelectedSupplierId(null)}
        onSupplierClick={setSelectedSupplierId}
      />
    </>
  );
}
