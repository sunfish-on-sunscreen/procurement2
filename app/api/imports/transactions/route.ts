import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { parseWorkbookSheets, type Row } from "@/lib/dataset-import";
import {
  planTransactionAppend,
  applyTransactionAppend,
  TXN_REQUIRED_SHEETS,
  TXN_CONDITIONAL_SHEETS,
  type TxnSheets,
} from "@/lib/dataset-append";
import { recomputeAllPeriods } from "@/lib/recompute";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;
const TX_TIMEOUT_MS = 180_000;

/**
 * APPEND complete purchase chains from a multi-sheet workbook.
 *
 * INSERT-ONLY. Every posted-document id must be free: a collision is rejected, never
 * upserted, because those ten tables carry immutability triggers and re-posting a
 * document would be an in-place edit. Chain references must resolve inside the file;
 * a reference to a record that already exists in the database means the upload is
 * extending a posted chain, which is an edit and is rejected with that wording.
 *
 * Complete chains only — an invoice-less PO would be COALESCEd to
 * threeWayMatchPass = TRUE by the view while contributing to no other rate
 * denominator, silently inflating processScore.
 *
 * `mode=preview` validates and returns the plan without writing.
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let file: File | null = null;
  let preview = false;
  try {
    const form = await request.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
    preview = String(form.get("mode") ?? "") === "preview";
  } catch {
    return NextResponse.json({ error: "Expected a multipart form upload." }, { status: 400 });
  }
  if (!file) {
    return NextResponse.json({ error: "No file provided (field name: 'file')." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File exceeds the 25 MB limit." }, { status: 400 });
  }

  // Read the document sheets. The conditional pair is optional at parse time — the
  // planner decides whether they were actually required.
  const bytes = new Uint8Array(await file.arrayBuffer());
  const sheets: TxnSheets = {};
  try {
    const required = parseWorkbookSheets(bytes, TXN_REQUIRED_SHEETS);
    for (const name of TXN_REQUIRED_SHEETS) sheets[name] = required[name];
  } catch (err) {
    return NextResponse.json(
      { error: `Could not read the workbook: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 },
    );
  }
  for (const name of TXN_CONDITIONAL_SHEETS) {
    try {
      sheets[name] = parseWorkbookSheets(bytes, [name])[name] as Row[];
    } catch {
      sheets[name] = [];
    }
  }

  const plan = await planTransactionAppend(prisma, sheets);
  if (plan.errors.length > 0) {
    return NextResponse.json(
      {
        error: `Validation failed with ${plan.errors.length} problem(s). Nothing was written.`,
        errors: plan.errors,
      },
      { status: 400 },
    );
  }

  const summary = {
    purchaseOrders: plan.poCount,
    orderLines: plan.lineCount,
    totalValueUsd: plan.totalValueUsd,
    periods: plan.periods,
  };

  if (preview) {
    return NextResponse.json({ preview: true, ...summary });
  }

  const latestPeriod = await prisma.reportingPeriod.findFirst({
    orderBy: { startDate: "desc" },
    select: { id: true },
  });
  if (!latestPeriod) {
    return NextResponse.json(
      { error: "No reporting period exists yet — import a dataset first." },
      { status: 400 },
    );
  }

  let counts: Record<string, number>;
  try {
    counts = await prisma.$transaction(
      async (tx) => {
        const res = await applyTransactionAppend(tx, plan);
        const rowCount = Object.values(res).reduce((a, b) => a + b, 0);
        await tx.import.create({
          data: {
            userId: session.userId,
            periodId: latestPeriod.id,
            filename: file.name,
            fileType: "transactions_append",
            rowCount,
            status: "PROCESSING",
          },
        });
        return res;
      },
      { timeout: TX_TIMEOUT_MS, maxWait: 15_000 },
    );
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Append failed and was rolled back — no data was changed. ${detail}` },
      { status: 500 },
    );
  }

  const recompute = await recomputeAllPeriods();
  await prisma.import.updateMany({
    where: { fileType: "transactions_append", status: "PROCESSING" },
    data: {
      status: recompute.ok ? "SUCCESS" : "FAILED",
      processedAt: new Date(),
      errorMessage: recompute.ok ? null : recompute.error.slice(0, 1000),
    },
  });

  if (!recompute.ok) {
    return NextResponse.json(
      {
        error:
          "Transactions were appended, but the analytics recompute failed. The dashboards are stale — re-run the recompute.",
        detail: recompute.error,
        counts,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    ...summary,
    counts,
    recompute: recompute.summary,
  });
}
