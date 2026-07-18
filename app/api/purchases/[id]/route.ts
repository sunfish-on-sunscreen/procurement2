import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { recomputeAllPeriods } from "@/lib/recompute";

export const runtime = "nodejs";

/**
 * Delete ONE purchase (admin). No block rule — deleting a purchase can't orphan
 * anything; it just drops its supplier's aggregate for that PO. Delete + recompute.
 * If the recompute fails, the deletion already committed, so we return a real error
 * (500) — the range cache is left intact on failure (see recomputeAllPeriods).
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

  const existing = await prisma.purchase.findFirst({ where: { poId: id }, select: { poId: true } });
  if (!existing) {
    return NextResponse.json({ error: "Purchase not found" }, { status: 404 });
  }

  await prisma.purchase.deleteMany({ where: { poId: id } });

  const { ok, failedPeriods } = await recomputeAllPeriods();
  if (!ok) {
    return NextResponse.json(
      {
        error: `Purchase removed, but analytics failed to refresh (periods: ${failedPeriods.join(", ")}). Re-run a full import to update the dashboards.`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, deleted: id });
}
