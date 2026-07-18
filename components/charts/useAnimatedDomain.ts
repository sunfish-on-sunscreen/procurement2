"use client";

import { useEffect, useRef, useState } from "react";

export type Domain = [number, number];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
/** easeInOutCubic — smooth acceleration then deceleration. */
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function approxEq(a: { x: Domain; y: Domain }, b: { x: Domain; y: Domain }): boolean {
  const e = 1e-6;
  return (
    Math.abs(a.x[0] - b.x[0]) < e &&
    Math.abs(a.x[1] - b.x[1]) < e &&
    Math.abs(a.y[0] - b.y[0]) < e &&
    Math.abs(a.y[1] - b.y[1]) < e
  );
}

/**
 * Tween a scatter's x/y axis domains toward a target over `durationMs`, easing
 * in/out. Returns the current interpolated domain to feed Recharts' XAxis/YAxis
 * `domain`. Recharts can't animate a domain change itself, so we interpolate the
 * numbers in state via requestAnimationFrame — driving a real animated zoom.
 *
 * The component is expected to REMOUNT when the underlying dataset changes (the
 * caller keys it by period), so within one mount `target` only changes on a
 * zoom in/out — exactly the transitions we want to animate.
 */
export function useAnimatedDomain(
  target: { x: Domain; y: Domain },
  durationMs = 420,
): { x: Domain; y: Domain } {
  const [view, setView] = useState(target);
  const fromRef = useRef(target);
  const rafRef = useRef(0);
  const snapRef = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [x0, x1] = target.x;
  const [y0, y1] = target.y;

  useEffect(() => {
    const to: { x: Domain; y: Domain } = { x: [x0, x1], y: [y0, y1] };
    const from = fromRef.current;
    // Already there (e.g. initial mount) — nothing to animate.
    if (approxEq(from, to)) return;

    const start = performance.now();
    cancelAnimationFrame(rafRef.current);
    clearTimeout(snapRef.current);
    const step = (now: number) => {
      const t = Math.min(1, (now - start) / durationMs);
      const e = ease(t);
      const cur: { x: Domain; y: Domain } = {
        x: [lerp(from.x[0], to.x[0], e), lerp(from.x[1], to.x[1], e)],
        y: [lerp(from.y[0], to.y[0], e), lerp(from.y[1], to.y[1], e)],
      };
      fromRef.current = cur;
      setView(cur); // deferred (rAF), not a synchronous set-state-in-effect
      if (t < 1) rafRef.current = requestAnimationFrame(step);
    };
    rafRef.current = requestAnimationFrame(step);
    // Safety net: rAF is PAUSED in hidden/background tabs, so guarantee the
    // settled target domain via a timeout too (it still fires, just clamped).
    // In a visible tab the rAF tween lands first and this is a harmless no-op.
    snapRef.current = setTimeout(() => {
      fromRef.current = to;
      setView(to);
    }, durationMs + 80);
    return () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(snapRef.current);
    };
  }, [x0, x1, y0, y1, durationMs]);

  return view;
}

/**
 * Padded [min,max] domain around a set of values, for zooming a group to fill
 * the frame. Zero-width groups (a single supplier) fall back to a fraction of the
 * full range so the point still gets a sensible window. `clamp` caps the result
 * to bounds (e.g. [0,100] for a score axis) without defeating the sub-range zoom.
 */
export function paddedDomain(
  values: number[],
  fullRange: number,
  opts: { frac?: number; singleFrac?: number; clamp?: Domain } = {},
): Domain {
  const { frac = 0.15, singleFrac = 0.06, clamp } = opts;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const span = hi - lo;
  const pad = span > 0 ? span * frac : Math.max(fullRange * singleFrac, 0.5);
  let d: Domain = [lo - pad, hi + pad];
  if (clamp) d = [Math.max(clamp[0], d[0]), Math.min(clamp[1], d[1])];
  return d;
}
