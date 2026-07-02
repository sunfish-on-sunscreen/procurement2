import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import {
  getAnalysisResult,
  type AbcResult,
  type KraljicResult,
  type PerformanceSpendResult,
} from "@/lib/analysis-types";
import type { SupplierEvolution } from "@/lib/spend-overview-types";

export const runtime = "nodejs";

const pct = (from: number, to: number) =>
  from > 0 ? Math.round(((to - from) / from) * 100) : null;

/**
 * Year-by-year trajectory for one supplier: spend, invoice count, ABC class,
 * Kraljic quadrant, performance score, and top items per period. Built from the
 * per-period (Mode A) analyses + the Purchase table. NOT period-scoped — always
 * all available years. Login required (read-only); any role.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  const [periods, purchases, metricRows] = await Promise.all([
    prisma.reportingPeriod.findMany({
      orderBy: { startDate: "asc" },
      select: { id: true, name: true, startDate: true, endDate: true },
    }),
    prisma.purchase.findMany({
      where: { supplierExternalId: id },
      select: {
        itemDescription: true,
        totalValueUsd: true,
        paymentDate: true,
        prDate: true,
        supplierName: true,
      },
    }),
    // Per-period sub-scores (P2) for the sub-score trajectory cards.
    prisma.supplierMetric.findMany({
      where: { supplierExternalId: id },
      select: {
        periodId: true,
        supplierName: true,
        qualityScore: true,
        deliveryScore: true,
        serviceScore: true,
        processScore: true,
        riskScore: true,
      },
    }),
  ]);

  if (purchases.length === 0) {
    return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  }

  const metric = metricRows[0] ?? null;
  // periodId → that period's five sub-scores.
  const subByPeriod = new Map(
    metricRows.map((m) => [
      m.periodId,
      {
        quality: m.qualityScore,
        delivery: m.deliveryScore,
        service: m.serviceScore,
        process: m.processScore,
        risk: m.riskScore,
      },
    ]),
  );

  // Read each period's analyses in parallel.
  const analysesByPeriod = await Promise.all(
    periods.map(async (p) => {
      const [abc, kraljic, perf] = await Promise.all([
        getAnalysisResult<AbcResult>(p.id, "abc"),
        getAnalysisResult<KraljicResult>(p.id, "kraljic"),
        getAnalysisResult<PerformanceSpendResult>(p.id, "performance_spend"),
      ]);
      return { period: p, abc, kraljic, perf };
    }),
  );

  const periodsOut: SupplierEvolution["periods"] = analysesByPeriod.map(
    ({ period, abc, kraljic, perf }) => {
      const inPeriod = purchases.filter((pu) => {
        const d = pu.paymentDate ?? pu.prDate;
        return d != null && d >= period.startDate && d <= period.endDate;
      });
      let spend = 0;
      const itemMap = new Map<string, { spend: number; count: number }>();
      for (const pu of inPeriod) {
        spend += pu.totalValueUsd;
        const cur = itemMap.get(pu.itemDescription) ?? { spend: 0, count: 0 };
        cur.spend += pu.totalValueUsd;
        cur.count += 1;
        itemMap.set(pu.itemDescription, cur);
      }
      const topItems = [...itemMap.entries()]
        .map(([itemDescription, v]) => ({ itemDescription, ...v }))
        .sort((a, b) => b.spend - a.spend)
        .slice(0, 5);

      return {
        year: period.name,
        periodLabel: period.name,
        spend,
        invoiceCount: inPeriod.length,
        abcClass:
          abc?.classifications.find((c) => c.supplier_id === id)?.abc_class ??
          null,
        kraljicQuadrant:
          kraljic?.quadrant_assignments.find((q) => q.supplier_id === id)
            ?.quadrant ?? null,
        performanceScore:
          perf?.suppliers.find((s) => s.supplier_id === id)?.performance_score ??
          null,
        subScores: subByPeriod.get(period.id) ?? null,
        topItems,
      };
    },
  );

  // Lightweight insights from active periods.
  const insights: string[] = [];
  const active = periodsOut.filter((p) => p.spend > 0 || p.invoiceCount > 0);
  if (active.length > 0) {
    insights.push(`First active in ${active[0].year}.`);
    if (active.length >= 2) {
      const first = active[0];
      const last = active[active.length - 1];
      const g = pct(first.spend, last.spend);
      if (g != null) {
        insights.push(
          `Spend ${g >= 0 ? "grew" : "fell"} ${Math.abs(g)}% from ${first.year} to ${last.year}.`,
        );
      }
      const classes = [...new Set(active.map((p) => p.abcClass).filter(Boolean))];
      const quads = [...new Set(active.map((p) => p.kraljicQuadrant).filter(Boolean))];
      if (classes.length === 1 && quads.length === 1) {
        insights.push(`Consistently ${classes[0]} / ${quads[0]} across active years.`);
      } else {
        insights.push("Classification changed across years.");
      }
    }
  }
  if (active.length === 1) {
    insights.push(
      `Limited evolution data — supplier active only in ${active[0].year}.`,
    );
  }

  const evolution: SupplierEvolution = {
    supplier: { id, name: metric?.supplierName ?? purchases[0].supplierName },
    periods: periodsOut,
    insights,
  };
  return NextResponse.json(evolution);
}
