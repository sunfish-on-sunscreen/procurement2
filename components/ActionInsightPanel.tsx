"use client";

import Link from "next/link";
import { X } from "lucide-react";
import type { InsightModel } from "@/lib/action-insights";
import { StatBlock } from "@/components/ui/stat-block";
import { cn } from "@/lib/utils";

const alignClass = (a?: "left" | "right" | "center") =>
  a === "right" ? "text-right" : a === "center" ? "text-center" : "text-left";

/**
 * Renders one "View more →" insight panel in place: lead sentence → 3 stat cells →
 * the full-set evidence table (rows open the supplier modal) → a "Why this matters"
 * cross-analysis callout → an optional footer link. Presentation only; the model is
 * computed by lib/action-insights. `accent` is the category/family token (colours
 * the header rule + title, matching the card the panel opened from).
 */
export function ActionInsightPanel({
  model,
  accent,
  onSupplier,
  onClose,
}: {
  model: InsightModel;
  accent?: string;
  onSupplier?: (id: string) => void;
  onClose: () => void;
}) {
  return (
    <div
      className="mt-3 rounded-lg border bg-card/40 p-4"
      style={accent ? { borderTopColor: accent, borderTopWidth: 2 } : undefined}
    >
      <div className="flex items-start justify-between gap-3">
        <div>
          <h4 className="text-sm font-semibold" style={accent ? { color: accent } : undefined}>
            {model.title}
          </h4>
          <p className="mt-1 max-w-3xl text-sm text-foreground/90">{model.lead}</p>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close panel"
          className="shrink-0 rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <X className="size-4" />
        </button>
      </div>

      {model.stats.length > 0 && (
        <div className="mt-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
          {model.stats.map((s, i) => (
            <StatBlock key={i} size="compact" label={s.label} value={s.value} sublabel={s.sub} />
          ))}
        </div>
      )}

      {model.table && (
        <div className="mt-3 overflow-x-auto">
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
        <div className="mt-3 rounded-md border-l-2 border-l-primary bg-muted/40 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Why this matters
          </p>
          <p className="mt-1 max-w-3xl text-sm text-foreground/90">{model.why}</p>
        </div>
      )}

      {model.footer && (
        <div className="mt-3 text-right">
          <Link
            href={model.footer.href}
            className="text-xs font-medium text-primary hover:underline"
          >
            {model.footer.label} →
          </Link>
        </div>
      )}
    </div>
  );
}
