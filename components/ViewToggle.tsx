"use client";

import { BarChart3, Table as TableIcon } from "lucide-react";

/** Chart ⇄ table view state, shared by the convertible panels. */
export type View = "chart" | "table";

/**
 * The single-button Table⇄Chart view switcher used by the Spend Overview and
 * Process Health supplier detail cards. Extracted so both cards share one control
 * (same look + behaviour). Right-aligned, flips `view` on click.
 */
export function ViewToggle({ view, setView }: { view: View; setView: (v: View) => void }) {
  return (
    <div className="mb-2 flex justify-end">
      <button
        type="button"
        onClick={() => setView(view === "chart" ? "table" : "chart")}
        className="inline-flex items-center gap-1 rounded-md border px-2 py-1 text-xs text-muted-foreground hover:bg-muted"
      >
        {view === "chart" ? <TableIcon className="h-3.5 w-3.5" /> : <BarChart3 className="h-3.5 w-3.5" />}
        {view === "chart" ? "View as table" : "View as chart"}
      </button>
    </div>
  );
}
