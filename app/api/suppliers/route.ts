import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import {
  nextSupplierId,
  toSupplierCreateData,
  SupplierWriteBody,
} from "@/lib/supplier-import";
import { changeLogRows } from "@/lib/supplier-audit";
import { recomputeAllPeriods } from "@/lib/recompute";
import { Prisma } from "@/lib/generated/prisma/client";

export const runtime = "nodejs";

/**
 * Create ONE supplier (admin only). Reuses the shared validation + id-gen + mapper
 * (lib/supplier-import), the same logic the bulk import uses.
 *
 * Adding a supplier is analytically material: `load_roster_category_counts` counts
 * the FULL roster, so a new supplier in category C increases C's alternative count
 * and moves the supply-concentration signal — and therefore supply risk, the Kraljic
 * quadrant split, and the composite risk term — in EVERY period. Hence the full
 * recompute. It is synchronous; on failure we surface a real error, because the
 * insert has already committed.
 *
 * Unlike the permissive bulk import, a manual add REJECTS an exact-duplicate name.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = SupplierWriteBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const { supplier_name, country, category, status, is_mining_service, iujp_no, iujp_valid_until } =
    parsed.data;

  // Exact-duplicate name guard (trimmed). Similar-but-different names pass — intentional.
  const dupe = await prisma.supplier.findFirst({
    where: { supplierName: supplier_name },
    select: { id: true },
  });
  if (dupe) {
    return NextResponse.json(
      { error: `A supplier named "${supplier_name}" already exists (${dupe.id}).` },
      { status: 409 },
    );
  }

  // Assign the next id from the DB max, then write. On a unique collision (a
  // concurrent add grabbed the same id), re-derive and retry.
  let created: { id: string; supplierName: string; country: string; category: string } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await prisma.supplier.findMany({ select: { id: true } });
    const id = nextSupplierId(existing.map((s) => s.id));
    try {
      created = await prisma.$transaction(async (tx) => {
        const row = await tx.supplier.create({
          data: toSupplierCreateData({
            supplier_id: id,
            supplier_name,
            country,
            category,
            status,
            is_mining_service,
            iujp_no: iujp_no ?? null,
            iujp_valid_until: iujp_valid_until ? new Date(`${iujp_valid_until}T00:00:00.000Z`) : null,
          }),
          select: { id: true, supplierName: true, country: true, category: true },
        });
        await tx.supplierChangeLog.createMany({
          data: changeLogRows(row.id, session.userId, "create", []),
        });
        return row;
      });
      break;
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        continue;
      }
      throw err;
    }
  }

  if (!created) {
    return NextResponse.json(
      { error: "Could not assign a unique supplier id — please retry." },
      { status: 409 },
    );
  }

  const result = await recomputeAllPeriods();
  if (!result.ok) {
    return NextResponse.json(
      {
        error: `Supplier ${created.id} saved, but analytics failed to refresh. Re-run the recompute to update the dashboards.`,
        detail: result.error,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    supplier: {
      id: created.id,
      name: created.supplierName,
      country: created.country,
      category: created.category,
    },
    recompute: result.summary,
  });
}
