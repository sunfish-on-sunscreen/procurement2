// Colours reference CSS custom properties defined in app/globals.css so charts
// adapt to light/dark theme. Recharts accepts `var(--x)` as fill/stroke (the
// shadcn-charts pattern). Light-mode values preserve the prior hardcoded hex.
export const CHART_COLORS = [
  "var(--chart-1)",
  "var(--chart-2)",
  "var(--chart-3)",
  "var(--chart-4)",
  "var(--chart-5)",
  "var(--chart-6)",
  "var(--chart-7)",
  "var(--chart-8)",
];

export const ABC_COLORS: Record<"A" | "B" | "C", string> = {
  A: "var(--abc-a)",
  B: "var(--abc-b)",
  C: "var(--abc-c)",
};

// Keyed by Kraljic QUADRANT so the semantic colour is stable across years.
// Strategic = critical (red), Leverage = best position (green),
// Bottleneck = vulnerable (amber), Routine = manage by exception (blue).
import type { KraljicQuadrant, PerformanceZone } from "@/lib/analysis-types";

export const QUADRANT_COLORS: Record<KraljicQuadrant, string> = {
  Strategic: "var(--quadrant-strategic)", // red — critical, dangerous to lose
  Leverage: "var(--quadrant-leverage)", // green — best position, use buying power
  Bottleneck: "var(--quadrant-bottleneck)", // amber — vulnerable, secure or replace
  Routine: "var(--quadrant-routine)", // blue — automate, simplify
};

// Performance-vs-Spend zones. Deliberately distinct from QUADRANT_COLORS so the
// two concepts stay visually separable when shown side by side.
export const ZONE_COLORS: Record<PerformanceZone, string> = {
  Stars: "var(--zone-stars)", // green — celebrate
  "Critical Issues": "var(--zone-critical)", // red — fix first
  "Hidden Gems": "var(--zone-hidden-gems)", // purple — promote
  "Long Tail": "var(--zone-long-tail)", // gray — routine
};
