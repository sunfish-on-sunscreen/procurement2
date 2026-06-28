"use client";

import { AlertTriangle, ShieldAlert, CheckCircle2, AlertCircle } from "lucide-react";
import type { PerformanceSpendResult } from "@/lib/analysis-types";
import {
  computeSynthesis,
  SYNTHESIS_META,
  SYNTHESIS_ORDER,
  type SynthesisMeta,
} from "@/lib/supplier-classification";
import type { SynthesisKey } from "@/lib/supplier-classification-types";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cardElevation, cn } from "@/lib/utils";

const ICONS: Record<SynthesisKey, React.ComponentType<{ className?: string }>> = {
  strategic_under: AlertTriangle,
  bottleneck_critical: ShieldAlert,
  leverage_workhorse: CheckCircle2,
  routine_risk: AlertCircle,
};

/** "A, B, C and 2 more" — up to `max` names then a remainder count. */
function nameList(names: string[], max = 4): string {
  if (names.length === 0) return "none in this period";
  if (names.length <= max) return names.join(", ");
  return `${names.slice(0, max).join(", ")} …and ${names.length - max} more`;
}

function SynthesisTile({
  meta,
  names,
  count,
  active,
  onSelect,
}: {
  meta: SynthesisMeta;
  names: string[];
  count: number;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = ICONS[meta.key];
  // Empty category (Q): fully muted, non-clickable, explanatory message.
  if (count === 0) {
    return (
      <div
        className="flex cursor-not-allowed flex-col gap-2 rounded-lg border border-l-4 border-l-muted-foreground/30 bg-muted/30 p-4 text-left opacity-50"
        aria-disabled="true"
      >
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">{meta.title}</span>
          <span className="ml-auto text-lg font-semibold tabular-nums text-muted-foreground">(0)</span>
        </div>
        <p className="text-xs text-muted-foreground">
          No suppliers in this category for the selected period.
        </p>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-l-4 p-4 text-left transition-colors",
        meta.theme.border,
        meta.theme.tint,
        active
          ? "ring-2 ring-inset ring-foreground/30"
          : "hover:bg-muted/40",
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className={cn("h-4 w-4 shrink-0", meta.theme.text)} />
        <span className="text-sm font-medium">{meta.title}</span>
        <span className={cn("ml-auto text-lg font-semibold tabular-nums", meta.theme.text)}>
          {count}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">
        {meta.blurb} <span className="text-foreground">{nameList(names)}</span>.
      </p>
      {/* View-suppliers CTA (P). */}
      <span className={cn("mt-auto pt-1 text-xs font-medium", meta.theme.text)}>
        {active ? "Showing in table ↓" : "View suppliers →"}
      </span>
    </button>
  );
}

/**
 * 2×2 grid synthesising Kraljic × performance-median. Each tile is clickable and
 * toggles a table filter (controlled by the parent via activeKey/onSelect).
 */
export function CrossClassificationCard({
  perf,
  activeKey,
  onSelect,
}: {
  perf: PerformanceSpendResult;
  activeKey: SynthesisKey | null;
  onSelect: (key: SynthesisKey | null) => void;
}) {
  const groups = computeSynthesis(perf);

  return (
    <Card className={cardElevation}>
      <CardHeader>
        <CardTitle>Cross-classification insights</CardTitle>
        <p className="text-sm text-muted-foreground">
          Suppliers flagged by combining their Kraljic quadrant with the period
          performance median. Click a card to filter the table below.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {SYNTHESIS_ORDER.map((key) => {
            const meta = SYNTHESIS_META[key];
            const rows = groups[key];
            return (
              <SynthesisTile
                key={key}
                meta={meta}
                names={rows.map((r) => r.supplier_name)}
                count={rows.length}
                active={activeKey === key}
                onSelect={() => onSelect(activeKey === key ? null : key)}
              />
            );
          })}
        </div>
      </CardContent>
    </Card>
  );
}
