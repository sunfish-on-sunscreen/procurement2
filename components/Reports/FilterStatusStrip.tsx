"use client";

import { type ReportConfig, type SectionKey } from "@/lib/report-config";

const SECTION_ORDER: SectionKey[] = [
  "spendOverview",
  "abc",
  "kraljic",
  "performanceSpend",
  "cycleTime",
  "actionDashboard",
  "methodology",
];

const TONE_LABELS = {
  executive: "Executive",
  operational: "Operational",
  analytical: "Analytical",
} as const;

/**
 * Read-only one-line summary of the current report config. Updates live as the
 * sidebar changes.
 */
export function FilterStatusStrip({ config }: { config: ReportConfig }) {
  // Executive Summary is always on; the other 7 are toggleable appendix sections.
  const visibleOptional = SECTION_ORDER.filter((s) => config.sections[s]).length;
  const totalSections = 1 + visibleOptional;
  const hidden = SECTION_ORDER.length - visibleOptional;
  const sectionLabel =
    hidden > 0
      ? `${totalSections} sections (${hidden} hidden)`
      : `${totalSections} sections`;

  const parts = [
    sectionLabel,
    `${TONE_LABELS[config.tone]} tone`,
    `${config.detailLevel[0].toUpperCase()}${config.detailLevel.slice(1)} detail`,
  ];

  return (
    <div className="border-b bg-muted/40 px-3 py-1.5 text-[13px] text-muted-foreground">
      {parts.join(" · ")}
    </div>
  );
}
