import type { AbcResult } from "@/lib/analysis-types";

/**
 * Spend-concentration diagnostic — the direct test of the Pareto premise that ABC
 * rests on: what share of spend does the top FIFTH of suppliers actually hold?
 *
 * ⚠️ WHY THIS EXISTS. The glance adjective used to derive from
 * `abc.summary.A.pct_of_spend`, which CANNOT VARY. Class A is DEFINED as the
 * suppliers covering the first 80% of spend, so that figure is pinned to
 * `(0.80 − largest_single_share, 0.80]` BY CONSTRUCTION. Reaching the "concentrated"
 * branch needed a supplier above 10% of spend and "relatively distributed" one above
 * 30%; the largest anywhere in this data is 6.62%, so A.pct never left [73.4%, 80%]
 * and the adjective was ALWAYS "heavily concentrated" — with a "typical Pareto
 * distribution" clause firing unconditionally behind it. Both statements were false
 * here. Top-fifth share measures the same premise on a quantity that actually moves:
 * it spans 20% (perfect equality) to 100% (one supplier holds everything).
 *
 * ⚠️ SHARED BY THE GLANCE AND THE PARETO CARD deliberately. They sit on the same
 * page, so if each derived the verdict separately the card could contradict the
 * paragraph above it. Same discipline as `lib/coverage-copy.ts`: each surface picks
 * its own words, only the ratio and the band are shared.
 *
 * ⚠️ THIS CHANGES NO CLASSIFICATION. The 80/95 cutpoints are the CIPS convention and
 * stay exactly as they are — retuning them to this dataset would be overfitting and
 * would break the citation. Only the prose describing the result changes. Nothing
 * here reaches a payload: every input is already on the loaded `abc` analysis.
 */

/** The "top fifth" of the roster, by headcount. */
export const TOP_FIFTH = 0.2;

/** Textbook Pareto: the top fifth hold 80% of spend. The reference, not a target. */
export const PARETO_REFERENCE_PCT = 80;

/** Perfect equality: the top fifth hold exactly their headcount share. */
export const EVEN_REFERENCE_PCT = TOP_FIFTH * 100;

/**
 * Bands are QUARTERS of the distance from perfect equality (20) to the textbook
 * ratio (80) — anchored on the premise being tested, not on arbitrary cutoffs.
 * ⚠️ Every band is reachable: top-fifth share can take any value in [20, 100], so
 * `even` fires on a flat roster, `pareto` on the textbook case, and the two middle
 * bands on everything between. This is the property the old A.pct-based test lacked.
 */
const SPAN = PARETO_REFERENCE_PCT - EVEN_REFERENCE_PCT; // 60 points
const MODERATE_FLOOR = EVEN_REFERENCE_PCT + SPAN / 2; // 50 — halfway to Pareto
const MILD_FLOOR = EVEN_REFERENCE_PCT + SPAN / 4; // 35 — a quarter of the way

export type ConcentrationBand = "pareto" | "moderate" | "mild" | "even";

export type SpendConcentration = {
  /** Suppliers with spend in the window (the ABC population). */
  supplierCount: number;
  /** Headcount of the top fifth, rounded up so it is never empty. */
  topCount: number;
  /** Share of window spend held by those suppliers, 0–100. */
  topSharePct: number;
  band: ConcentrationBand;
  /** Adjective for a lead sentence. */
  word: string;
  /** True ONLY when the data actually meets the textbook ratio. */
  meetsPareto: boolean;
};

const BAND_WORD: Record<ConcentrationBand, string> = {
  pareto: "highly concentrated",
  moderate: "moderately concentrated",
  mild: "only mildly concentrated",
  even: "spread almost evenly",
};

function bandOf(topSharePct: number): ConcentrationBand {
  if (topSharePct >= PARETO_REFERENCE_PCT) return "pareto";
  if (topSharePct >= MODERATE_FLOOR) return "moderate";
  if (topSharePct >= MILD_FLOOR) return "mild";
  return "even";
}

/**
 * Window-scoped: `abc.classifications` is the selected span's own population, so
 * the result re-reads on every period change with no extra fetch.
 * Returns null on an empty or zero-value window rather than throwing.
 */
export function buildSpendConcentration(abc: AbcResult | null): SpendConcentration | null {
  const rows = abc?.classifications ?? [];
  if (rows.length === 0) return null;

  const total = rows.reduce((sum, r) => sum + r.total, 0);
  if (total <= 0) return null;

  // Sort defensively — the emitter already returns spend-descending, but this must
  // not silently depend on that ordering.
  const sorted = [...rows].sort((a, b) => b.total - a.total);
  const topCount = Math.max(1, Math.ceil(TOP_FIFTH * sorted.length));
  const topSpend = sorted.slice(0, topCount).reduce((sum, r) => sum + r.total, 0);
  const topSharePct = (topSpend / total) * 100;
  const band = bandOf(topSharePct);

  return {
    supplierCount: sorted.length,
    topCount,
    topSharePct,
    band,
    word: BAND_WORD[band],
    meetsPareto: band === "pareto",
  };
}

/** The observed ratio in the same form as the textbook 20/80 — e.g. "20/40". */
export function ratioLabel(c: SpendConcentration): string {
  return `${EVEN_REFERENCE_PCT}/${Math.round(c.topSharePct)}`;
}

/** Suppliers the 80/20 rule would predict cover 80% of spend, for a roster of `n`. */
export function paretoExpectedCount(n: number): number {
  return Math.max(1, Math.round(TOP_FIFTH * n));
}
