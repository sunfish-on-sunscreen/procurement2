import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getRangeAnalyses } from "@/lib/range-analyses";
import { getSupplierCategoryMap } from "@/lib/suppliers";
import {
  getAnalysisResult,
  type AbcResult,
  type KraljicResult,
  type KraljicQuadrant,
  type PerformanceSpendResult,
} from "@/lib/analysis-types";
import type {
  ClassificationPageData,
  ClassificationPrevSummary,
  ClassificationRankingRow,
} from "@/lib/supplier-classification-types";

export const runtime = "nodejs";

/**
 * Supplier Classification page data for a date span: the Kraljic + Performance
 * analyses (for the two tab visualizations + the cross-classification synthesis)
 * plus a combined per-supplier ranking. Mirrors /api/spend-overview — same
 * getRangeAnalyses source, so single-year and range modes are uniform and
 * period-scoped. Login required (read-only); any role.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { startDate, endDate } = (body ?? {}) as {
    startDate?: string;
    endDate?: string;
  };
  if (!startDate || !endDate) {
    return NextResponse.json(
      { error: "startDate and endDate are required" },
      { status: 400 },
    );
  }

  const analyses = await getRangeAnalyses(startDate, endDate);
  if (!analyses || !analyses.performance_spend) {
    return NextResponse.json(
      { error: "No classification data for this period." },
      { status: 400 },
    );
  }

  const perf = analyses.performance_spend;
  const abc = (analyses.abc as AbcResult | null) ?? null;
  const abcBySupplier = new Map(
    (abc?.classifications ?? []).map((c) => [c.supplier_id, c]),
  );
  const categoryMap = await getSupplierCategoryMap();
  const perfBySupplier = new Map(perf.suppliers.map((s) => [s.supplier_id, s]));

  // Full supplier roster (one row per supplier) so suppliers ABSENT from the
  // period still appear (muted, ranked last) — mirrors the Spend Overview
  // ranking. Active suppliers (present in the performance set) carry their
  // Kraljic quadrant + composite + ABC class + spend; absent ones are zeroed.
  const roster = await prisma.supplierMetric.findMany({
    select: { supplierExternalId: true, supplierName: true, tier: true },
    distinct: ["supplierExternalId"],
    orderBy: { periodId: "desc" },
  });

  const ranking: ClassificationRankingRow[] = roster
    .map((r) => {
      const ps = perfBySupplier.get(r.supplierExternalId);
      return {
        supplier_id: r.supplierExternalId,
        supplier_name: ps?.supplier_name ?? r.supplierName,
        category: categoryMap[r.supplierExternalId] ?? null,
        tier: ps?.tier ?? r.tier ?? null,
        abc_class: abcBySupplier.get(r.supplierExternalId)?.abc_class ?? null,
        kraljic_quadrant: ps?.kraljic_quadrant ?? null,
        performance_score: ps?.performance_score ?? null,
        total_spend: ps?.total_spend_usd ?? 0,
        inactive: !ps,
      };
    })
    .sort((a, b) => b.total_spend - a.total_spend);

  // Prior-period summary for the glance YoY finding (single-year mode only).
  // The span matches a single reporting period iff its start/end equal that
  // period's dates; otherwise it's a multi-period range and there is no YoY.
  const periods = await prisma.reportingPeriod.findMany({
    orderBy: { startDate: "asc" },
    select: { id: true, name: true, startDate: true, endDate: true },
  });
  const toIso = (d: Date) => d.toISOString().slice(0, 10);
  const selIdx = periods.findIndex(
    (p) => toIso(p.startDate) === startDate && toIso(p.endDate) === endDate,
  );
  let previous: ClassificationPrevSummary | null = null;
  if (selIdx > 0) {
    const prior = periods[selIdx - 1];
    const [pk, pp] = await Promise.all([
      getAnalysisResult<KraljicResult>(prior.id, "kraljic"),
      getAnalysisResult<PerformanceSpendResult>(prior.id, "performance_spend"),
    ]);
    if (pp && pp.suppliers.length > 0) {
      const avg =
        pp.suppliers.reduce((acc, x) => acc + x.performance_score, 0) / pp.suppliers.length;
      const counts: Record<KraljicQuadrant, number> = {
        Strategic: 0,
        Leverage: 0,
        Bottleneck: 0,
        Routine: 0,
      };
      for (const qp of pk?.quadrant_profiles ?? []) counts[qp.quadrant] = qp.n_suppliers;
      previous = { periodLabel: prior.name, avg_performance: avg, quadrant_counts: counts };
    }
  }

  const data: ClassificationPageData = {
    kraljic: analyses.kraljic ?? null,
    performance_spend: perf,
    abc,
    ranking,
    previous,
  };
  return NextResponse.json(data);
}
