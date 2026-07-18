import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/**
 * Subtle elevation classes (applied SELECTIVELY to in-scope cards, not the Card
 * primitive, so untouched pages stay flat). `cardElevation` for inline page
 * cards; `panelElevation` for the floating detail-panel dialog. Low-opacity
 * black shadows degrade gracefully in dark mode (intentionally faint there).
 */
export const cardElevation =
  "shadow-[0_1px_2px_rgba(0,0,0,0.05),0_4px_12px_rgba(0,0,0,0.04)]";
export const panelElevation =
  "shadow-[0_4px_12px_rgba(0,0,0,0.08),0_16px_32px_rgba(0,0,0,0.08)]";

function trimDecimal(x: number): string {
  const s = x.toFixed(1);
  return s.endsWith(".0") ? s.slice(0, -2) : s;
}

/**
 * Compact USD for scannable tables/lists: "$25.6M" / "$1.2K" / "$487" / "$0".
 * 1 decimal for millions/thousands (trailing ".0" trimmed). Exact values still
 * belong in tooltips and the panel detail.
 */
export function formatCompactCurrency(value: number): string {
  if (!Number.isFinite(value)) return "$0";
  const sign = value < 0 ? "-" : "";
  const n = Math.abs(value);
  if (n >= 1_000_000) return `${sign}$${trimDecimal(n / 1_000_000)}M`;
  if (n >= 1_000) return `${sign}$${trimDecimal(n / 1_000)}K`;
  return `${sign}$${Math.round(n)}`;
}
