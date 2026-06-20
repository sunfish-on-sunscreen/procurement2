"use client";

import {
  type ReportConfig,
  type SectionKey,
  ALL_TIERS,
} from "@/lib/report-config";

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
 * sidebar changes. `totalCategories` is needed to distinguish "All N" from a
 * partial selection (config alone doesn't carry the universe size).
 */
export function FilterStatusStrip({
  config,
  totalCategories,
}: {
  config: ReportConfig;
  totalCategories: number;
}) {
  const tiers = config.filters.tiers;
  const tierLabel =
    tiers.length >= ALL_TIERS.length
      ? "All tiers"
      : tiers.length === 0
        ? "No tiers"
        : tiers.length === 1
          ? `${tiers[0]} tier only`
          : `${tiers.join(", ")} tiers`;

  const catN = config.filters.categories.length;
  const catLabel =
    catN >= totalCategories
      ? `All ${totalCategories} categories`
      : `${catN} categor${catN === 1 ? "y" : "ies"}`;

  // Executive Summary is always on; the other 7 are toggleable.
  const visibleOptional = SECTION_ORDER.filter((s) => config.sections[s]).length;
  const totalSections = 1 + visibleOptional;
  const hidden = SECTION_ORDER.length - visibleOptional;
  const sectionLabel =
    hidden > 0
      ? `${totalSections} sections (${hidden} hidden)`
      : `${totalSections} sections`;

  const parts = [
    tierLabel,
    catLabel,
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
