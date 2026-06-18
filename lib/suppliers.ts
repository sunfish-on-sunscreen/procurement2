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

/** Distinct supplier categories (for the report customization modal). */
export async function getCategories(): Promise<string[]> {
  const rows = await prisma.supplier.findMany({
    select: { category: true },
    distinct: ["category"],
    orderBy: { category: "asc" },
  });
  return rows.map((r) => r.category);
}
