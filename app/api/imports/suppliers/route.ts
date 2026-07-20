import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { parseWorkbookSheets } from "@/lib/dataset-import";
import {
  planSupplierAppend,
  applySupplierAppend,
  planTouchesData,
  SUPPLIER_APPEND_SELECT,
  type ExistingSupplier,
} from "@/lib/dataset-append";
import { recomputeAllPeriods } from "@/lib/recompute";

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const TX_TIMEOUT_MS = 60_000;

/**
 * APPEND suppliers from a one-sheet workbook — upsert by `supplier_id`.
 *
 * Additive: nothing existing is deleted. An id already present is UPDATED in place
 * (Supplier is master data and carries no immutability trigger, unlike the ten
 * posted document tables), and every changed field is written to SupplierChangeLog
 * exactly as the manual edit path does.
 *
 * `mode=preview` in the form data validates and returns the plan WITHOUT writing, so
 * the UI can show what an upload would do before committing to it.
 *
 * A recompute follows only if something actually changed: adding a supplier or
 * moving one between categories shifts roster concentration in every period, but a
 * file identical to the current roster has nothing to recompute.
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
    return NextResponse.json({ error: "File exceeds the 10 MB limit." }, { status: 400 });
  }

  // Parse only the sheet this mode needs — the workbook may be the full template.
  let rows;
  try {
    rows = parseWorkbookSheets(new Uint8Array(await file.arrayBuffer()), ["suppliers"]).suppliers;
  } catch (err) {
    return NextResponse.json(
      { error: `Could not read the workbook: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 },
    );
  }

  const existing = (await prisma.supplier.findMany({
    select: SUPPLIER_APPEND_SELECT,
  })) as ExistingSupplier[];

  const plan = planSupplierAppend(rows, existing);
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
    willInsert: plan.inserts.map((r) => String(r.supplier_id)),
    willUpdate: plan.updates.map((u) => ({
      id: u.id,
      name: u.name,
      changes: u.changes.map((c) => `${c.field}: ${c.oldValue ?? "—"} → ${c.newValue ?? "—"}`),
    })),
    unchanged: plan.unchanged.length,
  };

  if (preview) {
    return NextResponse.json({ preview: true, ...summary });
  }

  if (!planTouchesData(plan)) {
    // Nothing to write and nothing to recompute — say so rather than burning ~6s.
    return NextResponse.json({
      success: true,
      applied: { inserted: 0, updated: 0, unchanged: plan.unchanged.length, fieldsChanged: 0 },
      recomputed: false,
      message: "Every supplier in the file already matches the roster — no changes.",
    });
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

  let applied;
  try {
    applied = await prisma.$transaction(
      async (tx) => {
        const res = await applySupplierAppend(tx, plan, session.userId);
        await tx.import.create({
          data: {
            userId: session.userId,
            periodId: latestPeriod.id,
            filename: file.name,
            fileType: "suppliers_append",
            rowCount: rows.length,
            status: "PROCESSING",
          },
        });
        return res;
      },
      { timeout: TX_TIMEOUT_MS, maxWait: 10_000 },
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
    where: { fileType: "suppliers_append", status: "PROCESSING" },
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
          "Suppliers were appended, but the analytics recompute failed. The dashboards are stale — re-run the recompute.",
        detail: recompute.error,
        applied,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    applied,
    ...summary,
    recomputed: true,
    recompute: recompute.summary,
  });
}
