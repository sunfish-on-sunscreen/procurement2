"use client";

import { Timer, Activity, TriangleAlert } from "lucide-react";
import type { CycleFilterKey } from "@/lib/cycle-time-types";
import { cardElevation, cn } from "@/lib/utils";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";

type CardMeta = {
  key: CycleFilterKey;
  title: string;
  color: string; // semantic CSS token
  icon: React.ComponentType<{ className?: string; style?: React.CSSProperties }>;
  desc: string;
  cta: string;
};

// Theme-aware semantic tokens (warning / info / destructive) — light + dark
// safe; tints via color-mix so the cards adapt in dark mode.
const CARDS: CardMeta[] = [
  {
    key: "slow_pos",
    title: "Outlier POs",
    color: "var(--warning)",
    icon: Timer,
    desc: "POs significantly slower than the typical cycle (z > 2σ).",
    cta: "View outlier POs",
  },
  {
    key: "high_iqr",
    title: "Inconsistent suppliers",
    color: "var(--primary)",
    icon: Activity,
    desc: "Suppliers with significantly higher cycle time variability than the portfolio (IQR > 1.5× median).",
    cta: "View suppliers",
  },
  {
    key: "stage_anomaly",
    title: "Stage-dominated POs",
    color: "var(--destructive)",
    icon: TriangleAlert,
    desc: "POs where a single stage takes over 60% of the total cycle.",
    cta: "View stage-dominated POs",
  },
];

function AnomalyCard({
  meta,
  count,
  active,
  onSelect,
}: {
  meta: CardMeta;
  count: number;
  active: boolean;
  onSelect: () => void;
}) {
  const Icon = meta.icon;
  // Empty bucket → muted, non-clickable.
  if (count === 0) {
    return (
      <div
        className="flex cursor-not-allowed flex-col gap-2 rounded-lg border border-l-4 border-l-muted-foreground/30 bg-muted/30 p-4 text-left opacity-50"
        aria-disabled="true"
      >
        <div className="flex items-center gap-2">
          <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />
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
      className={cn(
        "flex flex-col gap-2 rounded-lg border border-l-4 p-4 text-left transition-colors",
        active ? "ring-2 ring-inset ring-foreground/30" : "hover:bg-muted/40",
      )}
      style={{
        borderLeftColor: meta.color,
        backgroundColor: `color-mix(in srgb, ${meta.color} 6%, transparent)`,
      }}
    >
      <div className="flex items-center gap-2">
        <Icon className="h-4 w-4 shrink-0" style={{ color: meta.color }} />
        <span className="text-sm font-medium">{meta.title}</span>
        <span className="ml-auto text-lg font-semibold tabular-nums" style={{ color: meta.color }}>
          {count}
        </span>
      </div>
      <p className="text-xs text-muted-foreground">{meta.desc}</p>
      <span className="mt-auto pt-1 text-xs font-medium" style={{ color: meta.color }}>
        {active ? "Showing ↓" : `${meta.cta} →`}
      </span>
    </button>
  );
}

/**
 * Three anomaly action cards (mirrors Cross-classification insights): Outlier POs,
 * Inconsistent suppliers, Stage-dominated POs. Clicking a card filters + smooth-
 * scrolls to the relevant table (handled by the parent CycleTimeClient).
 */
export function CycleTimeAnomalyCards({
  counts,
  activeFilter,
  onSelect,
}: {
  counts: Record<CycleFilterKey, number>;
  activeFilter: CycleFilterKey | null;
  onSelect: (key: CycleFilterKey) => void;
}) {
  return (
    <Card className={cardElevation}>
      <CardHeader>
        <CardTitle>Anomaly actions</CardTitle>
        <p className="text-sm text-muted-foreground">
          Click a card to filter and jump to the affected table.
        </p>
      </CardHeader>
      <CardContent>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {CARDS.map((meta) => (
            <AnomalyCard
              key={meta.key}
              meta={meta}
              count={counts[meta.key]}
              active={activeFilter === meta.key}
              onSelect={() => onSelect(meta.key)}
            />
          ))}
        </div>
      </CardContent>
    </Card>
  );
}
