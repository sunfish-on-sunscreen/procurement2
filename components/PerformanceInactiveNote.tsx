"use client";

import type { SupplierEvolution } from "@/lib/spend-overview-types";
import { ABC_COLORS, QUADRANT_COLORS } from "@/lib/chart-colors";

// Inline classification chip — color-mix tint + token text; null → muted "—".
function Chip({ color, label }: { color: string | null; label: string }) {
  if (!color) {
    return <span className="text-muted-foreground">{label}</span>;
  }
  return (
    <span
      className="inline-flex items-center rounded-md px-1.5 py-0.5 text-xs font-medium"
      style={{ backgroundColor: `color-mix(in srgb, ${color} 12%, transparent)`, color }}
    >
      {label}
    </span>
  );
}

/**
 * Contextual note shown above the performance trajectory when a supplier is
 * inactive in the selected period but has prior activity (Fix 5). Summarises the
 * most recent active year so the (already-fetched) all-years trajectory below
 * reads with context. Returns null when there is no prior activity (the caller
 * shows "No data for this period." instead).
 */
export function PerformanceInactiveNote({
  periodLabel,
  periods,
}: {
  periodLabel: string;
  periods: SupplierEvolution["periods"];
}) {
  const active = periods.filter((p) => p.spend > 0 || p.invoiceCount > 0);
  if (active.length === 0) return null;
  const last = active.reduce((a, b) => (b.year > a.year ? b : a));

  return (
    <div className="mb-3 rounded-lg border bg-muted/40 px-3 py-2.5 text-sm text-muted-foreground">
      Inactive in <span className="font-medium text-foreground">{periodLabel}</span>. Most recent
      activity: <span className="font-medium text-foreground">{last.year}</span> — score{" "}
      <span className="font-medium text-foreground tabular-nums">
        {last.performanceScore != null ? last.performanceScore.toFixed(2) : "—"}
      </span>
      , ABC{" "}
      <Chip color={last.abcClass ? ABC_COLORS[last.abcClass] : null} label={last.abcClass ?? "—"} />
      , Kraljic{" "}
      <Chip
        color={last.kraljicQuadrant ? QUADRANT_COLORS[last.kraljicQuadrant] : null}
        label={last.kraljicQuadrant ?? "—"}
      />
      .
    </div>
  );
}
