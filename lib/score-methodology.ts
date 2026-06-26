/**
 * TypeScript port of the supplier-scorecard formulas in
 * `scripts/transform_dataset.py` (the Python transformer is the source of
 * truth). Used to compute a RANGE composite on demand — aggregate the raw
 * inputs across a multi-period span, then apply these fixed-bound formulas
 * (Decision A7) — without re-running the transformer. Single-period scores are
 * read straight from `SupplierMetric.compositeScore` (already computed per
 * period), so this is only exercised for ranges.
 *
 * ⚠️ Keep in lock-step with transform_dataset.py: fixed bounds, weights
 * 0.25/0.25/0.15/0.20/0.15, sub-scores rounded to 2dp BEFORE the composite.
 */

const round2 = (x: number) => Math.round(x * 100) / 100;
const clamp01 = (x: number) => Math.max(0, Math.min(1, x));
const normHigh = (v: number, lo: number, hi: number) => clamp01((v - lo) / (hi - lo)) * 100;
const normLow = (v: number, lo: number, hi: number) => clamp01((hi - v) / (hi - lo)) * 100;

/** Geographic supply-risk tiers, 0 (safest) … 100 (riskiest) — Decision C. */
function countryDistanceScore(code: string): number {
  const c = (code || "").trim().toUpperCase();
  if (c === "ID" || c === "INDONESIA") return 0;
  if (["SG", "MY", "TH", "VN", "PH"].includes(c)) return 30;
  if (["CN", "JP", "KR", "AU", "IN"].includes(c)) return 60;
  return 100;
}

export type ScoreInputs = {
  defectRatePct: number;
  complaintCountAnnual: number;
  onTimeDeliveryPct: number;
  avgLeadTimeDays: number;
  avgResponseTimeDays: number;
  rfxResponseRatePct: number;
  threeWayMatchPct: number;
  singleSourceRisk: number;
  country: string;
};

export type ScoreBreakdown = {
  qualityScore: number;
  deliveryScore: number;
  serviceScore: number;
  processScore: number;
  riskScore: number;
  compositeScore: number;
};

/** Compute the five sub-scores + composite from raw inputs (fixed bounds). */
export function computeScores(i: ScoreInputs): ScoreBreakdown {
  const qualityScore = round2(
    (normLow(i.defectRatePct, 0, 10) + normLow(i.complaintCountAnnual, 0, 10)) / 2,
  );
  const deliveryScore = round2(
    (normHigh(i.onTimeDeliveryPct, 0, 100) + normLow(i.avgLeadTimeDays, 0, 60)) / 2,
  );
  const serviceScore = round2(
    (normLow(i.avgResponseTimeDays, 0, 14) + normHigh(i.rfxResponseRatePct, 0, 100)) / 2,
  );
  const processScore = round2(normHigh(i.threeWayMatchPct, 0, 100));
  const country = countryDistanceScore(i.country);
  const complaint = Math.min(i.complaintCountAnnual * 10, 100);
  const concentration = i.singleSourceRisk * 100;
  const riskScore = round2(
    Math.max(0, Math.min(100, 100 - (0.4 * country + 0.3 * complaint + 0.3 * concentration))),
  );
  const compositeScore = round2(
    0.25 * qualityScore +
      0.25 * deliveryScore +
      0.15 * serviceScore +
      0.2 * processScore +
      0.15 * riskScore,
  );
  return { qualityScore, deliveryScore, serviceScore, processScore, riskScore, compositeScore };
}
