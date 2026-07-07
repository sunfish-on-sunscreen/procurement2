import { NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { recomputeAllPeriods } from "@/lib/recompute";

export const runtime = "nodejs";

const BatchDeleteBody = z.object({
  ids: z.array(z.string().min(1)).min(1, "Select at least one purchase"),
});

/**
 * Batch-delete purchases (admin). No block rule — deleting purchases can't orphan
 * anything. Delete all selected in one transaction, then recompute ALL periods
 * ONCE (affected suppliers' aggregates move automatically — recompute is global).
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

  const result = await prisma.purchase.deleteMany({ where: { poId: { in: ids } } });

  const { ok, failedPeriods } = await recomputeAllPeriods();

  return NextResponse.json({
    success: true,
    deleted: result.count,
    recomputed: true,
    recomputeWarning: ok ? null : `Recompute failed for: ${failedPeriods.join(", ")}`,
  });
}
