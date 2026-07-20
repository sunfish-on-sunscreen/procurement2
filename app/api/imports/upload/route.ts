import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import {
  SHEET_NAMES,
  parseWorkbook,
  validateDataset,
  clearDataset,
  insertDataset,
  datasetPeriods,
  type SheetName,
} from "@/lib/dataset-import";
import { recomputeAllPeriods } from "@/lib/recompute";

export const runtime = "nodejs";

/** The whole 12-sheet write is one transaction; give it room (measured ~6s). */
const TX_TIMEOUT_MS = 180_000;
const MAX_UPLOAD_BYTES = 25 * 1024 * 1024;

/**
 * Full-dataset import — REPLACE-ALL.
 *
 * The 12 sheets are a referentially closed graph keyed by natural ids from the
 * file. There is no meaningful merge key between two independently generated
 * corpora, so appending would invite dangling FKs and duplicate PKs; a replace is
 * the only sound semantic. It is the same parse/validate/insert path the seed
 * uses (lib/dataset-import), promoted to an admin route.
 *
 * ⚠️ DESTRUCTIVE. Everything transactional is deleted and rebuilt from the file,
 * including suppliers added by hand through /api/suppliers. The client must show
 * the preflight (GET) counts before calling this.
 *
 * Order: validate EVERYTHING → single transaction (wipe reverse-FK, insert
 * FK-order) → recompute. A validation failure writes nothing at all.
 */

/** What a replace-all would destroy right now. Drives the confirmation dialog. */
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  const [supplierCount, poCount, changeLogCount, manualCreates] = await Promise.all([
    prisma.supplier.count(),
    prisma.purchaseOrder.count(),
    prisma.supplierChangeLog.count(),
    prisma.supplierChangeLog.findMany({
      where: { action: "create" },
      select: { supplierId: true },
      distinct: ["supplierId"],
    }),
  ]);

  return NextResponse.json({
    supplierCount,
    poCount,
    changeLogCount,
    // A supplier is "manually added" iff it has a `create` entry in the audit log —
    // seeded suppliers have none.
    manuallyAddedSuppliers: manualCreates.map((m) => m.supplierId),
  });
}

export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // --- read the upload ------------------------------------------------------
  let file: File | null = null;
  try {
    const form = await request.formData();
    const f = form.get("file");
    if (f instanceof File) file = f;
  } catch {
    return NextResponse.json({ error: "Expected a multipart form upload." }, { status: 400 });
  }
  if (!file) {
    return NextResponse.json({ error: "No file provided (field name: 'file')." }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json({ error: "File exceeds the 25 MB limit." }, { status: 400 });
  }

  // --- parse + validate BEFORE touching the database ------------------------
  const bytes = new Uint8Array(await file.arrayBuffer());
  let dataset;
  try {
    dataset = parseWorkbook(bytes);
  } catch (err) {
    return NextResponse.json(
      { error: `Could not read the workbook: ${err instanceof Error ? err.message : String(err)}` },
      { status: 400 },
    );
  }

  const errors = validateDataset(dataset);
  if (errors.length > 0) {
    return NextResponse.json(
      {
        error: `Validation failed with ${errors.length} problem(s). Nothing was written.`,
        errors,
      },
      { status: 400 },
    );
  }

  const periods = datasetPeriods(dataset);
  if (periods.length === 0) {
    return NextResponse.json(
      { error: "No reporting periods found — purchase_orders carry no `period` values." },
      { status: 400 },
    );
  }

  // --- single transaction: wipe + insert ------------------------------------
  let result: { counts: Record<SheetName, number>; auditKept: number; auditDropped: number; importId: string };
  try {
    result = await prisma.$transaction(
      async (tx) => {
        // Master-data audit history is PRESERVED across a re-import wherever it
        // still resolves. SupplierChangeLog FKs Supplier with ON DELETE RESTRICT,
        // so the rows are buffered, deleted, and re-inserted for suppliers the new
        // file still contains. History for suppliers that vanish is dropped (it
        // would dangle) and reported. The re-import itself is recorded as an
        // `Import` row — that table is the event log for imports.
        const priorLog = await tx.supplierChangeLog.findMany();
        await tx.supplierChangeLog.deleteMany();

        await clearDataset(tx);

        // Reporting periods must exist before the compute step runs.
        for (const name of periods) {
          const y = Number(name);
          if (!Number.isFinite(y)) continue;
          await tx.reportingPeriod.upsert({
            where: { name },
            update: {},
            create: {
              name,
              startDate: new Date(Date.UTC(y, 0, 1, 0, 0, 0)),
              endDate: new Date(Date.UTC(y, 11, 31, 23, 59, 59)),
            },
          });
        }

        const counts = await insertDataset(tx, dataset);

        const survivingIds = new Set(dataset.suppliers.map((r) => String(r.supplier_id).trim()));
        const keep = priorLog.filter((row) => survivingIds.has(row.supplierId));
        if (keep.length > 0) {
          await tx.supplierChangeLog.createMany({ data: keep });
        }

        const latestPeriod = await tx.reportingPeriod.findFirst({
          where: { name: periods[periods.length - 1] },
          select: { id: true },
        });

        const totalRows = SHEET_NAMES.reduce((sum, k) => sum + counts[k], 0);
        const imp = await tx.import.create({
          data: {
            userId: session.userId,
            periodId: latestPeriod!.id,
            filename: file.name,
            // One Import row per FILE: this upload is a single 12-sheet dataset
            // spanning every period, not a per-sheet or per-period import.
            fileType: "dataset_full",
            rowCount: totalRows,
            status: "PROCESSING",
          },
          select: { id: true },
        });

        return {
          counts,
          auditKept: keep.length,
          auditDropped: priorLog.length - keep.length,
          importId: imp.id,
        };
      },
      { timeout: TX_TIMEOUT_MS, maxWait: 15_000 },
    );
  } catch (err) {
    // Any throw inside the transaction rolls the whole thing back — the previous
    // dataset is still intact.
    const detail = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { error: `Import failed and was rolled back — no data was changed. ${detail}` },
      { status: 500 },
    );
  }

  // --- recompute ------------------------------------------------------------
  const recompute = await recomputeAllPeriods();
  await prisma.import.update({
    where: { id: result.importId },
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
          "Data imported, but the analytics recompute failed. The dashboards are stale — re-run the recompute.",
        detail: recompute.error,
        counts: result.counts,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    counts: result.counts,
    periods,
    audit: { preserved: result.auditKept, dropped: result.auditDropped },
    recompute: recompute.summary,
  });
}
