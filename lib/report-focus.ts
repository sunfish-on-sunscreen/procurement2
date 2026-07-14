import "server-only";
import { prisma } from "@/lib/prisma";
import {
  getAnalysisResult,
  type AbcResult,
  type KraljicResult,
  type PerformanceSpendResult,
} from "@/lib/analysis-types";
import type { SupplierFocusData } from "@/lib/report-focus-types";

/**
 * Assemble the per-supplier data a Focus → supplier BRIEF needs — the item
 * breakdown (what you buy) and the year-by-year trajectory — for a report span.
 *
 * READ-ONLY and no recompute: it runs the SAME queries the modal's routes run, so
 * the numbers are identical to UnifiedSupplierDetailModal, but it does NOT touch
 * those routes:
 *   - itemBreakdown mirrors app/api/suppliers/[id]/spend-detail (byItem): purchases
 *     in the span by paymentDate, grouped by item, summed + counted, sorted desc.
 *   - trajectory mirrors app/api/suppliers/[id]/evolution: all periods, purchases
 *     bucketed by (paymentDate ?? prDate) within each period's bounds, with ABC /
 *     Kraljic / performance read from that period's cached (Mode A) analyses.
 *
 * The identity/position/anomaly/recommendation parts of the brief come from the
 * analyses the report already carries — only these two per-supplier cuts need a
 * dedicated read.
 */
export async function assembleSupplierFocus(
  supplierId: string,
  startDate: string,
  endDate: string,
): Promise<SupplierFocusData> {
  // --- item breakdown (span-scoped) — mirrors spend-detail's byItem ----------
  // paymentDate is non-null here, so filtering it matches the
  // COALESCE(paymentDate, prDate) period tag the rest of the app uses. Bounds
  // parsed exactly as the spend-detail route does (local T00:00:00 / T23:59:59).
  const dateFilter = {
    gte: new Date(`${startDate}T00:00:00`),
    lte: new Date(`${endDate}T23:59:59`),
  };
  const spanPurchases = await prisma.purchase.findMany({
    where: { supplierExternalId: supplierId, paymentDate: dateFilter },
    select: { itemName: true, totalValueUsd: true },
  });

  let totalSpend = 0;
  const byItemMap = new Map<string, { poCount: number; totalSpend: number }>();
  for (const p of spanPurchases) {
    totalSpend += p.totalValueUsd;
    const cur = byItemMap.get(p.itemName) ?? { poCount: 0, totalSpend: 0 };
    cur.poCount += 1;
    cur.totalSpend += p.totalValueUsd;
    byItemMap.set(p.itemName, cur);
  }
  const itemBreakdown = [...byItemMap.entries()]
    .map(([itemName, v]) => ({ itemName, ...v }))
    .sort((a, b) => b.totalSpend - a.totalSpend);

  // --- YoY trajectory — mirrors the evolution route (all periods) ------------
  // Identity (name/category/country) comes from the Supplier master row (latest),
  // the same source the spend-detail route uses for the panel header.
  const [periods, allPurchases, supplier] = await Promise.all([
    prisma.reportingPeriod.findMany({
      orderBy: { startDate: "asc" },
      select: { id: true, name: true, startDate: true, endDate: true },
    }),
    prisma.purchase.findMany({
      where: { supplierExternalId: supplierId },
      select: { totalValueUsd: true, paymentDate: true, prDate: true },
    }),
    prisma.supplier.findFirst({
      where: { externalId: supplierId },
      orderBy: { periodId: "desc" },
      select: { supplierName: true, category: true, country: true },
    }),
  ]);

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

  const trajectory = analysesByPeriod.map(({ period, abc, kraljic, perf }) => {
    const inPeriod = allPurchases.filter((pu) => {
      const d = pu.paymentDate ?? pu.prDate;
      return d != null && d >= period.startDate && d <= period.endDate;
    });
    const spend = inPeriod.reduce((s, pu) => s + pu.totalValueUsd, 0);
    return {
      year: period.name,
      spend,
      invoiceCount: inPeriod.length,
      abcClass:
        abc?.classifications.find((c) => c.supplier_id === supplierId)?.abc_class ??
        null,
      kraljicQuadrant:
        kraljic?.quadrant_assignments.find((q) => q.supplier_id === supplierId)
          ?.quadrant ?? null,
      performanceScore:
        perf?.suppliers.find((s) => s.supplier_id === supplierId)
          ?.performance_score ?? null,
    };
  });

  return {
    supplierId,
    name: supplier?.supplierName ?? supplierId,
    category: supplier?.category ?? null,
    country: supplier?.country ?? null,
    itemBreakdown,
    totalSpend,
    poCount: spanPurchases.length,
    trajectory,
  };
}
