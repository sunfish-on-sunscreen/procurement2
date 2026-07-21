import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import {
  CorrectionBody,
  CorrectionBatchBody,
  postCorrections,
  type CorrectionBatchInput,
} from "@/lib/corrections";
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
  /**
   * Two accepted shapes: the multi-field batch, and the original single-correction
   * body. The single form is normalised into a one-item batch, so there is exactly
   * ONE write path regardless of which shape arrived.
   */
  let batch: CorrectionBatchInput;
  const asBatch = CorrectionBatchBody.safeParse(body);
  if (asBatch.success) {
    batch = asBatch.data;
  } else {
    const single = CorrectionBody.safeParse(body);
    if (!single.success) {
      // Report against whichever shape the caller was closer to.
      const err = (body as { items?: unknown })?.items !== undefined ? asBatch.error : single.error;
      return NextResponse.json(
        {
          error: err.issues[0]?.message ?? "Invalid input",
          issues: err.issues.map((i) => `${i.path.join(".") || "body"}: ${i.message}`),
        },
        { status: 400 },
      );
    }
    const { reason, ...item } = single.data;
    batch = { reason, items: [item] };
  }

  let posted;
  try {
    // ONE transaction for every row in the post, and ONE recompute after it — a
    // multi-field post is a single user action, so it succeeds or fails whole.
    posted = await prisma.$transaction((tx) => postCorrections(tx, batch, session.userId), {
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
  const label = posted.length === 1 ? posted[0].correctionId : `${posted.length} corrections`;
  if (!recompute.ok) {
    return NextResponse.json(
      {
        error: `${label} posted, but analytics failed to refresh. Re-run the recompute.`,
        detail: recompute.error,
        corrections: posted,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    corrections: posted,
    // Retained so the existing single-correction dialog keeps working unchanged
    // until it is replaced; a multi-field post reports through `corrections`.
    correction: posted[0],
    netEffect: posted.map((p) => p.netEffect).join("; "),
    recompute: recompute.summary,
  });
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
