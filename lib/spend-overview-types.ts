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
};

/** Per-supplier spend decomposition (all-time) for the drill-down panel. */
export type SpendDetail = {
  supplier: {
    id: string;
    name: string;
    category: string | null;
    tier: string | null;
    country: string | null;
    abcClass: "A" | "B" | "C" | null;
    kraljicQuadrant: KraljicQuadrant | null;
    // Latest-period SupplierMetric snapshot (composite 0-100; declared vs
    // calculated tier + mismatch flag). Null when no metric row exists.
    performanceScore: number | null;
    calculatedTier: string | null;
    tierMismatch: boolean;
  };
  stats: {
    totalSpend: number;
    poCount: number;
    earliestDate: string | null;
    latestDate: string | null;
    avgPoValue: number;
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
    topItems: { itemDescription: string; spend: number; count: number }[];
  }[];
  insights: string[];
};
