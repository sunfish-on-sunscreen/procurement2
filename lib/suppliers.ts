import { prisma } from "@/lib/prisma";

/**
 * supplier externalId -> category, for the report filters (analysis result rows
 * carry supplier_id but not category). Suppliers are a global catalog
 * (one row each, tagged to the latest period), so this is the same for any range.
 */
export async function getSupplierCategoryMap(): Promise<Record<string, string>> {
  const rows = await prisma.supplier.findMany({
    select: { externalId: true, category: true },
  });
  const map: Record<string, string> = {};
  for (const r of rows) map[r.externalId] = r.category;
  return map;
}

/**
 * Static per-supplier catalog facts (country + PO count) for the Batch 6b
 * supplier detail panel — fields the period analyses don't carry. Suppliers are
 * a global catalog (one row per externalId, tagged to the latest period), so a
 * `distinct` on externalId is period-stable for country.
 *
 * ⚠️ `num_pos` is the ALL-TIME PO count, computed from the Purchase table.
 * SupplierMetric.numPos is now a PER-PERIOD value (P2), so reading it (even the
 * latest period's) would understate the all-time total — counting Purchase rows
 * directly keeps the long-standing all-time meaning.
 */
export async function getSupplierDirectory(): Promise<
  Record<string, { country: string; num_pos: number }>
> {
  const [suppliers, poCounts] = await Promise.all([
    prisma.supplier.findMany({
      select: { externalId: true, country: true },
      distinct: ["externalId"],
      orderBy: { periodId: "desc" },
    }),
    prisma.purchase.groupBy({
      by: ["supplierExternalId"],
      _count: { _all: true },
    }),
  ]);
  const numPosById = new Map(
    poCounts.map((p) => [p.supplierExternalId, p._count._all]),
  );
  const out: Record<string, { country: string; num_pos: number }> = {};
  for (const s of suppliers) {
    out[s.externalId] = {
      country: s.country,
      num_pos: numPosById.get(s.externalId) ?? 0,
    };
  }
  return out;
}

/** Distinct supplier categories (for the report customization modal). */
export async function getCategories(): Promise<string[]> {
  const rows = await prisma.supplier.findMany({
    select: { category: true },
    distinct: ["category"],
    orderBy: { category: "asc" },
  });
  return rows.map((r) => r.category);
}
