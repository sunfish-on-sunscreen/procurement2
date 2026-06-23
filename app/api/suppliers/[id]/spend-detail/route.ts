import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import {
  getAnalysisResult,
  type AbcResult,
  type KraljicResult,
} from "@/lib/analysis-types";
import type { SpendDetail } from "@/lib/spend-overview-types";

export const runtime = "nodejs";

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * All-time spend decomposition for one supplier (by externalId): identity +
 * stats + spend-by-item + every PO. ABC/Kraljic badges reflect the latest
 * period's classification. Login required (read-only); any role.
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  // Optional period scope (Batch: polish). Both must be valid YYYY-MM-DD with
  // end >= start; omit either for all-time (backward compat). invoiceDate is
  // non-null in this schema, so filtering it matches the COALESCE(invoiceDate,
  // prDate) period tag used by the ranking aggregate.
  const sp = new URL(request.url).searchParams;
  const start = sp.get("start");
  const end = sp.get("end");
  let dateFilter: { gte: Date; lte: Date } | undefined;
  if (start || end) {
    if (!start || !end || !DATE_RE.test(start) || !DATE_RE.test(end)) {
      return NextResponse.json(
        { error: "start and end must both be YYYY-MM-DD" },
        { status: 400 },
      );
    }
    if (end < start) {
      return NextResponse.json(
        { error: "end must be on or after start" },
        { status: 400 },
      );
    }
    dateFilter = {
      gte: new Date(`${start}T00:00:00`),
      lte: new Date(`${end}T23:59:59`),
    };
  }

  const purchases = await prisma.purchase.findMany({
    where: {
      supplierExternalId: id,
      ...(dateFilter ? { invoiceDate: dateFilter } : {}),
    },
    select: {
      poId: true,
      supplierName: true,
      itemDescription: true,
      unit: true,
      quantity: true,
      unitPriceUsd: true,
      totalValueUsd: true,
      prDate: true,
      invoiceDate: true,
    },
  });

  if (purchases.length === 0) {
    return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  }

  // Identity: current tier/category from SupplierMetric, country from Supplier.
  const [metric, supplier, latestPeriod] = await Promise.all([
    prisma.supplierMetric.findFirst({
      where: { supplierExternalId: id },
      orderBy: { periodId: "desc" },
      select: {
        supplierName: true,
        category: true,
        tier: true,
        compositeScore: true,
        calculatedTier: true,
        tierMismatch: true,
      },
    }),
    prisma.supplier.findFirst({
      where: { externalId: id },
      orderBy: { periodId: "desc" },
      select: { country: true, category: true },
    }),
    prisma.reportingPeriod.findFirst({
      orderBy: { startDate: "desc" },
      select: { id: true },
    }),
  ]);

  // Badges from the latest period's analyses.
  let abcClass: SpendDetail["supplier"]["abcClass"] = null;
  let kraljicQuadrant: SpendDetail["supplier"]["kraljicQuadrant"] = null;
  if (latestPeriod) {
    const [abc, kraljic] = await Promise.all([
      getAnalysisResult<AbcResult>(latestPeriod.id, "abc"),
      getAnalysisResult<KraljicResult>(latestPeriod.id, "kraljic"),
    ]);
    abcClass =
      abc?.classifications.find((c) => c.supplier_id === id)?.abc_class ?? null;
    kraljicQuadrant =
      kraljic?.quadrant_assignments.find((q) => q.supplier_id === id)
        ?.quadrant ?? null;
  }

  // Stats + spend-by-item, aggregated in JS over the supplier's POs.
  let totalSpend = 0;
  let earliest: Date | null = null;
  let latest: Date | null = null;
  const byItemMap = new Map<string, { poCount: number; totalSpend: number }>();
  for (const p of purchases) {
    totalSpend += p.totalValueUsd;
    const d = p.invoiceDate ?? p.prDate;
    if (d && (!earliest || d < earliest)) earliest = d;
    if (d && (!latest || d > latest)) latest = d;
    const cur = byItemMap.get(p.itemDescription) ?? { poCount: 0, totalSpend: 0 };
    cur.poCount += 1;
    cur.totalSpend += p.totalValueUsd;
    byItemMap.set(p.itemDescription, cur);
  }

  const byItem = [...byItemMap.entries()]
    .map(([itemDescription, v]) => ({ itemDescription, ...v }))
    .sort((a, b) => b.totalSpend - a.totalSpend);

  const pos = purchases
    .map((p) => ({
      poId: p.poId,
      itemDescription: p.itemDescription,
      prDate: iso(p.prDate),
      invoiceDate: iso(p.invoiceDate),
      quantity: p.quantity,
      unit: p.unit,
      unitPriceUsd: p.unitPriceUsd,
      totalValueUsd: p.totalValueUsd,
    }))
    .sort((a, b) =>
      (b.invoiceDate ?? b.prDate ?? "").localeCompare(
        a.invoiceDate ?? a.prDate ?? "",
      ),
    );

  const detail: SpendDetail = {
    supplier: {
      id,
      name: metric?.supplierName ?? purchases[0].supplierName,
      category: metric?.category ?? supplier?.category ?? null,
      tier: metric?.tier ?? null,
      country: supplier?.country ?? null,
      abcClass,
      kraljicQuadrant,
      performanceScore: metric?.compositeScore ?? null,
      calculatedTier: metric?.calculatedTier ?? null,
      tierMismatch: metric?.tierMismatch ?? false,
    },
    stats: {
      totalSpend,
      poCount: purchases.length,
      earliestDate: iso(earliest),
      latestDate: iso(latest),
      avgPoValue: purchases.length > 0 ? totalSpend / purchases.length : 0,
    },
    byItem,
    pos,
  };

  return NextResponse.json(detail);
}
