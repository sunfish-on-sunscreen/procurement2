export const CHART_COLORS = [
  "#3b82f6",
  "#10b981",
  "#f59e0b",
  "#ef4444",
  "#8b5cf6",
  "#06b6d4",
  "#ec4899",
  "#84cc16",
];

export const ABC_COLORS: Record<"A" | "B" | "C", string> = {
  A: "#ef4444",
  B: "#f59e0b",
  C: "#84cc16",
};

// Keyed by Kraljic QUADRANT so the semantic colour is stable across years.
// Strategic = critical (red), Leverage = best position (green),
// Bottleneck = vulnerable (amber), Routine = manage by exception (blue).
import type { KraljicQuadrant } from "@/lib/analysis-types";

export const QUADRANT_COLORS: Record<KraljicQuadrant, string> = {
  Strategic: "#ef4444", // red — critical, dangerous to lose
  Leverage: "#10b981", // green — best position, use buying power
  Bottleneck: "#f59e0b", // amber — vulnerable, secure or replace
  Routine: "#3b82f6", // blue — automate, simplify
};
