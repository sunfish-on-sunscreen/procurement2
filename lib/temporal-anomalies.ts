/**
 * Temporal ("changed over time") anomalies — Batch 3 of the cross-page-anomaly
 * project. Compares each supplier's LATEST period vs. the PRIOR period across
 * three per-period signals — spend, Kraljic quadrant, and composite score — all
 * read from the trustworthy per-period AnalysisResults (Purchase-derived; the
 * stored-SupplierMetric lag does NOT touch this). Generalizes the evolution
 * route's per-supplier period diff to portfolio-wide.
 *
 * PURE: matrix in, flagged suppliers out. No fetch, no DB (the server loader in
 * lib/temporal-load.ts does the reads and hands this a compact matrix).
 *
 * ── Threshold calibration (tested against live 2024→2025 data) ──────────────
 * The naive "latest vs prior" = 2026 vs 2025 is degenerate: 2026 is a partial
 * year (~$30M vs 2025's ~$284M), so ~85% of suppliers show a volume-artifact
 * drop. PARTIAL_YEAR_SPEND_FRACTION skips such a latest year → compares the two
 * comparable full years. Spend uses a FOLD (ratio) cutoff, not raw %, because
 * drops cap at −100% while spikes reach +1600% — a symmetric % would be
 * asymmetric in practice. Each detector is individually selective (~15–21% of
 * the comparable roster); the family union is broader (~40–46% on the dynamic
 * 2024→2025 pair) because it's three DISTINCT sharp-move signals — so the block
 * ranks by significance and shows top-N.
 */

import type {
  PerformanceSpendResult,
  AbcResult,
  KraljicQuadrant,
  PerformanceZone,
} from "@/lib/analysis-types";
import type { AbcClass } from "@/lib/cycle-time-types";

/** Spend flagged when it changed by ≥ this fold (2.5× = up ≥150% or down ≥60%). */
export const SPEND_FOLD_CUTOFF = 2.5;
/** …and only when the LARGER of the two years' spend clears this (small-base guard). */
export const SPEND_SMALL_BASE_MIN = 100_000;
/** Composite score flagged when it moved ≥ this many points year-over-year. */
export const SCORE_SWING_CUTOFF = 18;
/** Skip a LATEST period whose total spend is < this fraction of the prior's — a
 *  partial/sparse year would otherwise make every supplier look like a huge drop. */
export const PARTIAL_YEAR_SPEND_FRACTION = 0.5;

export type TemporalPoint = { spend: number; score: number; quadrant: KraljicQuadrant };

/** One supplier's latest + prior per-period snapshot (from per-period perf/abc). */
export type TemporalSupplierRow = {
  supplier_id: string;
  supplier_name: string;
  latest: (TemporalPoint & { zone: PerformanceZone | null }) | null;
  prior: TemporalPoint | null;
  abc_class: AbcClass | null; // latest period
};

export type TemporalMatrix = {
  latestLabel: string;
  priorLabel: string;
  /** A newest period excluded as partial (guard), for a UI note; else null. */
  skippedLabel: string | null;
  rows: TemporalSupplierRow[];
};

export type TemporalChange = {
  spend: { pct: number; from: number; to: number } | null;
  quadrant: { from: KraljicQuadrant; to: KraljicQuadrant; axes_flipped: number } | null;
  score: { delta: number; from: number; to: number } | null;
};

export type TemporalAnomalyRow = TemporalChange & {
  supplier_id: string;
  supplier_name: string;
  abc_class: AbcClass | null;
  kraljic_quadrant: KraljicQuadrant | null; // latest
  zone: PerformanceZone | null; // latest
  total_spend_usd: number | null; // latest
  significance: number;
  important: boolean;
};

export type TemporalAnomalies = {
  latestLabel: string;
  priorLabel: string;
  skippedLabel: string | null;
  /** Flagged suppliers, most-significant first. */
  rows: TemporalAnomalyRow[];
  flaggedCount: number;
  /** Suppliers active in BOTH years (the comparable roster). */
  rosterSize: number;
  byDetector: { spend: number; quadrant: number; score: number };
};

// Kraljic quadrant → (spendHigh, riskHigh), so a quadrant move's "distance" is the
// number of axes that flipped: 2 = diagonal (Strategic↔Routine, Leverage↔Bottleneck),
// 1 = adjacent.
const QUAD_AXES: Record<KraljicQuadrant, [number, number]> = {
  Strategic: [1, 1],
  Leverage: [1, 0],
  Bottleneck: [0, 1],
  Routine: [0, 0],
};

const isImportant = (abc: AbcClass | null, q: KraljicQuadrant | null): boolean =>
  abc === "A" || q === "Strategic";

/**
 * Build the per-supplier latest/prior matrix from two periods' perf results (+ the
 * latest period's abc for the ABC chip). PURE — takes the loaded AnalysisResults.
 * The server loader picks which two periods (partial-year guard) and passes labels.
 */
export function buildTemporalMatrix(input: {
  latest: { label: string; perf: PerformanceSpendResult | null; abc: AbcResult | null };
  prior: { label: string; perf: PerformanceSpendResult | null };
  skippedLabel: string | null;
}): TemporalMatrix {
  const lp = new Map((input.latest.perf?.suppliers ?? []).map((s) => [s.supplier_id, s]));
  const pp = new Map((input.prior.perf?.suppliers ?? []).map((s) => [s.supplier_id, s]));
  const abcById = new Map(
    (input.latest.abc?.classifications ?? []).map((c) => [c.supplier_id, c.abc_class as AbcClass]),
  );
  const ids = new Set([...lp.keys(), ...pp.keys()]);

  const rows: TemporalSupplierRow[] = [];
  for (const id of ids) {
    const l = lp.get(id);
    const p = pp.get(id);
    rows.push({
      supplier_id: id,
      supplier_name: l?.supplier_name ?? p?.supplier_name ?? id,
      latest: l
        ? { spend: l.total_spend_usd, score: l.performance_score, quadrant: l.kraljic_quadrant, zone: l.zone }
        : null,
      prior: p ? { spend: p.total_spend_usd, score: p.performance_score, quadrant: p.kraljic_quadrant } : null,
      abc_class: abcById.get(id) ?? null,
    });
  }
  return {
    latestLabel: input.latest.label,
    priorLabel: input.prior.label,
    skippedLabel: input.skippedLabel,
    rows,
  };
}

/**
 * Detect the three temporal anomalies per supplier (latest vs prior), applying the
 * calibrated thresholds + the small-base guard. Only suppliers active in BOTH
 * years can be compared. Sorted by significance (quadrant distance dominates, then
 * spend magnitude, then score swing).
 */
export function buildTemporalAnomalies(matrix: TemporalMatrix): TemporalAnomalies {
  const rows: TemporalAnomalyRow[] = [];
  let bothCount = 0;
  const det = { spend: 0, quadrant: 0, score: 0 };

  for (const r of matrix.rows) {
    if (!r.latest || !r.prior) continue; // need both years
    bothCount++;
    const L = r.latest;
    const P = r.prior;

    // Spend — fold change (ratio), with the small-base guard on the larger year.
    let spend: TemporalChange["spend"] = null;
    if (P.spend > 0) {
      const hi = Math.max(L.spend, P.spend);
      const lo = Math.min(L.spend, P.spend);
      const fold = lo > 0 ? hi / lo : Infinity;
      if (hi >= SPEND_SMALL_BASE_MIN && fold >= SPEND_FOLD_CUTOFF) {
        spend = {
          pct: Math.round(((L.spend - P.spend) / P.spend) * 100),
          from: P.spend,
          to: L.spend,
        };
      }
    }

    // Score — absolute point swing.
    let score: TemporalChange["score"] = null;
    const delta = Math.round((L.score - P.score) * 10) / 10;
    if (Math.abs(delta) >= SCORE_SWING_CUTOFF) {
      score = { delta, from: P.score, to: L.score };
    }

    // Quadrant — any change, tagged with how many axes flipped.
    let quadrant: TemporalChange["quadrant"] = null;
    if (L.quadrant !== P.quadrant) {
      const a = QUAD_AXES[L.quadrant];
      const b = QUAD_AXES[P.quadrant];
      quadrant = {
        from: P.quadrant,
        to: L.quadrant,
        axes_flipped: (a[0] !== b[0] ? 1 : 0) + (a[1] !== b[1] ? 1 : 0),
      };
    }

    if (!spend && !score && !quadrant) continue;
    if (spend) det.spend++;
    if (score) det.score++;
    if (quadrant) det.quadrant++;

    // Significance: quadrant distance dominates (diagonal > adjacent), then the
    // spend magnitude (capped), then the score swing.
    const significance =
      (quadrant ? quadrant.axes_flipped * 1000 : 0) +
      (spend ? Math.min(Math.abs(spend.pct), 500) : 0) +
      (score ? Math.abs(score.delta) * 5 : 0);

    rows.push({
      supplier_id: r.supplier_id,
      supplier_name: r.supplier_name,
      spend,
      quadrant,
      score,
      abc_class: r.abc_class,
      kraljic_quadrant: L.quadrant,
      zone: L.zone,
      total_spend_usd: L.spend,
      significance,
      important: isImportant(r.abc_class, L.quadrant),
    });
  }

  rows.sort(
    (a, b) =>
      b.significance - a.significance ||
      (b.total_spend_usd ?? 0) - (a.total_spend_usd ?? 0) ||
      (a.supplier_id < b.supplier_id ? -1 : a.supplier_id > b.supplier_id ? 1 : 0),
  );

  return {
    latestLabel: matrix.latestLabel,
    priorLabel: matrix.priorLabel,
    skippedLabel: matrix.skippedLabel,
    rows,
    flaggedCount: rows.length,
    rosterSize: bothCount,
    byDetector: det,
  };
}
