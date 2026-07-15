"use client";

import type * as React from "react";
import Link from "next/link";
import { DollarSign, Settings, TriangleAlert, Users, X } from "lucide-react";
import { buildInsight, type InsightKey, type InsightCtx, type InsightModel } from "@/lib/action-insights";
import { panelElevation, cn } from "@/lib/utils";
import { periodSpanLabel } from "@/lib/panel-format";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { PillTabs } from "@/components/PillTabs";
import { StatBlock } from "@/components/ui/stat-block";

// --------------------------------------------------------------------------- //
// Group → tabs config. This is the SINGLE SOURCE OF TRUTH for which insight keys
// belong to which floating card; the group of an open tab is DERIVED from it.
// --------------------------------------------------------------------------- //
type InsightGroupId = "spend" | "suppliers" | "process" | "anomalies";

type InsightGroupDef = {
  id: InsightGroupId;
  title: string;
  tagline: string;
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  accent: string;
  tabs: readonly { key: InsightKey; label: string }[];
};

export const INSIGHT_GROUPS = [
  {
    id: "spend",
    title: "From your Spend analysis",
    tagline: "Where the money is exposed",
    icon: DollarSign,
    accent: "var(--priority-steward)",
    tabs: [
      { key: "concentration", label: "Concentration" },
      { key: "critical_spend", label: "Critical Spend" },
      { key: "tail_spend", label: "Tail Spend" },
    ],
  },
  {
    id: "suppliers",
    title: "From your Supplier analysis",
    tagline: "Who needs attention",
    icon: Users,
    accent: "var(--priority-engage)",
    tabs: [
      { key: "critical_issues_engagement", label: "Critical Issues" },
      { key: "hidden_gems_promotion", label: "Hidden Gems" },
      { key: "bottleneck_risk", label: "Bottleneck Risk" },
    ],
  },
  {
    id: "process",
    title: "From your Process analysis",
    tagline: "Where the workflow leaks",
    icon: Settings,
    accent: "var(--priority-improve)",
    tabs: [
      { key: "process_improvement", label: "Process Improvement" },
      { key: "slow_stage", label: "Slowest Stage" },
    ],
  },
  {
    id: "anomalies",
    title: "Cross-analysis anomalies",
    tagline: "Where the analyses disagree",
    icon: TriangleAlert,
    accent: "var(--warning)",
    tabs: [
      { key: "process", label: "Process" },
      { key: "classification", label: "Lens disagreement" },
      { key: "temporal", label: "Changed over time" },
    ],
  },
] as const satisfies readonly InsightGroupDef[];

// ⚠️ Compile-time totality guard: every InsightKey must belong to exactly one
// group. If a key is added to InsightKey but not to a group's tabs (or vice
// versa), one of these assignments fails to type-check.
type AllTabKeys = (typeof INSIGHT_GROUPS)[number]["tabs"][number]["key"];
type _KeysCoverGroups = AllTabKeys extends InsightKey ? true : never;
type _GroupsCoverKeys = InsightKey extends AllTabKeys ? true : never;
const _exhaustiveKeys: _KeysCoverGroups = true;
const _exhaustiveGroups: _GroupsCoverKeys = true;
void _exhaustiveKeys;
void _exhaustiveGroups;

/** Total map key → group (built from the single source of truth). */
const GROUP_OF_KEY = Object.fromEntries(
  INSIGHT_GROUPS.flatMap((g) => g.tabs.map((t) => [t.key, g])),
) as Record<InsightKey, (typeof INSIGHT_GROUPS)[number]>;

/** The group a key belongs to — total by construction. */
export function groupOfInsightKey(key: InsightKey): (typeof INSIGHT_GROUPS)[number] {
  return GROUP_OF_KEY[key];
}

/** First tab of a group — used by the per-group "View more →". */
export function firstTabOfGroup(id: InsightGroupId): InsightKey {
  return INSIGHT_GROUPS.find((g) => g.id === id)!.tabs[0].key;
}

// --------------------------------------------------------------------------- //
// rendering
// --------------------------------------------------------------------------- //
const alignClass = (a?: "left" | "right" | "center") =>
  a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";

function InsightBody({ model, onSupplier }: { model: InsightModel; onSupplier?: (id: string) => void }) {
  return (
    <div className="flex flex-col gap-3 p-4">
      <p className="text-sm text-foreground/90">{model.lead}</p>

      {model.stats.length > 0 && (
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {model.stats.map((s, i) => (
            <StatBlock key={i} size="compact" label={s.label} value={s.value} sublabel={s.sub} />
          ))}
        </div>
      )}

      {model.table && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-xs text-muted-foreground">
                {model.table.columns.map((c, i) => (
                  <th key={i} className={cn("py-1.5 pr-3 font-medium", alignClass(c.align))}>
                    {c.label}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {model.table.rows.map((r, ri) => {
                const clickable = !!r.supplierId && !!onSupplier;
                return (
                  <tr
                    key={ri}
                    onClick={clickable ? () => onSupplier!(r.supplierId!) : undefined}
                    className={cn(
                      "border-b border-border/50 last:border-0",
                      clickable && "cursor-pointer hover:bg-muted/50",
                      r.muted && "opacity-55",
                    )}
                    style={
                      r.emphasis
                        ? { backgroundColor: "color-mix(in srgb, var(--warning) 8%, transparent)" }
                        : undefined
                    }
                  >
                    {r.cells.map((cell, ci) => (
                      <td
                        key={ci}
                        className={cn(
                          "py-1.5 pr-3 tabular-nums",
                          alignClass(model.table!.columns[ci]?.align),
                          ci === 0 && "font-medium text-foreground",
                        )}
                      >
                        {cell}
                      </td>
                    ))}
                  </tr>
                );
              })}
            </tbody>
          </table>
          {model.table.caption && (
            <p className="mt-1.5 text-xs text-muted-foreground">{model.table.caption}</p>
          )}
        </div>
      )}

      {model.why && (
        <div className="rounded-md border-l-2 border-l-primary bg-muted/40 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Why this matters
          </p>
          <p className="mt-1 text-sm text-foreground/90">{model.why}</p>
        </div>
      )}
    </div>
  );
}

function tabLabel(name: string, count?: number): React.ReactNode {
  return (
    <span className="inline-flex items-center gap-1.5">
      {name}
      {count != null && (
        <span className="rounded-full bg-foreground/10 px-1.5 py-0.5 text-[11px] font-medium tabular-nums leading-none">
          {count}
        </span>
      )}
    </span>
  );
}

/**
 * Tabbed floating card — the "View more →" drill-down, one per group. Matches
 * UnifiedSupplierDetailModal's design language (base-ui Dialog + DialogContent +
 * PillTabs + panelElevation, same header/tabs/footer shapes) so it reads as the
 * same component family. Content is the insight model from lib/action-insights;
 * this component is only the CONTAINER.
 *
 * State: `openKey` is the active tab; the group is derived from it. Switching tabs
 * calls `onTab` (no close). Table rows call `onSupplier` — the parent closes this
 * card first, then opens the supplier modal (no stacked dialogs).
 */
export function ActionInsightCard({
  openKey,
  ctx,
  tabCounts,
  startDate,
  endDate,
  onTab,
  onClose,
  onSupplier,
}: {
  openKey: InsightKey | null;
  ctx: InsightCtx;
  tabCounts: Partial<Record<InsightKey, number>>;
  startDate: string;
  endDate: string;
  onTab: (key: InsightKey) => void;
  onClose: () => void;
  onSupplier?: (id: string) => void;
}) {
  const group = openKey ? groupOfInsightKey(openKey) : null;
  const model = openKey ? buildInsight(openKey, ctx) : null;
  // Anomalies: drop family tabs that open to nothing (e.g. a partial-year
  // temporal). Where-to-act tabs always render.
  const tabs = group
    ? group.tabs.filter((t) => group.id !== "anomalies" || (tabCounts[t.key] ?? 0) > 0)
    : [];
  const span = periodSpanLabel(startDate, endDate);
  const Icon = group?.icon;

  return (
    <Dialog open={openKey != null} onOpenChange={(o) => { if (!o) onClose(); }}>
      <DialogContent
        showCloseButton={false}
        aria-label="Insight detail"
        className={cn(
          "flex max-h-[85vh] w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[680px]",
          panelElevation,
        )}
      >
        {group && Icon && (
          <>
            <header className="flex items-start justify-between gap-2 border-b p-4">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <Icon className="size-[18px] shrink-0" style={{ color: group.accent }} />
                  <DialogTitle className="truncate font-heading text-base font-medium leading-snug">
                    {group.title}
                  </DialogTitle>
                </div>
                <p className="mt-0.5 truncate text-xs text-muted-foreground" title={span.full}>
                  {group.tagline} · {span.short}
                </p>
              </div>
              <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Close" onClick={onClose}>
                <X className="h-4 w-4" />
              </Button>
            </header>

            <div className="border-b px-4 pt-3 pb-2">
              <PillTabs
                tabs={tabs.map((t) => [t.key, tabLabel(t.label, tabCounts[t.key])] as const)}
                active={openKey!}
                onChange={onTab}
              />
            </div>

            {model ? (
              <InsightBody model={model} onSupplier={onSupplier} />
            ) : (
              <p className="p-4 text-sm text-muted-foreground">No detail available for this period.</p>
            )}

            <div className="mt-auto flex items-center justify-between gap-3 border-t bg-muted/50 px-4 py-3">
              {model?.footer ? (
                <Link href={model.footer.href} className="text-xs font-medium text-primary hover:underline">
                  {model.footer.label} →
                </Link>
              ) : (
                <span />
              )}
              <span className="text-xs text-muted-foreground">Esc to close</span>
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
