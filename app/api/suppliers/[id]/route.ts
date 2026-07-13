import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { recomputeAllPeriods } from "@/lib/recompute";

export const runtime = "nodejs";

/**
 * Delete ONE supplier (admin). BLOCKED if it has any purchases (no orphans) —
 * responds 409 with the count. Otherwise deletes the supplier (+ any stray
 * SupplierMetric) and recomputes all periods (its removal shifts roster
 * concentration for its category). If the recompute fails, the deletion has
 * already committed, so we surface a real error (500) telling the admin the
 * dashboards are stale — see recomputeAllPeriods (it also leaves the range cache
 * intact on failure).
 *
 * NOTE: there is intentionally NO edit (PATCH) handler — in-place editing of
 * transactional records was removed (governance: records can be added or removed,
 * never silently altered; every value traces back to an authoritative import).
 */
export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  const existing = await prisma.supplier.findFirst({
    where: { externalId: id },
    select: { externalId: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  }

  const purchaseCount = await prisma.purchase.count({
    where: { supplierExternalId: id },
  });
  if (purchaseCount > 0) {
    return NextResponse.json(
      {
        error: `Can't remove ${id} — it has ${purchaseCount} purchase${purchaseCount === 1 ? "" : "s"}. Delete those first.`,
      },
      { status: 409 },
    );
  }

  await prisma.$transaction([
    prisma.supplierMetric.deleteMany({ where: { supplierExternalId: id } }),
    prisma.supplier.deleteMany({ where: { externalId: id } }),
  ]);

  const { ok, failedPeriods } = await recomputeAllPeriods();
  if (!ok) {
    return NextResponse.json(
      {
        error: `Supplier removed, but analytics failed to refresh (periods: ${failedPeriods.join(", ")}). Re-run a full import to update the dashboards.`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, deleted: id });
}
