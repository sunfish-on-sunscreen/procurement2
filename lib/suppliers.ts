import { prisma } from "@/lib/prisma";

/**
 * supplier externalId -> category, for the report filters (analysis result rows
 * carry supplier_id + tier but not category). Suppliers are a global catalog
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
 * `distinct` on externalId is period-stable for country; `numPos` is the
 * SupplierMetric snapshot (latest period wins), consistent with the other
 * denormalized SupplierMetric snapshots.
 */
export async function getSupplierDirectory(): Promise<
  Record<string, { country: string; num_pos: number }>
> {
  const [suppliers, metrics] = await Promise.all([
    prisma.supplier.findMany({
      select: { externalId: true, country: true },
      distinct: ["externalId"],
      orderBy: { periodId: "desc" },
    }),
    prisma.supplierMetric.findMany({
      select: { supplierExternalId: true, numPos: true },
      distinct: ["supplierExternalId"],
      orderBy: { periodId: "desc" },
    }),
  ]);
  const numPosById = new Map(metrics.map((m) => [m.supplierExternalId, m.numPos]));
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
