"use client";

import { type ReportConfig, type DetailLevel } from "@/lib/report-config";

const FOCUS_LABELS = {
  portfolio: "Portfolio",
  supplier: "Supplier brief",
  category: "Category deep-dive",
} as const;

const LENGTH_LABELS: Record<DetailLevel, string> = {
  brief: "Executive brief",
  standard: "Standard",
  detailed: "Full",
};

const TONE_LABELS = {
  executive: "Executive",
  operational: "Operational",
  analytical: "Analytical",
} as const;

/**
 * Read-only one-line summary of the current report config (focus · length ·
 * voice). Updates live as the sidebar changes.
 */
export function FilterStatusStrip({ config }: { config: ReportConfig }) {
  const parts = [
    FOCUS_LABELS[config.focus.kind],
    LENGTH_LABELS[config.detailLevel],
    `${TONE_LABELS[config.tone]} voice`,
  ];

  return (
    <div className="border-b bg-muted/40 px-3 py-1.5 text-[13px] text-muted-foreground">
      {parts.join(" · ")}
    </div>
  );
}
