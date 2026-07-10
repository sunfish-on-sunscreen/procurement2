/**
 * Supplier selection — a best-supplier-per-category recommendation engine. The
 * decision-support counterpart to the Cross-Analysis Anomaly Hub (the diagnostic
 * half). PURE: blends three EXISTING signals into a transparent, weighted fit
 * score per supplier, ranked within each procurement category. No new fundamental
 * scoring — it reuses the composite (Performance), the Kraljic supply-risk
 * (Safety), and the Kraljic cost-premium benchmark (PriceValue).
 *
 *   fit = 0.50·Performance + 0.30·Safety + 0.20·PriceValue   (all 0–100)
 *     Performance = perf.performance_score (composite).
 *     Safety      = 100 − Kraljic supply_risk_score (lower risk → higher safety).
 *     PriceValue  = 100 − cost_premium×4  (cost_premium is the 0–25 Kraljic term).
 *
 * ⚠️ PRICEVALUE IS AN OVERPRICING PENALTY, NOT A "CHEAPNESS" REWARD. The source
 * cost_premium clips below-market to 0, so at-market, below-market, AND un-
 * benchmarked suppliers all score PriceValue 100 — only measured above-benchmark
 * pricing is docked. It reads as "how much you're NOT overpaying", not "cheapest".
 * (A signed price-from-Purchase signal that rewards cheapness is a future
 * refinement — see CLAUDE.md; deliberately out of this batch.)
 *
 * No fetch, no DB — the caller passes the span-scoped analysis data + the global
 * category/country maps.
 */

import type {
  PerformanceSpendSupplier,
  QuadrantAssignment,
  KraljicQuadrant,
  PerformanceZone,
} from "@/lib/analysis-types";
import type { AbcClass } from "@/lib/cycle-time-types";

/** Blend weights (named so they're tunable). Sum to 1. */
export const SELECTION_WEIGHTS = { perf: 0.5, safety: 0.3, price: 0.2 } as const;

export type SelectionComponents = { perf: number; safety: number; price: number };

export type SelectionSupplier = {
  supplier_id: string;
  supplier_name: string;
  fit_score: number;
  components: SelectionComponents;
  /** Raw Kraljic cost-premium (0–25). 0 = at/below market OR un-benchmarked. */
  cost_premium: number;
  /** True when a measured premium exists (cost_premium > 0); false = ambiguous 0. */
  benchmarked: boolean;
  /** Top of its category by fit_score. */
  recommended: boolean;
  /** Plain-language reasoning derived from the component pattern. */
  why: string;
  // meta
  abc_class: AbcClass | null;
  kraljic_quadrant: KraljicQuadrant | null;
  zone: PerformanceZone | null;
  total_spend_usd: number;
  country: string | null;
};

export type CategorySelection = {
  category: string;
  /** Ranked by fit_score desc. */
  suppliers: SelectionSupplier[];
  supplierCount: number;
  /** Combined spend of the category's candidates (for ordering + context). */
  categorySpend: number;
  soleSource: boolean; // exactly 1 supplier — no alternatives
  thinData: boolean; // ≤2 suppliers — interpret with care
};

export type SupplierSelectionResult = {
  /** Categories, most-spend first. */
  categories: CategorySelection[];
};

const clamp = (v: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, v));
const round1 = (v: number) => Math.round(v * 10) / 10;
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** PriceValue (0–100) from the 0–25 cost-premium: 0 → 100, 25 → 0. */
export function priceValueFromPremium(costPremium: number): number {
  return clamp(100 - costPremium * 4, 0, 100);
}

/**
 * Plain-language "why" from the component pattern. Describes performance, supply
 * risk, and pricing-vs-benchmark honestly (pricing is framed as not-overpaying).
 */
function whyFor(c: SelectionComponents, costPremium: number): string {
  const perfDesc =
    c.perf >= 85 ? "top performer" : c.perf >= 70 ? "solid performer" : "middling performance";
  const safeDesc =
    c.safety >= 90 ? "low supply risk" : c.safety >= 70 ? "moderate supply risk" : "higher supply risk";
  const priceDesc =
    costPremium <= 0.5
      ? "prices at or below the category benchmark"
      : costPremium <= 5
        ? "prices slightly above the category benchmark"
        : "prices well above the category benchmark";

  // Shortcut for an all-round strong candidate.
  if (c.perf >= 80 && c.safety >= 85 && costPremium <= 1) {
    return "Strong on all three — top performance, low supply risk, and no price premium.";
  }
  return `${cap(perfDesc)}, ${safeDesc}, ${priceDesc}.`;
}

/**
 * Build the per-category ranked supplier selection. Suppliers need both a
 * performance row and a Kraljic row to be scored (missing either → skipped).
 * Categories are returned most-spend-first; suppliers within each ranked by fit.
 */
export function buildSupplierSelection(
  input: {
    perfSuppliers: PerformanceSpendSupplier[];
    quadrantAssignments: QuadrantAssignment[];
    abcById: Map<string, AbcClass>;
    categoryById: Map<string, string>;
    countryById: Map<string, string>;
  },
  weights: { perf: number; safety: number; price: number } = SELECTION_WEIGHTS,
): SupplierSelectionResult {
  const { perfSuppliers, quadrantAssignments, abcById, categoryById, countryById } = input;
  const krById = new Map(quadrantAssignments.map((q) => [q.supplier_id, q]));

  const byCategory = new Map<string, SelectionSupplier[]>();
  for (const p of perfSuppliers) {
    const category = categoryById.get(p.supplier_id);
    const kr = krById.get(p.supplier_id);
    if (!category || !kr) continue; // need a category + a risk row to score

    const perf = p.performance_score;
    const safety = clamp(100 - kr.supply_risk_score, 0, 100);
    const costPremium = kr.risk_components?.cost_premium ?? 0;
    const price = priceValueFromPremium(costPremium);
    const components: SelectionComponents = {
      perf: round1(perf),
      safety: round1(safety),
      price: round1(price),
    };
    const fit_score = round1(weights.perf * perf + weights.safety * safety + weights.price * price);

    const row: SelectionSupplier = {
      supplier_id: p.supplier_id,
      supplier_name: p.supplier_name,
      fit_score,
      components,
      cost_premium: round1(costPremium),
      benchmarked: costPremium > 0,
      recommended: false, // set after sort
      why: whyFor(components, costPremium),
      abc_class: abcById.get(p.supplier_id) ?? null,
      kraljic_quadrant: p.kraljic_quadrant ?? kr.quadrant ?? null,
      zone: p.zone ?? null,
      total_spend_usd: p.total_spend_usd,
      country: countryById.get(p.supplier_id) ?? null,
    };
    const list = byCategory.get(category) ?? [];
    list.push(row);
    byCategory.set(category, list);
  }

  const categories: CategorySelection[] = [];
  for (const [category, suppliers] of byCategory) {
    // Rank by fit; tie-break on performance, then spend, then a stable id.
    suppliers.sort(
      (a, b) =>
        b.fit_score - a.fit_score ||
        b.components.perf - a.components.perf ||
        b.total_spend_usd - a.total_spend_usd ||
        (a.supplier_id < b.supplier_id ? -1 : a.supplier_id > b.supplier_id ? 1 : 0),
    );
    if (suppliers.length > 0) suppliers[0].recommended = true;
    const categorySpend = suppliers.reduce((s, x) => s + x.total_spend_usd, 0);
    categories.push({
      category,
      suppliers,
      supplierCount: suppliers.length,
      categorySpend,
      soleSource: suppliers.length === 1,
      thinData: suppliers.length <= 2,
    });
  }

  categories.sort((a, b) => b.categorySpend - a.categorySpend);
  return { categories };
}
