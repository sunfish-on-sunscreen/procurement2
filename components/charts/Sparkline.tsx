"use client";

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
  const pts = data.filter(
    (v): v is number => typeof v === "number" && Number.isFinite(v),
  );
  if (pts.length < 3) return null;

  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const stepX = width / (pts.length - 1);
  const y = (v: number) => height - 1 - ((v - min) / span) * (height - 2);
  const d = pts
    .map((v, i) => `${i === 0 ? "M" : "L"}${(i * stepX).toFixed(1)},${y(v).toFixed(1)}`)
    .join(" ");

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
        d={d}
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
