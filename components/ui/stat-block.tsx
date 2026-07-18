import * as React from "react"

import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"

/**
 * A single label + value statistic in a Card container, so every stat callout
 * across the app shares one visual language (ring + radius from `Card`). Replaces
 * the previously divergent KPI cards, ABC class boxes, and panel header stats.
 *
 * `accent` draws a subtle left border in a semantic colour (theme tokens defined
 * in globals.css).
 *
 * Density tiers (`size`):
 *   - `compact`     — tight padding/value, for sub-score and mini stats
 *   - `default`     — most uses (detail-panel sections, secondary stats)
 *   - `comfortable` — prominent padding/value, for top-of-page KPIs
 *   - `lg`          — backwards-compatible alias of `comfortable`
 * All variants are additive: untouched callers pass no `size` and render as
 * `default`, exactly as before.
 */
const ACCENT_COLORS: Record<string, string | undefined> = {
  default: undefined,
  primary: "var(--primary)",
  destructive: "var(--destructive)",
  warning: "var(--warning)",
  success: "var(--success)",
}

export type StatBlockSize = "compact" | "default" | "comfortable" | "lg"

export type StatBlockProps = {
  label: string
  value: React.ReactNode
  sublabel?: React.ReactNode
  accent?: "default" | "primary" | "destructive" | "warning" | "success"
  size?: StatBlockSize
  className?: string
}

const PADDING: Record<StatBlockSize, string> = {
  compact: "gap-0.5 px-2.5 py-2",
  default: "gap-0.5 px-3.5 py-3",
  comfortable: "gap-1 px-5 py-5",
  lg: "gap-1 px-5 py-5",
}

const VALUE_SIZE: Record<StatBlockSize, string> = {
  compact: "text-xl",
  default: "text-2xl",
  comfortable: "text-3xl",
  lg: "text-3xl",
}

export function StatBlock({
  label,
  value,
  sublabel,
  accent = "default",
  size = "default",
  className,
}: StatBlockProps) {
  const accentColor = ACCENT_COLORS[accent]
  return (
    <Card
      data-size={size === "compact" ? "sm" : "default"}
      // Explicit padding — `Card` only sets py, so without this the content is
      // flush to the horizontal edges. Density tier picks the padding + value
      // size.
      className={cn(PADDING[size], className)}
      style={
        accentColor
          ? { borderLeft: `4px solid ${accentColor}` }
          : undefined
      }
    >
      <div className={cn("text-muted-foreground", size === "compact" ? "text-xs" : "text-sm")}>
        {label}
      </div>
      <div
        className={cn(
          "font-semibold leading-tight tracking-tight tabular-nums",
          VALUE_SIZE[size],
        )}
      >
        {value}
      </div>
      {sublabel != null && (
        <div className="text-xs text-muted-foreground">{sublabel}</div>
      )}
    </Card>
  )
}
