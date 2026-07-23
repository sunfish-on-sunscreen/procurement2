import type { CoverageMixTransition, SourcingCoverageResult } from "@/lib/analysis-types";

/**
 * Shared, pure derivations for competitive-coverage COPY.
 *
 * ⚠️ WHY THIS EXISTS: the coverage card and the report appendix must never disagree
 * about whether a year-over-year move was BEHAVIOUR (the same categories bought
 * differently) or MIX (different categories bought). That classification is the one
 * genuinely behavioural reading in the whole feature, and it is derived from the
 * shift-share output — so if the two surfaces each re-derived it, a change to one
 * would silently let a report contradict the dashboard it was generated from. The
 * shape is classified ONCE, here; each surface renders its own register from the
 * same verdict.
 *
 * ⚠️ NOTHING HERE IS HARDCODED. On the current data the 2025 fall is roughly
 * two-thirds within-category, so it reads as behaviour — but that is a fact about
 * this dataset, not about the metric. An earlier draft of the emitter's own
 * docstring asserted mix dominance and the emitter disproved it. Read the verdict;
 * never assume which side dominates.
 */

/** Remainder shape once the dominant effect is stated. */
export type CoverageMoveShape = "negligible" | "aligned" | "opposing";

export type CoverageMoveVerdict = {
  from: string;
  to: string;
  /** Signed change in the bucket's spend share, in percentage points. */
  changePts: number;
  fromPct: number;
  toPct: number;
  /** Same categories, bought differently. */
  withinPts: number;
  /**
   * DERIVED as change − within, never read raw. The three emitted effects are each
   * rounded to 2dp independently, so a rendered triple can fail to add up; deriving
   * the third guarantees whatever a surface prints reconciles with the headline.
   */
  mixPts: number;
  /** true when |within| >= |mix| — the move is mostly a change in how buying was done. */
  behavioural: boolean;
  /** The emitter's own flag: the pooled number is real but attributable to composition. */
  mixDominated: boolean;
  /**
   * How the remainder relates to the headline: too small to mention, pulling the
   * same way, or pulling the OTHER way. `opposing` is reachable and must not be
   * described as a contribution — on this data 2025→2026 has within +7.45 against a
   * +7.43 move, so mix ran backwards at −0.02.
   */
  shape: CoverageMoveShape;
  /** Direction word for the headline. */
  direction: "fell" | "rose";
};

/** Below this many percentage points the remainder is not worth a clause. */
const NEGLIGIBLE_PTS = 0.5;

export function classifyCoverageMove(
  t: CoverageMixTransition,
): CoverageMoveVerdict | null {
  const changePts = t.pooled_change_pct;
  const withinPts = t.within_effect_pct;
  const fromPct = t.from_pooled_pct;
  const toPct = t.to_pooled_pct;
  if (changePts == null || withinPts == null || fromPct == null || toPct == null) {
    return null;
  }
  if (Math.abs(changePts) < 0.01) return null;

  const mixPts = changePts - withinPts;
  const shape: CoverageMoveShape =
    Math.abs(mixPts) < NEGLIGIBLE_PTS
      ? "negligible"
      : mixPts * changePts > 0
        ? "aligned"
        : "opposing";

  return {
    from: t.from,
    to: t.to,
    changePts,
    fromPct,
    toPct,
    withinPts,
    mixPts,
    behavioural: Math.abs(withinPts) >= Math.abs(mixPts),
    mixDominated: t.pooled_misleading && t.reason === "mix_dominated",
    shape,
    direction: changePts < 0 ? "fell" : "rose",
  };
}

/**
 * The transitions a given window should DISPLAY: those ending inside it.
 *
 * The decomposition itself is window-independent — every transition carries
 * identical numbers on every period selection — so this is purely a display filter.
 * ⚠️ Returns ALL in-window transitions, not just the latest: keeping only the most
 * recent silently discards the largest finding whenever a window spans more than one
 * step (on this data the full range would show the 2026 recovery and drop the 2025
 * fall entirely).
 */
export function visibleCoverageMoves(
  coverage: SourcingCoverageResult,
): CoverageMoveVerdict[] {
  const mac = coverage.mix_adjusted_coverage;
  return (mac.metrics.competed?.transitions ?? [])
    .filter((t) => mac.window_periods.includes(t.to))
    .map(classifyCoverageMove)
    .filter((v): v is CoverageMoveVerdict => v != null);
}

/** "9.89 points" / "1 point". */
export function pts(v: number): string {
  const a = Math.abs(v);
  return `${a.toFixed(2)} point${a === 1 ? "" : "s"}`;
}
