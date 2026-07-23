"use client";

import { Timer, Activity, Layers } from "lucide-react";
import { type CycleFlagKey, FLAG_TOOLTIP } from "@/lib/cycle-time-types";
import { cardElevation, cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type CardMeta = {
  key: CycleFlagKey;
  title: string;
  color: string; // semantic CSS token — colours the icon
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
};

// Muted/neutral cards: identity carried by a COLOURED icon + label (the flag's
// token colours the icon itself — the same colour used for this flag in the
// roster chips and on Action Priorities). No separate dot; the icon carries it.
const CARDS: CardMeta[] = [
  { key: "has_outlier", title: "Has outlier POs", color: "var(--warning)", icon: Timer },
  { key: "inconsistent", title: "Inconsistent", color: "var(--primary)", icon: Activity },
  { key: "has_stage_dom", title: "Has stage-dominated POs", color: "var(--destructive)", icon: Layers },
];

const plural = (n: number) => (n === 1 ? "" : "s");

/** Per-flag description — PO-level context beneath the distinct-supplier count. */
function descFor(key: CycleFlagKey, poCounts: Partial<Record<CycleFlagKey, number>>): string {
  if (key === "has_outlier") {
    const p = poCounts.has_outlier ?? 0;
    return `${p} PO${plural(p)} furthest above the window average`;
  }
  if (key === "inconsistent") {
    return "Typical range > 1.5× the portfolio median";
  }
  const p = poCounts.has_stage_dom ?? 0;
  return `${p} stage-dominated PO${plural(p)} · one stage > 60%`;
}

function AnomalyCard({
  meta,
  count,
  desc,
  active,
  onSelect,
}: {
  meta: CardMeta;
  count: number;
  desc: string;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = meta.icon;
  // Empty flag → muted, non-clickable.
  if (count === 0) {
    return (
      <div
        title={FLAG_TOOLTIP[meta.key]}
        className="flex cursor-not-allowed flex-col gap-2 rounded-lg border bg-muted/20 p-4 text-left opacity-50"
        aria-disabled="true"
      >
        <div className="flex items-center gap-2">
          <Icon className="size-[18px] shrink-0 text-muted-foreground" />
          <span className="text-sm font-medium text-muted-foreground">{meta.title}</span>
          <span className="ml-auto text-lg font-semibold tabular-nums text-muted-foreground">0</span>
        </div>
        <p className="text-xs text-muted-foreground">None in this period.</p>
      </div>
    );
  }
  return (
    <button
      type="button"
      onClick={onSelect}
      aria-pressed={active}
      title={FLAG_TOOLTIP[meta.key]}
      className={cn(
        "flex flex-col gap-2 rounded-lg border bg-muted/30 p-4 text-left transition-colors",
        active ? "ring-2 ring-inset ring-foreground/40" : "hover:bg-muted/50",
      )}
    >
      <div className="flex items-center gap-2">
        <Icon className="size-[18px] shrink-0" style={{ color: meta.color }} />
        <span className="text-sm font-medium">{meta.title}</span>
        <span className="ml-auto text-lg font-semibold tabular-nums">{count}</span>
      </div>
      <p className="text-xs text-muted-foreground">{desc}</p>
      <span className="mt-auto pt-1 text-xs font-medium text-muted-foreground">
        {active ? "Filtering roster ↓" : "Filter roster →"}
      </span>
    </button>
  );
}

/**
 * Three supplier-level anomaly flags. Each card's number is a DISTINCT-SUPPLIER
 * count; the PO-level count sits in the description. Clicking a card sets the
 * single active roster filter (shared with the roster's filter chips), so the
 * card + chip stay in sync. Clicking the active card again clears it.
 */
export function CycleTimeAnomalyCards({
  counts,
  poCounts,
  activeFlag,
  onSelect,
}: {
  counts: Record<CycleFlagKey, number>;
  poCounts: Partial<Record<CycleFlagKey, number>>;
  activeFlag: CycleFlagKey | null;
  onSelect: (key: CycleFlagKey) => void;
}) {
  return (
    <Card className={cardElevation}>
      <CardHeader>
        <CardTitle>Anomalies</CardTitle>
        <p className="text-sm text-muted-foreground">
          Suppliers tripping each anomaly. Click one to filter the roster below.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {CARDS.map((meta) => (
            <AnomalyCard
              key={meta.key}
              meta={meta}
              count={counts[meta.key]}
              desc={descFor(meta.key, poCounts)}
              active={activeFlag === meta.key}
              onSelect={() => onSelect(meta.key)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
