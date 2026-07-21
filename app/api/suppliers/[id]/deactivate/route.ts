import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { readSession } from "@/lib/auth";
import { changeLogRows } from "@/lib/supplier-audit";
import { z } from "zod";

export const runtime = "nodejs";

const Body = z.object({ reactivate: z.boolean().default(false) });

/**
 * Deactivate (or reactivate) a supplier — a STATUS FLIP, never a delete.
 *
 * Hard delete is impossible here and always will be: every one of the 55 seeded
 * suppliers is referenced by at least one of Framework, Response, PurchaseOrder,
 * Invoice, or SourcingEvent.awardedSupplierId, and all five FKs are RESTRICT. A
 * delete would either fail or orphan posted documents, so retirement is expressed
 * as state, not absence.
 *
 * ⚠️ Deactivating changes NO analytics number, by design. The compute layer never
 * filters on `Supplier.status`, and `load_roster_category_counts` counts inactive
 * suppliers on purpose — an inactive-but-qualified supplier is still an available
 * alternative for the supply-concentration signal. So this is master-data state
 * only, and no recompute is triggered: there is nothing for it to change. (Change
 * that reasoning and you must add the recompute back.)
 */
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const { session, stale } = await readSession();
  // A stale cookie is NOT a permissions problem, and saying "Forbidden" would send
  // an admin hunting for a role issue. It also has to be caught here rather than at
  // the write: `changedBy` FKs User, so a vanished user would fail the audit insert
  // and roll the whole flip back.
  if (stale) {
    return NextResponse.json(
      { error: "Your session is no longer valid — sign out and sign in again." },
      { status: 401 },
    );
  }
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  let raw: unknown = {};
  try {
    raw = await request.json();
  } catch {
    // Empty body is fine — defaults to deactivate.
  }
  const parsed = Body.safeParse(raw ?? {});
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid input" }, { status: 400 });
  }
  const target = parsed.data.reactivate ? "active" : "inactive";

  const current = await prisma.supplier.findUnique({
    where: { id },
    select: { status: true, supplierName: true },
  });
  if (!current) {
    return NextResponse.json({ error: `Supplier ${id} not found.` }, { status: 404 });
  }
  if (current.status === target) {
    return NextResponse.json({ success: true, status: target, message: "Already in that state." });
  }

  // The flip and its audit row are one transaction, so a failed log leaves no
  // unlogged status change. Without this catch any database error became an
  // unattributable 500: the body was not this route's JSON shape, so the client's
  // `res.json().catch(() => ({}))` produced no `error` field and the UI fell back to
  // a generic "Could not change the supplier status" that named no cause.
  try {
    await prisma.$transaction(async (tx) => {
      await tx.supplier.update({ where: { id }, data: { status: target } });
      await tx.supplierChangeLog.createMany({
        data: changeLogRows(id, session.userId, target === "active" ? "reactivate" : "deactivate", [
          { field: "status", oldValue: current.status, newValue: target },
        ]),
      });
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      {
        error: `${current.supplierName} was not changed — the update was rolled back.`,
        detail,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, id, name: current.supplierName, status: target });
}
