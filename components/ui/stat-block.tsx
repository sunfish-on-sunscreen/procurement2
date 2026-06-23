import * as React from "react"

import { cn } from "@/lib/utils"
import { Card } from "@/components/ui/card"

/**
 * A single label + value statistic in a Card container, so every stat callout
 * across the app shares one visual language (ring + radius from `Card`). Replaces
 * the previously divergent KPI cards, ABC class boxes, and panel header stats.
 *
 * `accent` draws a subtle left border in a semantic colour (theme tokens defined
 * in globals.css). `size="lg"` is for prominent KPIs; default is for secondary
 * stats. The primitive makes no page-specific assumptions and is reusable.
 */
const ACCENT_COLORS: Record<string, string | undefined> = {
  default: undefined,
  primary: "var(--primary)",
  destructive: "var(--destructive)",
  warning: "var(--warning)",
  success: "var(--success)",
}

export type StatBlockProps = {
  label: string
  value: React.ReactNode
  sublabel?: React.ReactNode
  accent?: "default" | "primary" | "destructive" | "warning" | "success"
  size?: "default" | "lg"
  className?: string
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
      data-size={size}
      // Tight, top-aligned stack (label → value → sublabel) with explicit
      // padding — `Card` only sets py, so without this the content is flush to
      // the horizontal edges. `lg` is the same component a notch larger.
      className={cn(
        "gap-0.5 px-3 py-3",
        size === "lg" && "gap-1 px-4 py-4",
        className,
      )}
      style={
        accentColor
          ? { borderLeft: `4px solid ${accentColor}` }
          : undefined
      }
    >
      <div className="text-sm text-muted-foreground">{label}</div>
      <div
        className={cn(
          "font-semibold leading-tight tracking-tight",
          size === "lg" ? "text-3xl" : "text-2xl",
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
