/**
 * Cross-page anomaly cross-reference (Batch 1 of the cross-page-anomaly project).
 *
 * PURE join: takes the three EXISTING Process-Health cycle-time anomaly flags
 * (derived by lib/cycle-flags — same thresholds, same suppliers) and cross-
 * references each flagged supplier against its portfolio POSITION — ABC tier
 * (from the breakdown roster) and spend / Kraljic quadrant / performance zone
 * (from the performance_spend analysis).
 *
 * The point: a cycle anomaly on an A-tier / Strategic supplier is urgent; the same
 * anomaly on a tail / Routine supplier is minor. This surfaces WHO the process
 * problems land on, so Action Priorities can weight them by importance.
 *
 * No new anomaly detection here — flags come in pre-computed. No fetch, no state.
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
