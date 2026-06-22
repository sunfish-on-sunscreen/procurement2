import { clsx, type ClassValue } from "clsx"
import { twMerge } from "tailwind-merge"

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

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
