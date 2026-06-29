import type { KraljicQuadrant } from "@/lib/analysis-types";

/** One row of the Spend Overview supplier ranking table (period/range-scoped). */
export type SupplierRankingRow = {
  supplier_id: string;
  supplier_name: string;
  category: string | null;
  tier: string | null;
  total_spend: number;
  po_count: number;
  avg_po_value: number;
  abc_class: "A" | "B" | "C" | null;
  kraljic_quadrant: KraljicQuadrant | null;
  rank: number;
  // True when the supplier has no purchases in the selected period (rendered
  // muted, ranked last). The supplier still exists (identity + snapshot score).
  inactive: boolean;
};

/** Per-supplier spend decomposition (all-time) for the drill-down panel. */
export type SpendDetail = {
  supplier: {
    id: string;
    name: string;
    category: string | null;
    tier: string | null;
    country: string | null;
    // ABC class + Kraljic quadrant for the SELECTED period (period-scoped, matches
    // the ranking table). Null when the supplier is absent from that period.
    abcClass: "A" | "B" | "C" | null;
    kraljicQuadrant: KraljicQuadrant | null;
    // Period-scoped performance (P2). `score` is the SELECTED period's composite
    // (single-year) or the range composite (range, computed from aggregated raw
    // inputs). `previousScore` drives the single-year delta arrow; `latestScore`
    // is the latest-period snapshot shown alongside a range composite. In the
    // no-span (all-time) fallback, `score` is the latest snapshot.
    performance: {
      score: number | null;
      mode: "single" | "range" | "all";
      periodLabel: string | null;
      previousScore: number | null;
      previousLabel: string | null;
      latestScore: number | null;
      latestLabel: string | null;
    };
    // Period-scoped sub-score breakdown (P2 methodology: quality/delivery/
    // service/process/risk, each 0–100). Used by the Supplier Classification
    // detail panel; the Spend Overview panel ignores it. Null when no metric row
    // exists for the resolved period.
    subScores: {
      quality: number;
      delivery: number;
      service: number;
      process: number;
      risk: number;
    } | null;
  };
  stats: {
    totalSpend: number;
    poCount: number;
    earliestDate: string | null;
    latestDate: string | null;
    avgPoValue: number;
    // Period-scoped portfolio context for the Spend insights cards. `rank` is the
    // 1-based position by spend among active suppliers (null when absent);
    // `percentOfTotal` is this supplier's share of period spend; `activeSupplierCount`
    // is the number of suppliers with any spend in the period.
    rank: number | null;
    percentOfTotal: number | null;
    activeSupplierCount: number;
  };
  byItem: { itemDescription: string; poCount: number; totalSpend: number }[];
  pos: {
    poId: string;
    itemDescription: string;
    prDate: string | null;
    invoiceDate: string | null;
    quantity: number;
    unit: string;
    unitPriceUsd: number;
    totalValueUsd: number;
  }[];
};

/** Year-by-year supplier trajectory (all years; not period-scoped). */
export type SupplierEvolution = {
  supplier: { id: string; name: string };
  periods: {
    year: string;
    periodLabel: string;
    spend: number;
    invoiceCount: number;
    abcClass: "A" | "B" | "C" | null;
    kraljicQuadrant: KraljicQuadrant | null;
    performanceScore: number | null;
    // Per-period sub-scores (P2) — null when the supplier has no metric row that
    // period. Feeds the sub-score trajectory cards in the performance expand.
    subScores: {
      quality: number;
      delivery: number;
      service: number;
      process: number;
      risk: number;
    } | null;
    topItems: { itemDescription: string; spend: number; count: number }[];
  }[];
  insights: string[];
};
