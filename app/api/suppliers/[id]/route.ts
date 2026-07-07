import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { SupplierWriteBody } from "@/lib/supplier-import";
import { recomputeAllPeriods } from "@/lib/recompute";

export const runtime = "nodejs";

/**
 * Edit ONE supplier (admin). The external id is LOCKED (editing it would orphan
 * every purchase linked by supplierExternalId). Name/country/category are
 * editable via the shared write-body validation. Denormalized copies on Purchase
 * + SupplierMetric are synced so labels + spend-by-category stay consistent, then
 * — unless it's a name-only change — all periods are recomputed (concentration
 * is period-global). Rejects an exact-duplicate name against a DIFFERENT supplier.
 */
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
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
  const parsed = SupplierWriteBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const { supplier_name, country, category } = parsed.data;

  const existing = await prisma.supplier.findFirst({
    where: { externalId: id },
    select: { supplierName: true, country: true, category: true },
  });
  if (!existing) {
    return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  }

  // Exact-duplicate name guard — but only against a DIFFERENT supplier (keeping
  // your own name is fine).
  const dupe = await prisma.supplier.findFirst({
    where: { supplierName: supplier_name, externalId: { not: id } },
    select: { externalId: true },
  });
  if (dupe) {
    return NextResponse.json(
      { error: `A supplier named "${supplier_name}" already exists (${dupe.externalId}).` },
      { status: 409 },
    );
  }

  // A name-only change moves no score (labels only) → skip the recompute.
  const scoreAffecting =
    country !== existing.country || category !== existing.category;

  await prisma.$transaction([
    prisma.supplier.updateMany({
      where: { externalId: id },
      data: { supplierName: supplier_name, country, category },
    }),
    // Sync the denormalized copies so labels + spend-by-category reflect the edit
    // (preserves the purchase.category == supplier.category invariant).
    prisma.purchase.updateMany({
      where: { supplierExternalId: id },
      data: { supplierName: supplier_name, category },
    }),
    prisma.supplierMetric.updateMany({
      where: { supplierExternalId: id },
      data: { supplierName: supplier_name, category },
    }),
  ]);

  let recomputed = false;
  let recomputeWarning: string | null = null;
  if (scoreAffecting) {
    const { ok, failedPeriods } = await recomputeAllPeriods();
    recomputed = true;
    if (!ok) recomputeWarning = `Recompute failed for: ${failedPeriods.join(", ")}`;
  }

  return NextResponse.json({
    success: true,
    supplier: { id, name: supplier_name, country, category },
    recomputed,
    recomputeWarning,
  });
}

/**
 * Delete ONE supplier (admin). BLOCKED if it has any purchases (no orphans) —
 * responds 409 with the count. Otherwise deletes the supplier (+ any stray
 * SupplierMetric) and recomputes all periods (its removal shifts roster
 * concentration for its category).
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

  return NextResponse.json({
    success: true,
    deleted: id,
    recomputed: true,
    recomputeWarning: ok ? null : `Recompute failed for: ${failedPeriods.join(", ")}`,
  });
}
