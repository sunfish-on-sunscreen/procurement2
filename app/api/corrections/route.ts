import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { CorrectionBody, postCorrection } from "@/lib/corrections";
import { recomputeAllPeriods } from "@/lib/recompute";

export const runtime = "nodejs";

const TX_TIMEOUT_MS = 60_000;

/**
 * Post a correction against a posted transactional record (admin only).
 *
 * The original row is NEVER touched — database triggers reject any UPDATE on the
 * posted document tables. A correction is an appended signed line linked by
 * `correctsLineId`, so the audit trail is the ledger itself rather than a side log.
 * A full recompute follows, since a correction moves spend / quality / process
 * inputs and the roster-wide medians they feed.
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
  const parsed = CorrectionBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      {
        error: parsed.error.issues[0]?.message ?? "Invalid input",
        issues: parsed.error.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`),
      },
      { status: 400 },
    );
  }

  let posted;
  try {
    posted = await prisma.$transaction((tx) => postCorrection(tx, parsed.data, session.userId), {
      timeout: TX_TIMEOUT_MS,
      maxWait: 10_000,
    });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Correction not posted — nothing was written. ${detail}` },
      { status: 400 },
    );
  }

  const recompute = await recomputeAllPeriods();
  if (!recompute.ok) {
    return NextResponse.json(
      {
        error: `Correction ${posted.correctionId} was posted, but analytics failed to refresh. Re-run the recompute.`,
        detail: recompute.error,
        correction: posted,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true, correction: posted, recompute: recompute.summary });
}

/** Correction history, newest first — for the admin page. */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const rows = await prisma.correction.findMany({
    take: 50,
    orderBy: { createdAt: "desc" },
    include: {
      user: { select: { email: true } },
      poLines: { select: { id: true, quantityOrdered: true, unitPriceUsd: true, correctsLineId: true } },
      invoiceLines: { select: { id: true, quantityBilled: true, unitPriceUsd: true, correctsLineId: true } },
      grnLines: { select: { id: true, defectCount: true, quantityReceived: true, correctsLineId: true } },
    },
  });
  return NextResponse.json({ corrections: rows });
}
