"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";
import {
  ReportDocument,
  type ReportAnalyses,
  type ReportMeta,
} from "@/components/Reports/ReportDocument";
import type { ReportMetrics } from "@/lib/report-templates";
import { EPHEMERAL_KEY, type ReportConfig } from "@/lib/report-config";

type EphemeralReport = {
  meta: ReportMeta;
  analyses: ReportAnalyses;
  metrics: ReportMetrics;
  config: ReportConfig;
  supplierCategory: Record<string, string>;
};

export default function ReportPreviewPage() {
  const [report, setReport] = useState<EphemeralReport | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    // Read the in-memory report handed over via sessionStorage on mount. This
    // is a client-only read, so setState-in-effect is intended here.
    try {
      const raw = sessionStorage.getItem(EPHEMERAL_KEY);
      // eslint-disable-next-line react-hooks/set-state-in-effect
      if (raw) setReport(JSON.parse(raw) as EphemeralReport);
    } catch {
      // ignore malformed payloads
    }
    setLoaded(true);
  }, []);

  if (!loaded) return null;

  if (!report) {
    return (
      <div className="flex flex-col items-center gap-4 py-16 text-center">
        <p className="max-w-md text-muted-foreground">
          No range report to preview. Range reports are generated fresh and not
          saved — generate one from the Reports page.
        </p>
        <Link href="/reports" className={buttonVariants()}>
          Go to Reports
        </Link>
      </div>
    );
  }

  return (
    <ReportDocument
      meta={report.meta}
      analyses={report.analyses}
      metrics={report.metrics}
      config={report.config}
      supplierCategory={report.supplierCategory}
    />
  );
}
