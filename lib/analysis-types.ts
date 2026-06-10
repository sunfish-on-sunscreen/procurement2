import { prisma } from "@/lib/prisma";

export type SpendOverviewResult = {
  total_spend: number;
  total_pos: number;
  active_suppliers: number;
  avg_cycle_time: number;
  by_category: { category: string; total: number }[];
  top_suppliers: { supplier_name: string; total: number }[];
  monthly_trend: { month: string; total: number }[];
};

export type AbcClassification = {
  supplier_id: string;
  supplier_name: string;
  tier: string;
  total: number;
  rank: number;
  pct: number;
  cumulative_pct: number;
  abc_class: "A" | "B" | "C";
};

export type AbcResult = {
  thresholds: [number, number];
  classifications: AbcClassification[];
  summary: {
    A: { n: number; total_spend: number; pct_of_spend: number };
    B: { n: number; total_spend: number; pct_of_spend: number };
    C: { n: number; total_spend: number; pct_of_spend: number };
  };
  crosstab: Record<string, Record<string, number>>; // tier -> abc_class -> count
};

/**
 * Fetch a pre-computed AnalysisResult's resultJson, typed as T, or null if it
 * has not been computed for the period yet.
 */
export async function getAnalysisResult<T>(
  periodId: string,
  analysisType: string,
): Promise<T | null> {
  const row = await prisma.analysisResult.findUnique({
    where: { periodId_analysisType: { periodId, analysisType } },
    select: { resultJson: true },
  });
  if (!row) return null;
  return row.resultJson as unknown as T;
}
