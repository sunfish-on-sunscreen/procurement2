"use client";

import { ArrowDown, ArrowUp, ChevronsUpDown } from "lucide-react";

/**
 * Shared cell/header pieces for the Spend Overview + Supplier Classification
 * ranking tables. All colours are theme tokens (light + dark correct).
 */

// --- Performance number + threshold progress bar (decision N) -------------- #
// ≥75 success · 55–74 warning · <55 destructive. 50px track, 4px tall.
export function PerfBar({ score }: { score: number | null }) {
  if (score == null) return <span className="text-muted-foreground">—</span>;
  const color =
    score >= 75 ? "var(--success)" : score >= 55 ? "var(--warning)" : "var(--destructive)";
  const pct = Math.max(0, Math.min(100, score));
  return (
    <div className="flex items-center justify-end gap-2">
      <span className="tabular-nums">{score.toFixed(2)}</span>
      <span
        className="block h-1 w-[50px] shrink-0 overflow-hidden rounded-full"
        style={{ backgroundColor: "color-mix(in srgb, var(--muted-foreground) 20%, transparent)" }}
      >
        <span
          className="block h-full rounded-full"
          style={{ width: `${pct}%`, backgroundColor: color }}
        />
      </span>
    </div>
  );
}

// --- Retired (deactivated master-data) badge -------------------------------- #
// Surfaces Supplier.status !== "active" on the analytics supplier views. ⚠️
// Display-only: it never filters or changes a figure — deactivation is
// analytically neutral by design. Deliberately the word "Retired", NOT "inactive"
// (which already means "no activity in this period" on these tables).
export function RetiredBadge({ className = "" }: { className?: string }) {
  return (
    <span
      title="Deactivated in master data — retired from future ordering. Historical figures are unaffected."
      className={`no-print inline-flex shrink-0 items-center rounded-md px-1.5 py-0.5 text-[10px] font-medium uppercase tracking-wide text-muted-foreground ${className}`}
      style={{ backgroundColor: "color-mix(in srgb, var(--muted-foreground) 12%, transparent)" }}
    >
      Retired
    </span>
  );
}

// --- Sortable column header arrow (decision L) ------------------------------ #
// All sortable columns show a faint up/down glyph; the active column shows a
// prominent directional arrow. (Non-sortable columns don't render this.)
export function SortArrow({
  active,
  dir,
}: {
  active: boolean;
  dir: "asc" | "desc";
}) {
  // Wrapped in `.no-print` so sort affordances don't leak into the report PDF.
  return (
    <span className="no-print inline-flex">
      {!active ? (
        <ChevronsUpDown className="h-3 w-3 opacity-30" />
      ) : dir === "asc" ? (
        <ArrowUp className="h-3 w-3" />
      ) : (
        <ArrowDown className="h-3 w-3" />
      )}
    </span>
  );
}
