import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { recomputeAllPeriods } from "@/lib/recompute";

export const runtime = "nodejs";

const BatchDeleteBody = z.object({
  ids: z.array(z.string().min(1)).min(1, "Select at least one supplier"),
});

/**
 * Batch-delete suppliers (admin). ALL-OR-NOTHING: if ANY selected supplier has
 * purchases, the WHOLE batch is blocked (409) with a per-supplier report — no
 * orphans, no partial deletes. Otherwise every selected supplier is deleted in
 * one transaction and all periods are recomputed ONCE.
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
  const parsed = BatchDeleteBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const ids = [...new Set(parsed.data.ids)];

  // Purchase counts for the whole selection in one grouped query.
  const counts = await prisma.purchase.groupBy({
    by: ["supplierExternalId"],
    where: { supplierExternalId: { in: ids } },
    _count: { _all: true },
  });
  const withPurchases = counts
    .map((c) => ({ id: c.supplierExternalId, n: c._count._all }))
    .filter((c) => c.n > 0)
    .sort((a, b) => a.id.localeCompare(b.id));

  if (withPurchases.length > 0) {
    const report = withPurchases.map((c) => `${c.id} (${c.n})`).join(", ");
    return NextResponse.json(
      {
        error:
          `${withPurchases.length} of ${ids.length} selected have purchases: ${report}. ` +
          `Resolve those first — nothing was deleted.`,
      },
      { status: 409 },
    );
  }

  await prisma.$transaction([
    prisma.supplierMetric.deleteMany({ where: { supplierExternalId: { in: ids } } }),
    prisma.supplier.deleteMany({ where: { externalId: { in: ids } } }),
  ]);

  const { ok, failedPeriods } = await recomputeAllPeriods();
  if (!ok) {
    return NextResponse.json(
      {
        error: `Suppliers removed, but analytics failed to refresh (periods: ${failedPeriods.join(", ")}). Re-run a full import to update the dashboards.`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, deleted: ids.length });
}
