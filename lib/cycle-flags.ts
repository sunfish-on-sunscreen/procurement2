/**
 * Shared, pure derivation of the three supplier-level cycle-time anomaly flags.
 *
 * This is the SINGLE SOURCE OF TRUTH for how the flags are computed. The logic
 * was extracted VERBATIM from the Process Health client (CycleTimeClient) so the
 * flags render identically wherever they are consumed — the Process Health page
 * AND the Action Priorities cross-page "Anomaly exposure" section both call this,
 * guaranteeing the exact same suppliers get the exact same flags.
 *
 * The three flags (unchanged thresholds):
 *   - has_outlier    : the supplier appears in cycle_time.anomalies (≥1 PO whose
 *                      total cycle ran far above the period mean - a descriptive cut, not an outlier test).
 *   - inconsistent   : the supplier's cycle-day IQR exceeds 1.5 × the median of
 *                      all suppliers' IQRs (Tukey 1.5×IQR convention). The IQR
 *                      itself is computed server-side (breakdown.bySupplier[].iqr);
 *                      only this threshold comparison lives here.
 *   - has_stage_dom  : the supplier appears in breakdown.stageAnomalies (≥1 PO
 *                      where a single stage took > 60% of the total cycle).
 *
 * Everything here is PURE — arrays in, a derivation out. No fetch, no state.
 */

import type { CycleAnomaly } from "@/lib/analysis-types";
import type {
  CycleSupplierRow,
  CycleFlagKey,
  SupplierFlagState,
} from "@/lib/cycle-time-types";

/** Median of a numeric array (0 on empty). Linear, no interpolation surprises —
 *  matches the inline helper the Process Health client used before extraction. */
function median(xs: number[]): number {
  if (xs.length === 0) return 0;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export type CycleFlagDerivation = {
  /** supplier_id → its three flags. One entry per roster supplier. */
  flagsBySupplier: Map<string, SupplierFlagState>;
  /** How many suppliers carry each flag. */
  flagCounts: Record<CycleFlagKey, number>;
  /** PO-level counts where meaningful (outlier POs, stage-dominated POs). */
  flagPoCounts: Partial<Record<CycleFlagKey, number>>;
  /** The Inconsistent threshold = 1.5 × median(all suppliers' IQRs); null when the
   *  roster is empty. Reused as the consistency chart's band half-width so
   *  out-of-band crossings ⟺ the flag. */
  iqrCutoff: number | null;
};

/**
 * Derive the three supplier-level cycle flags from already-fetched data. Callers
 * pass the breakdown roster (per-supplier IQR), the cycle_time analysis anomalies
 * (outlier POs), and the breakdown stage anomalies (stage-dominated POs).
 */
export function deriveCycleFlags(input: {
  roster: CycleSupplierRow[];
  anomalies: CycleAnomaly[];
  stageAnomalies: CycleAnomaly[];
}): CycleFlagDerivation {
  const { roster, anomalies, stageAnomalies } = input;

  // "Inconsistent" = IQR beyond 1.5× the portfolio median (Tukey 1.5×IQR
  // convention), so only genuinely high-variability suppliers are flagged.
  const iqrMedian = roster.length ? median(roster.map((r) => r.iqr)) : 0;
  const cutoff = iqrMedian * 1.5;
  const outlierSup = new Set(anomalies.map((a) => a.supplier_id));
  const stageDomSup = new Set(stageAnomalies.map((a) => a.supplier_id));

  const flagsBySupplier = new Map<string, SupplierFlagState>();
  for (const r of roster) {
    flagsBySupplier.set(r.supplier_id, {
      has_outlier: outlierSup.has(r.supplier_id),
      inconsistent: r.iqr > cutoff,
      has_stage_dom: stageDomSup.has(r.supplier_id),
    });
  }

  const flagCounts: Record<CycleFlagKey, number> = {
    has_outlier: 0,
    inconsistent: 0,
    has_stage_dom: 0,
  };
  for (const f of flagsBySupplier.values()) {
    if (f.has_outlier) flagCounts.has_outlier++;
    if (f.inconsistent) flagCounts.inconsistent++;
    if (f.has_stage_dom) flagCounts.has_stage_dom++;
  }

  const flagPoCounts: Partial<Record<CycleFlagKey, number>> = {
    has_outlier: anomalies.length,
    has_stage_dom: stageAnomalies.length,
  };

  return {
    flagsBySupplier,
    flagCounts,
    flagPoCounts,
    iqrCutoff: roster.length ? cutoff : null,
  };
}
