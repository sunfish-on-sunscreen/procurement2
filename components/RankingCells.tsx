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
  if (!active) {
    return <ChevronsUpDown className="h-3 w-3 opacity-30" />;
  }
  return dir === "asc" ? (
    <ArrowUp className="h-3 w-3" />
  ) : (
    <ArrowDown className="h-3 w-3" />
  );
}
