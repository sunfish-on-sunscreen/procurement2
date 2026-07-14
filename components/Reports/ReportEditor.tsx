"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  defaultReportConfig,
  type ReportConfig,
} from "@/lib/report-config";
import type { PeriodSelection } from "@/lib/period-constants";
import {
  buildSupplierDetail,
  type SupplierDirectory,
} from "@/lib/supplier-detail";
import { buttonVariants } from "@/components/ui/button";
import {
  ReportDocument,
  type ReportAnalyses,
} from "@/components/Reports/ReportDocument";
import { ReportEditorSidebar } from "@/components/Reports/ReportEditorSidebar";
import { FilterStatusStrip } from "@/components/Reports/FilterStatusStrip";
import { PinProvider } from "@/components/Reports/PinContext";
import { SupplierDetailPanel } from "@/components/Reports/SupplierDetailPanel";

type PeriodOption = { id: string; name: string };

/**
 * Resolve a period selection to a date span + label. Periods are year-named
 * ("2024"), so a single year is just a one-year range — the editor fetches both
 * modes through /api/analyses/compute-range.
 */
function periodSpan(
  period: PeriodSelection,
  yearById: Map<string, string>,
): { startDate: string; endDate: string; label: string } | null {
  if (period.mode === "single") {
    const y = period.singleId ? yearById.get(period.singleId) : undefined;
    if (!y) return null;
    return { startDate: `${y}-01-01`, endDate: `${y}-12-31`, label: y };
  }
  const yf = period.fromId ? yearById.get(period.fromId) : undefined;
  const yt = period.toId ? yearById.get(period.toId) : undefined;
  if (!yf || !yt) return null;
  const [lo, hi] = Number(yf) <= Number(yt) ? [yf, yt] : [yt, yf];
  return {
    startDate: `${lo}-01-01`,
    endDate: `${hi}-12-31`,
    label: lo === hi ? lo : `${lo}–${hi}`,
  };
}

export function ReportEditor({
  defaultPeriod,
  periods,
  supplierCategory,
  supplierDirectory,
  generatedBy,
}: {
  defaultPeriod: PeriodSelection;
  periods: PeriodOption[];
  supplierCategory: Record<string, string>;
  supplierDirectory: SupplierDirectory;
  generatedBy: string;
}) {
  const router = useRouter();
  const yearById = useMemo(
    () => new Map(periods.map((p) => [p.id, p.name])),
    [periods],
  );

  const [config, setConfig] = useState<ReportConfig>(() =>
    defaultReportConfig(defaultPeriod),
  );
  // Loaded data and errors are tagged with the span key they belong to, so
  // `loading` is derived (no synchronous setState in the effect).
  const [loaded, setLoaded] = useState<{
    key: string;
    analyses: ReportAnalyses;
  } | null>(null);
  const [errored, setErrored] = useState<{ key: string; msg: string } | null>(
    null,
  );
  const [saving, setSaving] = useState(false);
  // Single cross-chart pin (Batch 6b). Lifted here so every chart + the detail
  // panel read from one source. Clears on period change (different data).
  const [pinnedSupplierId, setPinnedSupplierId] = useState<string | null>(null);
  // Settings sidebar open state, lifted (Batch 6c).
  const [sidebarOpen, setSidebarOpen] = useState(false);

  const span = periodSpan(config.period, yearById);
  const startDate = span?.startDate ?? "";
  const endDate = span?.endDate ?? "";
  const label = span?.label ?? "";
  const spanKey = `${startDate}_${endDate}`;
  // Single-year reports send their period id so the report's temporal family is
  // period-aware (that year vs its prior), mirroring the Action Priorities page.
  const selectedPeriodId =
    config.period.mode === "single" ? config.period.singleId : null;

  const analyses = loaded?.key === spanKey ? loaded.analyses : null;
  const error = errored?.key === spanKey ? errored.msg : null;
  const loading = !!startDate && !analyses && !error;

  // Clear the pin whenever the selected period changes — the pinned supplier may
  // not exist (or carry different data) in the new period. Tracking the previous
  // key in state and adjusting during render is React's endorsed alternative to a
  // setState effect (https://react.dev/reference/react/useState#storing-information-from-previous-renders).
  const [prevSpanKey, setPrevSpanKey] = useState(spanKey);
  if (prevSpanKey !== spanKey) {
    setPrevSpanKey(spanKey);
    if (pinnedSupplierId !== null) setPinnedSupplierId(null);
  }

  const pin = useCallback((id: string) => setPinnedSupplierId(id), []);
  const clearPin = useCallback(() => setPinnedSupplierId(null), []);
  const pinValue = useMemo(
    () => ({ pinnedSupplierId, pin, clear: clearPin }),
    [pinnedSupplierId, pin, clearPin],
  );

  // Assemble the pinned supplier's cross-analysis profile from loaded analyses.
  const pinnedDetail = useMemo(() => {
    if (!pinnedSupplierId || !analyses) return null;
    return buildSupplierDetail(
      pinnedSupplierId,
      {
        abc: analyses.abc,
        kraljic: analyses.kraljic,
        performance_spend: analyses.performance_spend,
        cycle_time: analyses.cycle_time,
        recommendations: analyses.recommendations,
      },
      supplierCategory,
      supplierDirectory,
    );
  }, [pinnedSupplierId, analyses, supplierCategory, supplierDirectory]);

  // Escape closes the panel.
  useEffect(() => {
    if (!pinnedSupplierId) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setPinnedSupplierId(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [pinnedSupplierId]);

  // Fetch analyses on PERIOD CHANGE only — startDate/endDate are the deps, so
  // tone/detail/section/filter edits re-render without refetching. Uses the
  // report-specific endpoint (not the dashboard compute-range) so the assembled
  // data carries the anomaly-hub extras (breakdown + temporal) for all 3 families.
  useEffect(() => {
    if (!startDate || !endDate) return;
    const key = `${startDate}_${endDate}`;
    let cancelled = false;
    fetch("/api/reports/analyses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(
        selectedPeriodId
          ? { startDate, endDate, selectedPeriodId }
          : { startDate, endDate },
      ),
    })
      .then(async (res) => {
        if (!res.ok) {
          const e = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(e.error || "Compute failed");
        }
        return res.json() as Promise<ReportAnalyses>;
      })
      .then((data) => {
        if (!cancelled) setLoaded({ key, analyses: data });
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setErrored({
            key,
            msg: err instanceof Error ? err.message : String(err),
          });
      });
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate, selectedPeriodId]);

  const canSave = config.period.mode === "single";

  async function handleSave() {
    if (!canSave) return;
    setSaving(true);
    try {
      const res = await fetch("/api/reports/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ config }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        redirect?: string;
      };
      if (!res.ok || !data.redirect) {
        toast.error(data.error || "Save failed");
        return;
      }
      toast.success("Report saved");
      router.push(data.redirect);
      router.refresh();
    } catch {
      toast.error("Save failed");
    } finally {
      setSaving(false);
    }
  }

  const meta = {
    title: `Report Preview — ${label}`,
    periodLabel: label,
    generatedBy,
    generatedAt: new Date().toISOString(),
    filename: `Report_${label.replace(/[^\w-]+/g, "_")}.pdf`,
    ephemeral: config.period.mode === "range",
  };

  return (
    <div className="flex">
      <ReportEditorSidebar
        config={config}
        onConfigChange={setConfig}
        periods={periods}
        canSave={canSave}
        saving={saving}
        onSave={handleSave}
        pdfFilename={meta.filename}
        open={sidebarOpen}
        onOpenChange={setSidebarOpen}
      />

      <div className="relative min-w-0 flex-1">
        <div className="no-print flex items-center justify-between gap-4 border-b bg-background/95 px-3 py-2">
          <Link
            href="/reports"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            <ArrowLeft className="h-4 w-4" /> Back to Reports
          </Link>
          <span className="truncate text-sm font-medium">{meta.title}</span>
        </div>

        <div className="no-print">
          <FilterStatusStrip config={config} />
        </div>

        <PinProvider value={pinValue}>
          <div className="px-3 py-4">
            {loading ? (
              <div className="flex items-center gap-2 py-16 text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Computing analyses for {label}…
              </div>
            ) : error ? (
              <p className="py-16 text-center text-sm text-destructive">
                Failed to compute analyses: {error}
              </p>
            ) : analyses ? (
              <ReportDocument
                key={spanKey}
                meta={meta}
                analyses={analyses}
                config={config}
                embedded
              />
            ) : null}
          </div>

          <div className="no-print">
            <SupplierDetailPanel detail={pinnedDetail} onClose={clearPin} />
          </div>
        </PinProvider>
      </div>
    </div>
  );
}
