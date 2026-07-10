/**
 * Cross-page anomaly cross-reference (cross-page-anomaly project).
 *
 * Batch 1 (buildAnomalyCrossref): takes the three EXISTING Process-Health
 * cycle-time anomaly flags (derived by lib/cycle-flags — same thresholds, same
 * suppliers) and cross-references each flagged supplier against its portfolio
 * POSITION — ABC tier (from the breakdown roster) and spend / Kraljic quadrant /
 * performance zone (from the performance_spend analysis). A cycle anomaly on an
 * A-tier / Strategic supplier is urgent; on a tail / Routine supplier, minor.
 *
 * Batch 2 (buildClassificationAnomalies + buildAnomalyHub): adds a SECOND anomaly
 * family — cross-LENS disagreement. Each supplier is percentile-ranked on three
 * lenses (Spend, Performance, Supply-risk); a large SPREAD across those ranks
 * means the lenses disagree about the supplier (e.g. top-performance but
 * bottom-spend, or high-supply-risk but high-performance). buildAnomalyHub merges
 * both families + their union/overlap so Action Priorities can render one hub.
 *
 * All PURE — data in, computed values out. No fetch, no state. No anomaly
 * detection is re-implemented; the process flags come in pre-computed.
 */

import type {
  PerformanceSpendSupplier,
  KraljicQuadrant,
  PerformanceZone,
} from "@/lib/analysis-types";
import type {
  AbcClass,
  CycleFlagKey,
  CycleSupplierRow,
  SupplierFlagState,
} from "@/lib/cycle-time-types";

/** One flagged supplier joined with its classification position. */
export type CrossAnomalyRow = {
  supplier_id: string;
  supplier_name: string;
  flags: SupplierFlagState;
  /** How many of the three flags are set (1–3). */
  flag_count: number;
  abc_class: AbcClass | null;
  kraljic_quadrant: KraljicQuadrant | null;
  zone: PerformanceZone | null;
  total_spend_usd: number | null;
  /** "Important" = A-tier (top-80% spend) OR Strategic (high spend × high risk). */
  important: boolean;
};

export type AnomalyCrossref = {
  /** Flagged suppliers, IMPORTANT first, then by spend desc. */
  rows: CrossAnomalyRow[];
  /** Suppliers carrying ≥1 flag. */
  flaggedCount: number;
  /** Flagged AND important (A-tier or Strategic). */
  importantCount: number;
  /** Σ spend of the important flagged suppliers (the "$ exposure" headline). */
  importantSpend: number;
  /** How many flagged suppliers carry each flag (== deriveCycleFlags' flagCounts). */
  flagMix: Record<CycleFlagKey, number>;
};

const isImportant = (
  abc: AbcClass | null,
  kraljic: KraljicQuadrant | null,
): boolean => abc === "A" || kraljic === "Strategic";

/**
 * Build the anomaly × position cross-reference. `flagsBySupplier` must come from
 * deriveCycleFlags (so the flags match Process Health exactly); `roster` supplies
 * ABC + a supplier-name fallback; `perfSuppliers` supplies spend / Kraljic / zone.
 */
export function buildAnomalyCrossref(input: {
  flagsBySupplier: Map<string, SupplierFlagState>;
  perfSuppliers: PerformanceSpendSupplier[];
  roster: CycleSupplierRow[];
}): AnomalyCrossref {
  const { flagsBySupplier, perfSuppliers, roster } = input;

  const perfById = new Map(perfSuppliers.map((s) => [s.supplier_id, s]));
  const rosterById = new Map(roster.map((r) => [r.supplier_id, r]));

  const rows: CrossAnomalyRow[] = [];
  for (const [supplier_id, flags] of flagsBySupplier) {
    const flag_count =
      (flags.has_outlier ? 1 : 0) +
      (flags.inconsistent ? 1 : 0) +
      (flags.has_stage_dom ? 1 : 0);
    if (flag_count === 0) continue; // only suppliers with ≥1 flag

    const perf = perfById.get(supplier_id);
    const rr = rosterById.get(supplier_id);
    const abc_class = rr?.abc_class ?? null;
    const kraljic_quadrant = perf?.kraljic_quadrant ?? null;

    rows.push({
      supplier_id,
      supplier_name: perf?.supplier_name ?? rr?.supplier_name ?? supplier_id,
      flags,
      flag_count,
      abc_class,
      kraljic_quadrant,
      zone: perf?.zone ?? null,
      total_spend_usd: perf?.total_spend_usd ?? null,
      important: isImportant(abc_class, kraljic_quadrant),
    });
  }

  // Important first; then highest spend (nulls last); then more flags; then a
  // stable id tiebreak so the order is deterministic (hydration-safe).
  rows.sort((a, b) => {
    if (a.important !== b.important) return a.important ? -1 : 1;
    const sa = a.total_spend_usd ?? -1;
    const sb = b.total_spend_usd ?? -1;
    if (sb !== sa) return sb - sa;
    if (b.flag_count !== a.flag_count) return b.flag_count - a.flag_count;
    return a.supplier_id < b.supplier_id ? -1 : a.supplier_id > b.supplier_id ? 1 : 0;
  });

  const flagMix: Record<CycleFlagKey, number> = {
    has_outlier: 0,
    inconsistent: 0,
    has_stage_dom: 0,
  };
  let importantCount = 0;
  let importantSpend = 0;
  for (const r of rows) {
    if (r.flags.has_outlier) flagMix.has_outlier++;
    if (r.flags.inconsistent) flagMix.inconsistent++;
    if (r.flags.has_stage_dom) flagMix.has_stage_dom++;
    if (r.important) {
      importantCount++;
      importantSpend += r.total_spend_usd ?? 0;
    }
  }

  return {
    rows,
    flaggedCount: rows.length,
    importantCount,
    importantSpend,
    flagMix,
  };
}

// ===========================================================================
// Batch 2 — classification anomalies: cross-LENS disagreement ranking.
// ===========================================================================

/** The three ranking lenses. Percentile ranks are 0 (bottom of roster) … 100. */
export type DisagreementAxis = "spend" | "performance" | "risk";

/** One supplier whose three lens-ranks disagree (spread ≥ threshold). */
export type ClassificationAnomalyRow = {
  supplier_id: string;
  supplier_name: string;
  /** Percentile ranks (0–100) across the active roster. */
  spend_pct: number;
  performance_pct: number;
  risk_pct: number;
  /** max(S,P,R) − min(S,P,R) — how far apart the lenses rank this supplier. */
  disagreement: number;
  max_axis: DisagreementAxis;
  min_axis: DisagreementAxis;
  /** Short human verdict derived from the max/min axes, e.g. "Top performance, bottom spend". */
  verdict: string;
  // Position (for chips), same sources as the process family.
  abc_class: AbcClass | null;
  kraljic_quadrant: KraljicQuadrant | null;
  zone: PerformanceZone | null;
  total_spend_usd: number;
  important: boolean;
};

export type ClassificationAnomalies = {
  /** Flagged suppliers (spread ≥ threshold), sorted by disagreement desc. */
  rows: ClassificationAnomalyRow[];
  flaggedCount: number;
  /** The eligible roster size the percentiles were computed over. */
  rosterSize: number;
};

/**
 * Disagreement cutoff for the classification-anomaly flag. Calibrated against the
 * live roster spread distribution: a spread of 80 means the supplier sits ~top-decile
 * on one lens and ~bottom-decile on another — a genuine extreme. It flags ~15–20% of
 * the roster (11/55 Range, 3/20 single-year), the striking contradictions only; a
 * looser cutoff (e.g. 50) flagged ~60% — the majority — which isn't an "anomaly".
 */
export const CLASSIFICATION_DISAGREEMENT_CUTOFF = 80;

/**
 * Build a percentile-rank function over `values`. rank(v) = share of the roster at
 * or below v, as 0–100: `(count_below + (count_equal − 1)/2) / (n − 1) × 100`
 * (mean-rank tie handling). The min value → 0, the max → 100, ties share the
 * middle. A 1-element roster ranks at 50 (no spread possible).
 */
function percentileRanker(values: number[]): (v: number) => number {
  const n = values.length;
  return (v: number) => {
    if (n <= 1) return 50;
    let below = 0;
    let equal = 0;
    for (const x of values) {
      if (x < v) below++;
      else if (x === v) equal++;
    }
    return ((below + (equal - 1) / 2) / (n - 1)) * 100;
  };
}

const AXIS_HIGH: Record<DisagreementAxis, string> = {
  spend: "Top spend",
  performance: "Top performance",
  risk: "High supply-risk",
};
const AXIS_LOW: Record<DisagreementAxis, string> = {
  spend: "bottom spend",
  performance: "bottom performance",
  risk: "low supply-risk",
};

/** Verdict names the highest lens then the lowest, e.g. "Top performance, bottom spend". */
function verdictFor(max: DisagreementAxis, min: DisagreementAxis): string {
  return `${AXIS_HIGH[max]}, ${AXIS_LOW[min]}`;
}

/**
 * Cross-lens disagreement ranking. For each supplier with all three inputs
 * available, percentile-rank Spend / Performance / Supply-risk across the roster,
 * take the SPREAD (max − min), flag when it ≥ threshold (default
 * CLASSIFICATION_DISAGREEMENT_CUTOFF = 80), and rank by spread desc.
 * `supplyRiskById` = Kraljic supply-risk SCORE per supplier (numeric,
 * from KraljicResult.quadrant_assignments); suppliers missing it are skipped.
 * The percentiles are integer-rounded first, so the displayed bars reconcile with
 * the displayed disagreement number exactly.
 */
export function buildClassificationAnomalies(input: {
  perfSuppliers: PerformanceSpendSupplier[];
  supplyRiskById: Map<string, number>;
  abcById: Map<string, AbcClass>;
  threshold?: number;
}): ClassificationAnomalies {
  const { perfSuppliers, supplyRiskById, abcById } = input;
  const threshold = input.threshold ?? CLASSIFICATION_DISAGREEMENT_CUTOFF;

  // Only suppliers with a numeric supply-risk score can be ranked on all 3 lenses.
  const elig = perfSuppliers.filter((p) => supplyRiskById.has(p.supplier_id));
  const rankSpend = percentileRanker(elig.map((p) => p.total_spend_usd));
  const rankPerf = percentileRanker(elig.map((p) => p.performance_score));
  const rankRisk = percentileRanker(elig.map((p) => supplyRiskById.get(p.supplier_id)!));

  const rows: ClassificationAnomalyRow[] = [];
  for (const p of elig) {
    const S = Math.round(rankSpend(p.total_spend_usd));
    const P = Math.round(rankPerf(p.performance_score));
    const R = Math.round(rankRisk(supplyRiskById.get(p.supplier_id)!));
    const axes: { axis: DisagreementAxis; v: number }[] = [
      { axis: "spend", v: S },
      { axis: "performance", v: P },
      { axis: "risk", v: R },
    ];
    // Deterministic tie-break: axes are in spend→performance→risk order, and the
    // reducers keep the earlier axis on a tie (so the verdict is stable).
    const maxA = axes.reduce((m, c) => (c.v > m.v ? c : m));
    const minA = axes.reduce((m, c) => (c.v < m.v ? c : m));
    const disagreement = maxA.v - minA.v;
    if (disagreement < threshold) continue;

    const abc_class = abcById.get(p.supplier_id) ?? null;
    rows.push({
      supplier_id: p.supplier_id,
      supplier_name: p.supplier_name,
      spend_pct: S,
      performance_pct: P,
      risk_pct: R,
      disagreement,
      max_axis: maxA.axis,
      min_axis: minA.axis,
      verdict: verdictFor(maxA.axis, minA.axis),
      abc_class,
      kraljic_quadrant: p.kraljic_quadrant,
      zone: p.zone,
      total_spend_usd: p.total_spend_usd,
      important: isImportant(abc_class, p.kraljic_quadrant),
    });
  }

  // Strongest contradiction first; then higher spend; then a stable id tiebreak.
  rows.sort((a, b) => {
    if (b.disagreement !== a.disagreement) return b.disagreement - a.disagreement;
    if (b.total_spend_usd !== a.total_spend_usd) return b.total_spend_usd - a.total_spend_usd;
    return a.supplier_id < b.supplier_id ? -1 : a.supplier_id > b.supplier_id ? 1 : 0;
  });

  return { rows, flaggedCount: rows.length, rosterSize: elig.length };
}

export type AnomalyHub = {
  process: AnomalyCrossref;
  classification: ClassificationAnomalies;
  /** Distinct suppliers flagged in EITHER family (process ∪ classification). */
  distinctFlagged: number;
  /** Suppliers flagged in BOTH families (the compound cross-page cases). */
  compoundCount: number;
  /** Their ids — so each family's rows can show a "⧉ also …" badge. */
  compoundIds: Set<string>;
  /** Union suppliers that are A-tier or Strategic (the hub-level importance stat). */
  importantUnionCount: number;
};

/**
 * Merge both anomaly families into one hub. Reuses buildAnomalyCrossref (Batch 1,
 * untouched) for the process side and buildClassificationAnomalies (Batch 2) for
 * the classification side, then computes the union/overlap. ABC for the
 * classification side is derived from the same breakdown `roster` the process side
 * uses (so both families read one ABC source).
 */
export function buildAnomalyHub(input: {
  flagsBySupplier: Map<string, SupplierFlagState>;
  perfSuppliers: PerformanceSpendSupplier[];
  roster: CycleSupplierRow[];
  supplyRiskById: Map<string, number>;
}): AnomalyHub {
  const { flagsBySupplier, perfSuppliers, roster, supplyRiskById } = input;

  const process = buildAnomalyCrossref({ flagsBySupplier, perfSuppliers, roster });

  const abcById = new Map<string, AbcClass>();
  for (const r of roster) if (r.abc_class) abcById.set(r.supplier_id, r.abc_class);
  const classification = buildClassificationAnomalies({ perfSuppliers, supplyRiskById, abcById });

  const procIds = new Set(process.rows.map((r) => r.supplier_id));
  const classIds = new Set(classification.rows.map((r) => r.supplier_id));
  const compoundIds = new Set([...procIds].filter((id) => classIds.has(id)));
  const union = new Set([...procIds, ...classIds]);

  const perfById = new Map(perfSuppliers.map((s) => [s.supplier_id, s]));
  let importantUnionCount = 0;
  for (const id of union) {
    const abc = abcById.get(id) ?? null;
    const kq = perfById.get(id)?.kraljic_quadrant ?? null;
    if (isImportant(abc, kq)) importantUnionCount++;
  }

  return {
    process,
    classification,
    distinctFlagged: union.size,
    compoundCount: compoundIds.size,
    compoundIds,
    importantUnionCount,
  };
}
