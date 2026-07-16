/**
 * Pure geometry for the inline-SVG sparklines — the ONLY math shared by the two
 * hand-rolled implementations:
 *   - components/charts/Sparkline.tsx  (decorative KPI sparkline)
 *   - CardSparkline in components/PerformanceTrajectory.tsx (interactive trajectory)
 * Extracted so the point/path computation lives in one place. Pure: no React, no
 * JSX, no side effects.
 *
 * Two positioning modes, both reproduced byte-for-byte from the originals:
 *   - preserveGaps=false (compress): finite points are laid out at CONTIGUOUS
 *     indices (nulls dropped); denominator = (finite count − 1). This is
 *     charts/Sparkline's behavior (called with xPad=0, yPad=1).
 *   - preserveGaps=true: finite points keep their ORIGINAL index across the full
 *     series (nulls leave gaps); denominator = (full length − 1), and a
 *     single-element series centers at width/2. This is CardSparkline's behavior
 *     (called with xPad=pad, yPad=pad).
 *
 * x = den>0 ? xPad + (slot/den)·(width − 2·xPad) : width/2
 * y = height − yPad − ((v−min)/span)·(height − 2·yPad),  span = (max−min) || 1
 * Path coordinates are rounded to 1 dp (matches both originals exactly).
 */

export type SparkPoint = {
  /** Original index in the input `values` (for gap-aware labels/tooltips). */
  i: number;
  /** The finite value at this point. */
  v: number;
  x: number;
  y: number;
};

export type SparkGeometry = {
  /** Finite points, in source order, with their SVG coordinates. */
  points: SparkPoint[];
  /** "M…L…" path through the finite points ("" when there are none). */
  path: string;
};

export function buildSparkGeometry(
  values: ReadonlyArray<number | null | undefined>,
  opts: {
    width: number;
    height: number;
    /** Vertical inner padding (Sparkline 1, CardSparkline = pad). */
    yPad: number;
    /** Horizontal inner padding (Sparkline 0, CardSparkline = pad). */
    xPad: number;
    /** true → plot at original index (gaps preserved); false → compress. */
    preserveGaps: boolean;
  },
): SparkGeometry {
  const { width, height, yPad, xPad, preserveGaps } = opts;

  // Finite points, keeping their original index. Matches Sparkline's predicate
  // (Number.isFinite); equivalent to CardSparkline's `!= null` on its number|null
  // input domain (a valid sub-score is never NaN/Infinity).
  const finite: Array<{ v: number; i: number }> = [];
  values.forEach((v, i) => {
    if (typeof v === "number" && Number.isFinite(v)) finite.push({ v, i });
  });
  if (finite.length === 0) return { points: [], path: "" };

  const vals = finite.map((p) => p.v);
  const min = Math.min(...vals);
  const max = Math.max(...vals);
  const span = max - min || 1;

  // The slot index + denominator differ by mode: compress uses the point's
  // POSITION over (finite count − 1); preserve uses its ORIGINAL index over
  // (full length − 1).
  const den = preserveGaps ? values.length - 1 : finite.length - 1;
  const xAt = (slot: number) =>
    den > 0 ? xPad + (slot / den) * (width - 2 * xPad) : width / 2;
  const yAt = (v: number) =>
    height - yPad - ((v - min) / span) * (height - 2 * yPad);

  const points: SparkPoint[] = finite.map((p, k) => ({
    i: p.i,
    v: p.v,
    x: xAt(preserveGaps ? p.i : k),
    y: yAt(p.v),
  }));

  const path = points
    .map((p, k) => `${k === 0 ? "M" : "L"}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
    .join(" ");

  return { points, path };
}
