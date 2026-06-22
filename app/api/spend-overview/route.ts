import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { getRangeAnalyses } from "@/lib/range-analyses";
import { getSupplierCategoryMap } from "@/lib/suppliers";
import type { AbcResult, KraljicResult } from "@/lib/analysis-types";
import type { SupplierRankingRow } from "@/lib/spend-overview-types";
import { Prisma } from "@/lib/generated/prisma/client";

export const runtime = "nodejs";

/**
 * Spend Overview page data for a date span: the cached spend_overview analysis
 * (charts) plus a server-side supplier ranking. The ranking aggregates Purchase
 * by supplier over the span (spend / PO count / avg), merged with ABC class +
 * Kraljic quadrant from the analyses and category from the supplier catalog.
 * Login required (read-only); any role.
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
  if (!analyses || !analyses.spend_overview) {
    return NextResponse.json(
      { error: "No spend data for this period." },
      { status: 400 },
    );
  }

  const abc = analyses.abc as AbcResult | null;
  const kraljic = analyses.kraljic as KraljicResult | null;
  const abcBySupplier = new Map(
    (abc?.classifications ?? []).map((c) => [c.supplier_id, c]),
  );
  const quadrantBySupplier = new Map(
    (kraljic?.quadrant_assignments ?? []).map((q) => [q.supplier_id, q]),
  );
  const categoryById = await getSupplierCategoryMap();

  // Per-supplier Purchase aggregate over the span. Filter mirrors the Python
  // load (COALESCE(invoiceDate, prDate)) so totals reconcile with spend_overview.
  const start = new Date(`${startDate}T00:00:00`);
  const end = new Date(`${endDate}T23:59:59`);
  const agg = await prisma.$queryRaw<
    { id: string; name: string; po_count: number; total_spend: number }[]
  >(Prisma.sql`
    SELECT "supplierExternalId" AS id,
           MAX("supplierName") AS name,
           COUNT(*)::int AS po_count,
           SUM("totalValueUsd")::float8 AS total_spend
    FROM "Purchase"
    WHERE COALESCE("invoiceDate", "prDate") >= ${start}
      AND COALESCE("invoiceDate", "prDate") <= ${end}
    GROUP BY "supplierExternalId"
  `);

  const ranking: SupplierRankingRow[] = agg
    .map((r) => {
      const abcRow = abcBySupplier.get(r.id);
      const krRow = quadrantBySupplier.get(r.id);
      const poCount = Number(r.po_count) || 0;
      const totalSpend = Number(r.total_spend) || 0;
      return {
        supplier_id: r.id,
        supplier_name: r.name,
        category: categoryById[r.id] ?? null,
        tier: abcRow?.tier ?? krRow?.tier ?? null,
        total_spend: totalSpend,
        po_count: poCount,
        avg_po_value: poCount > 0 ? totalSpend / poCount : 0,
        abc_class: abcRow?.abc_class ?? null,
        kraljic_quadrant: krRow?.quadrant ?? null,
        rank: 0,
      };
    })
    .sort((a, b) => b.total_spend - a.total_spend)
    .map((row, i) => ({ ...row, rank: i + 1 }));

  return NextResponse.json({ spend_overview: analyses.spend_overview, ranking });
}
