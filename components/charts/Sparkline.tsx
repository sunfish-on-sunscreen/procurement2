"use client";

import { buildSparkGeometry } from "@/lib/sparkline";

/**
 * Minimal inline-SVG trend line (Batch 6c) for KPI cards — no axes, labels, or
 * interactivity. Graceful fallback: fewer than 3 finite points renders nothing
 * (e.g. a single-year period with too few months).
 */
export function Sparkline({
  data,
  color = "currentColor",
  width = 64,
  height = 20,
  className,
}: {
  data: Array<number | null | undefined>;
  color?: string;
  width?: number;
  height?: number;
  className?: string;
}) {
  // Path geometry shared with CardSparkline (PerformanceTrajectory) via the pure
  // helper. Decorative mode: finite points compressed to contiguous indices
  // (xPad 0, yPad 1). The min-3-points null guard below is preserved as-is.
  const { points, path } = buildSparkGeometry(data, {
    width,
    height,
    yPad: 1,
    xPad: 0,
    preserveGaps: false,
  });
  if (points.length < 3) return null;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      className={className}
      aria-hidden="true"
      preserveAspectRatio="none"
    >
      <path
        d={path}
        fill="none"
        stroke={color}
        strokeWidth={1.5}
        strokeLinejoin="round"
        strokeLinecap="round"
        opacity={0.7}
      />
    </svg>
  );
}
