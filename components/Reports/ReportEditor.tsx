"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { ArrowLeft, Loader2 } from "lucide-react";
import { toast } from "sonner";
import {
  defaultReportConfig,
  type ReportConfig,
} from "@/lib/report-config";
import type { PeriodSelection } from "@/lib/period-constants";
import type { RangeAnalyses } from "@/lib/analysis-types";
import { buttonVariants } from "@/components/ui/button";
import {
  ReportDocument,
  type ReportAnalyses,
} from "@/components/Reports/ReportDocument";
import { ReportEditorSidebar } from "@/components/Reports/ReportEditorSidebar";
import { FilterStatusStrip } from "@/components/Reports/FilterStatusStrip";

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
  allCategories,
  supplierCategory,
  generatedBy,
}: {
  defaultPeriod: PeriodSelection;
  periods: PeriodOption[];
  allCategories: string[];
  supplierCategory: Record<string, string>;
  generatedBy: string;
}) {
  const router = useRouter();
  const yearById = useMemo(
    () => new Map(periods.map((p) => [p.id, p.name])),
    [periods],
  );

  const [config, setConfig] = useState<ReportConfig>(() =>
    defaultReportConfig(defaultPeriod, allCategories),
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

  const span = periodSpan(config.period, yearById);
  const startDate = span?.startDate ?? "";
  const endDate = span?.endDate ?? "";
  const label = span?.label ?? "";
  const spanKey = `${startDate}_${endDate}`;

  const analyses = loaded?.key === spanKey ? loaded.analyses : null;
  const error = errored?.key === spanKey ? errored.msg : null;
  const loading = !!startDate && !analyses && !error;

  // Fetch analyses on PERIOD CHANGE only — startDate/endDate are the deps, so
  // tone/detail/section/filter edits re-render without refetching.
  useEffect(() => {
    if (!startDate || !endDate) return;
    const key = `${startDate}_${endDate}`;
    let cancelled = false;
    fetch("/api/analyses/compute-range", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ startDate, endDate }),
    })
      .then(async (res) => {
        if (!res.ok) {
          const e = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(e.error || "Compute failed");
        }
        return res.json() as Promise<RangeAnalyses>;
      })
      .then((data) => {
        if (!cancelled)
          setLoaded({ key, analyses: data as unknown as ReportAnalyses });
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
  }, [startDate, endDate]);

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
        allCategories={allCategories}
        canSave={canSave}
        saving={saving}
        onSave={handleSave}
        pdfFilename={meta.filename}
      />

      <div className="min-w-0 flex-1">
        <div className="no-print flex items-center justify-between gap-4 border-b bg-background/95 px-3 py-2">
          <Link
            href="/reports"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            <ArrowLeft className="h-4 w-4" /> Back to Reports
          </Link>
          <span className="truncate text-sm font-medium">{meta.title}</span>
        </div>

        <FilterStatusStrip config={config} totalCategories={allCategories.length} />

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
              meta={meta}
              analyses={analyses}
              config={config}
              supplierCategory={supplierCategory}
              embedded
            />
          ) : null}
        </div>
      </div>
    </div>
  );
}
