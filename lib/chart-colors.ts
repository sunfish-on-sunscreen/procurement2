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

// Keyed by SEGMENT NAME (not cluster id) so the semantic colour is stable across
// years: green = good, red = concerning, blue = reliable, amber = peripheral.
export const SEGMENT_COLORS: Record<string, string> = {
  "Star Performers": "#10b981", // green
  "Reliable Specialists": "#3b82f6", // blue
  "Strategic Underperformers": "#ef4444", // red
  "Tail Spenders": "#f59e0b", // amber
};
