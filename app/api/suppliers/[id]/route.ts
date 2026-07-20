import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { SupplierPatchBody } from "@/lib/supplier-import";
import { diffSupplier, changeLogRows, type SupplierSnapshot } from "@/lib/supplier-audit";
import { recomputeAllPeriods } from "@/lib/recompute";

export const runtime = "nodejs";

const SUPPLIER_SELECT = {
  supplierName: true,
  country: true,
  category: true,
  status: true,
  isMiningService: true,
  iujpNo: true,
  iujpValidUntil: true,
} as const;

/**
 * Edit ONE supplier's master data (admin only).
 *
 * AUDIT MODEL — master data is updated in place and every changed field is appended
 * to SupplierChangeLog (who / when / before → after). Posted transactional documents
 * do NOT work this way: they are immutable and take linked correction entries. The
 * split is deliberate — a supplier record describes a counterparty, not a posted
 * financial event.
 *
 * The id is immutable: it is the natural key every other table FKs against, so
 * changing it would orphan the document graph.
 *
 * A recompute runs whenever anything actually changed. Several of these fields are
 * analytically material — `category` shifts roster concentration (supply risk,
 * Kraljic), `country` drives country_distance (composite risk) and import_friction —
 * and `supplierName` is denormalized onto SupplierMetric, so it would otherwise go
 * stale. Rather than maintain a "which fields matter" list that can rot, any real
 * change triggers the recompute; a no-op edit skips it.
 */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = SupplierPatchBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }

  const current = await prisma.supplier.findUnique({ where: { id }, select: SUPPLIER_SELECT });
  if (!current) {
    return NextResponse.json({ error: `Supplier ${id} not found.` }, { status: 404 });
  }

  const { data, changes } = diffSupplier(current as SupplierSnapshot, parsed.data);
  if (changes.length === 0) {
    return NextResponse.json({ success: true, changed: [], message: "No changes." });
  }

  // Reject a rename that collides with another supplier's exact name.
  if (data.supplierName) {
    const dupe = await prisma.supplier.findFirst({
      where: { supplierName: data.supplierName as string, id: { not: id } },
      select: { id: true },
    });
    if (dupe) {
      return NextResponse.json(
        { error: `A supplier named "${data.supplierName as string}" already exists (${dupe.id}).` },
        { status: 409 },
      );
    }
  }

  await prisma.$transaction(async (tx) => {
    await tx.supplier.update({ where: { id }, data });
    await tx.supplierChangeLog.createMany({
      data: changeLogRows(id, session.userId, "update", changes),
    });
  });

  const result = await recomputeAllPeriods();
  if (!result.ok) {
    return NextResponse.json(
      {
        error: `Supplier ${id} updated, but analytics failed to refresh. Re-run the recompute to update the dashboards.`,
        detail: result.error,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    changed: changes.map((c) => c.field),
    recompute: result.summary,
  });
}
