import { NextResponse } from "next/server";
import * as xlsx from "xlsx";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { runComputeAnalyses, runImportCompute } from "@/lib/python";

export const runtime = "nodejs";

// Dates arrive from the xlsx parser as ISO strings (the sample stores them as
// text). Accept Date too, in case a future file stores real Excel dates.
const dateLike = z.union([z.date(), z.string()]);

// An id cell may be a string, a number (if a hand-authored sheet typed a bare
// number), or absent/blank — a blank id is auto-generated in sequence on import.
const idCell = z.union([z.string(), z.number()]).optional();

const SuppliersRow = z.object({
  supplier_id: idCell,
  supplier_name: z.string(),
  country: z.string(),
  category: z.string(),
});

const PurchasesRow = z.object({
  po_id: idCell,
  // supplier_id is a REFERENCE to a Supplier (not this row's own identity); it
  // must resolve to a supplier in the Suppliers file or the DB (orphan check),
  // so it is never auto-generated. Absent/blank -> caught as an orphan.
  supplier_id: idCell,
  supplier_name: z.string(),
  category: z.string(),
  item_name: z.string(),
  unit: z.string(),
  quantity: z.number(),
  unit_price_usd: z.number(),
  total_value_usd: z.number(),
  pr_date: dateLike,
  po_date: dateLike,
  delivery_date: dateLike,
  invoice_date: dateLike,
  payment_date: dateLike,
  pr_to_po_days: z.number().int(),
  po_to_delivery_days: z.number().int(),
  delivery_to_invoice_days: z.number().int(),
  invoice_to_payment_days: z.number().int(),
  total_cycle_days: z.number().int(),
  on_time_delivery: z.boolean(),
  three_way_match_pass: z.boolean(),
  // Per-PO quality inputs (aggregated server-side into defect_rate/complaint_rate).
  defect_count: z.number().int(),
  complaint_count: z.number().int(),
});

type SupplierRowData = z.infer<typeof SuppliersRow>;
type PurchaseRowData = z.infer<typeof PurchasesRow>;

function parseExcelDate(value: Date | string): Date {
  if (value instanceof Date) return value;
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid date: ${value}`);
  }
  return parsed;
}

function formatIssues(error: z.ZodError): string {
  return error.issues
    .slice(0, 3)
    .map((issue) => {
      const row = typeof issue.path[0] === "number" ? `row ${issue.path[0]}` : "row ?";
      const field = issue.path.slice(1).join(".") || "(row)";
      return `${row}, "${field}": ${issue.message}`;
    })
    .join("; ");
}

/** Normalize an id cell to a trimmed string, or undefined when blank/absent. */
function idStr(value: string | number | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s.length > 0 ? s : undefined;
}

/**
 * Build an id generator that continues the numeric sequence after the highest
 * matching id already present (in-file). e.g. prefix "S", pad 4, existing max
 * S0007 -> next() yields "S0008", "S0009", … Ids that don't match `re` are
 * ignored when seeding the sequence.
 */
function makeIdGen(existing: (string | undefined)[], prefix: string, pad: number, re: RegExp) {
  let max = 0;
  for (const id of existing) {
    const m = id?.match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return () => `${prefix}${String(++max).padStart(pad, "0")}`;
}

/** First-duplicate detector for a resolved id list (returns the id or null). */
function firstDuplicate(ids: string[]): string | null {
  const seen = new Set<string>();
  for (const id of ids) {
    if (seen.has(id)) return id;
    seen.add(id);
  }
  return null;
}

/** Pull rows from a workbook's named sheet, falling back to its first sheet. */
function sheetRows(wb: xlsx.WorkBook, name: string): Record<string, unknown>[] {
  const sheet = wb.Sheets[name] ?? wb.Sheets[wb.SheetNames[0]];
  if (!sheet) return [];
  return xlsx.utils.sheet_to_json(sheet);
}

export async function POST(request: Request) {
  // 1. Auth: ADMIN only
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 2. Parse form data — TWO separate files: Suppliers + Purchases.
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }
  const suppliersFile = formData.get("suppliers");
  const purchasesFile = formData.get("purchases");
  if (!(suppliersFile instanceof Blob) || !(purchasesFile instanceof Blob)) {
    return NextResponse.json(
      { error: "Both a Suppliers file and a Purchases file are required." },
      { status: 400 },
    );
  }
  const suppliersFilename = suppliersFile instanceof File ? suppliersFile.name : "suppliers.xlsx";
  const purchasesFilename = purchasesFile instanceof File ? purchasesFile.name : "purchases.xlsx";

  // 3. Parse both workbooks
  let suppliersWb: xlsx.WorkBook;
  let purchasesWb: xlsx.WorkBook;
  try {
    suppliersWb = xlsx.read(new Uint8Array(await suppliersFile.arrayBuffer()), {
      type: "array",
      cellDates: true,
    });
    purchasesWb = xlsx.read(new Uint8Array(await purchasesFile.arrayBuffer()), {
      type: "array",
      cellDates: true,
    });
  } catch {
    return NextResponse.json({ error: "Could not read one of the Excel files" }, { status: 400 });
  }

  // 4. Sheet -> JSON -> validate BOTH before any DB write (fail-fast).
  const suppliersParsed = SuppliersRow.array().safeParse(sheetRows(suppliersWb, "Suppliers"));
  if (!suppliersParsed.success) {
    return NextResponse.json(
      { error: `Validation failed in Suppliers file: ${formatIssues(suppliersParsed.error)}` },
      { status: 400 },
    );
  }
  const purchasesParsed = PurchasesRow.array().safeParse(sheetRows(purchasesWb, "Purchases"));
  if (!purchasesParsed.success) {
    return NextResponse.json(
      { error: `Validation failed in Purchases file: ${formatIssues(purchasesParsed.error)}` },
      { status: 400 },
    );
  }
  if (purchasesParsed.data.length === 0) {
    return NextResponse.json({ error: "No purchase rows to import" }, { status: 400 });
  }

  // 5. Resolve ids: auto-generate blanks in sequence, normalize the rest. A
  // supplier's supplier_id and a purchase's po_id are that row's OWN identity ->
  // auto-generated when blank. A purchase's supplier_id is a REFERENCE ->
  // normalized only (blank stays undefined and is caught by the orphan check).
  const supRawIds = suppliersParsed.data.map((r) => idStr(r.supplier_id));
  const nextSupplierId = makeIdGen(supRawIds, "S", 4, /^S(\d+)$/);
  const suppliers: (SupplierRowData & { supplier_id: string })[] = suppliersParsed.data.map(
    (r, i) => ({ ...r, supplier_id: supRawIds[i] ?? nextSupplierId() }),
  );

  const poRawIds = purchasesParsed.data.map((r) => idStr(r.po_id));
  const nextPoId = makeIdGen(poRawIds, "PO-", 7, /^PO-(\d+)$/);
  const purchases: (PurchaseRowData & { po_id: string; supplier_id: string | undefined })[] =
    purchasesParsed.data.map((r, i) => ({
      ...r,
      po_id: poRawIds[i] ?? nextPoId(),
      supplier_id: idStr(r.supplier_id),
    }));

  // 6. Uniqueness of resolved own-identity ids (a duplicate would violate the DB
  // unique constraints later with an opaque error — catch it here with context).
  const dupSupplier = firstDuplicate(suppliers.map((s) => s.supplier_id));
  if (dupSupplier) {
    return NextResponse.json(
      { error: `Duplicate supplier_id in Suppliers file: ${dupSupplier}` },
      { status: 400 },
    );
  }
  const dupPo = firstDuplicate(purchases.map((p) => p.po_id));
  if (dupPo) {
    return NextResponse.json(
      { error: `Duplicate po_id in Purchases file: ${dupPo}` },
      { status: 400 },
    );
  }

  // 7. Orphan check: EVERY purchase's supplier_id must resolve to a supplier in
  // the uploaded Suppliers file OR already in the DB. Blocks with a report of
  // the offending rows — no silent partial data. (Row numbers are 1-based over
  // the data rows, i.e. spreadsheet row = number + 1 for the header.)
  const fileSupplierIds = new Set(suppliers.map((s) => s.supplier_id));
  const dbSuppliers = await prisma.supplier.findMany({
    select: { externalId: true },
    distinct: ["externalId"],
  });
  const knownSupplierIds = new Set<string>([
    ...fileSupplierIds,
    ...dbSuppliers.map((s) => s.externalId),
  ]);
  const orphans = purchases
    .map((p, i) => ({ row: i + 1, po_id: p.po_id, supplier_id: p.supplier_id }))
    .filter((p) => !p.supplier_id || !knownSupplierIds.has(p.supplier_id));
  if (orphans.length > 0) {
    const sample = orphans
      .slice(0, 5)
      .map((o) => `row ${o.row} (${o.po_id} → ${o.supplier_id ?? "«blank»"})`)
      .join("; ");
    const missing = [...new Set(orphans.map((o) => o.supplier_id ?? "«blank»"))];
    return NextResponse.json(
      {
        error:
          `Import blocked: ${orphans.length} purchase row(s) reference a supplier that isn't ` +
          `in the Suppliers file or the database. Missing supplier_id(s): ${missing.join(", ")}. ` +
          `First offending rows: ${sample}.`,
      },
      { status: 400 },
    );
  }

  // 8. Auto-create reporting periods from the YEARS present in Purchases. Periods
  // are keyed by PAYMENT date (when cash leaves), falling back to PR date for any
  // row missing a payment. This is what surfaces e.g. a 2026 period from payments
  // that settle after their 2025 POs.
  let years: number[];
  try {
    years = [
      ...new Set(
        purchases.map((r) =>
          (r.payment_date
            ? parseExcelDate(r.payment_date)
            : parseExcelDate(r.pr_date)
          ).getUTCFullYear(),
        ),
      ),
    ].sort((a, b) => a - b);
  } catch (err) {
    return NextResponse.json(
      { error: `Date parsing failed in Purchases file: ${(err as Error).message}` },
      { status: 400 },
    );
  }

  const yearToPeriodId = new Map<number, string>();
  for (const year of years) {
    const rp = await prisma.reportingPeriod.upsert({
      where: { name: String(year) },
      create: {
        name: String(year),
        startDate: new Date(Date.UTC(year, 0, 1)),
        endDate: new Date(Date.UTC(year, 11, 31, 23, 59, 59)),
      },
      update: {}, // never mutate an existing period
    });
    yearToPeriodId.set(year, rp.id);
  }
  // Suppliers aren't year-specific; tag them to the latest detected year.
  const maxYearPeriodId = yearToPeriodId.get(years[years.length - 1])!;
  const affectedPeriodIds = [...yearToPeriodId.values()];

  // 9. Transform column names -> Prisma field names (+ period tagging).
  const supplierData = suppliers.map((r) => ({
    externalId: r.supplier_id,
    supplierName: r.supplier_name,
    country: r.country,
    category: r.category,
    periodId: maxYearPeriodId,
  }));

  let purchaseData;
  try {
    purchaseData = purchases.map((r) => {
      const prDate = parseExcelDate(r.pr_date);
      const invoiceDate = parseExcelDate(r.invoice_date);
      const paymentDate = parseExcelDate(r.payment_date);
      return {
        poId: r.po_id,
        supplierExternalId: r.supplier_id!, // guaranteed by the orphan check above
        supplierName: r.supplier_name,
        category: r.category,
        itemName: r.item_name,
        unit: r.unit,
        quantity: r.quantity,
        unitPriceUsd: r.unit_price_usd,
        totalValueUsd: r.total_value_usd,
        prDate,
        poDate: parseExcelDate(r.po_date),
        deliveryDate: parseExcelDate(r.delivery_date),
        invoiceDate,
        paymentDate,
        prToPoDays: r.pr_to_po_days,
        poToDeliveryDays: r.po_to_delivery_days,
        deliveryToInvoiceDays: r.delivery_to_invoice_days,
        invoiceToPaymentDays: r.invoice_to_payment_days,
        totalCycleDays: r.total_cycle_days,
        onTimeDelivery: r.on_time_delivery,
        threeWayMatchPass: r.three_way_match_pass,
        defectCount: r.defect_count,
        complaintCount: r.complaint_count,
        // Tag each purchase to the period for the YEAR it was paid (when cash
        // leaves), falling back to its pr_date year if no payment.
        periodId: yearToPeriodId.get((paymentDate ?? prDate).getUTCFullYear())!,
      };
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Date parsing failed in Purchases file: ${(err as Error).message}` },
      { status: 400 },
    );
  }

  // 10. COMPUTE the derived scores SERVER-SIDE from the raw inputs. This runs the
  // SAME proven engine (python/scores.py via import_compute) that the offline
  // transformer uses, producing one per-period SupplierMetric row per active
  // supplier-period (payment-year bucketed, all scores + operational aggregates).
  // Supplier identity is sourced from the Suppliers rows (the SupplierMetrics
  // sheet was dropped). ⚠️ ATOMICITY: this happens BEFORE any DB write, so a
  // compute failure aborts the import with NO partial state.
  const computed = await runImportCompute({
    suppliers: suppliers.map((s) => ({
      supplier_id: s.supplier_id,
      supplier_name: s.supplier_name,
      country: s.country,
      category: s.category,
    })),
    purchases: purchases.map((p) => ({ ...p, supplier_id: p.supplier_id! })),
  });
  if (computed.code !== 0 || !computed.rows) {
    console.error("import_compute failed:", computed.stderr);
    return NextResponse.json(
      { error: "Score computation failed — no data was imported." },
      { status: 500 },
    );
  }

  // Map each computed per-period row to a SupplierMetric write. `period` is the
  // payment-year int; fall back to the latest year if it somehow isn't among the
  // detected purchase years (shouldn't happen — both derive from the same POs).
  const metricData = computed.rows.map((r) => ({
    supplierExternalId: r.supplier_id,
    supplierName: r.supplier_name,
    category: r.category,
    totalSpendUsd: r.total_spend_usd,
    numPos: r.num_pos,
    avgPoValueUsd: r.avg_po_value_usd,
    avgLeadTimeDays: r.avg_lead_time_days,
    avgCycleTimeDays: r.avg_cycle_time_days,
    onTimeDeliveryPct: r.on_time_delivery_pct,
    threeWayMatchPct: r.three_way_match_pct,
    qualityScore: r.quality_score,
    deliveryScore: r.delivery_score,
    processScore: r.process_score,
    riskScore: r.risk_score,
    compositeScore: r.composite_score,
    periodId: yearToPeriodId.get(r.period) ?? maxYearPeriodId,
  }));

  // 11a. Create PROCESSING import records OUTSIDE the data transaction, so a
  // FAILED status survives a rollback and stays visible in the audit table.
  const sheetMeta = [
    { fileType: "suppliers", rowCount: supplierData.length, filename: suppliersFilename },
    { fileType: "purchases", rowCount: purchaseData.length, filename: purchasesFilename },
    { fileType: "supplier_metrics", rowCount: metricData.length, filename: purchasesFilename },
  ];
  const importRecords = await Promise.all(
    sheetMeta.map((meta) =>
      prisma.import.create({
        data: {
          userId: session.userId,
          periodId: maxYearPeriodId,
          filename: meta.filename,
          fileType: meta.fileType,
          rowCount: 0,
          status: "PROCESSING",
        },
      }),
    ),
  );

  // 11b-c. Single transaction: delete-then-insert for all three tables
  try {
    await prisma.$transaction(
      async (tx) => {
        const where = { periodId: { in: affectedPeriodIds } };
        await tx.supplier.deleteMany({ where });
        await tx.supplier.createMany({ data: supplierData });

        await tx.purchase.deleteMany({ where });
        await tx.purchase.createMany({ data: purchaseData });

        await tx.supplierMetric.deleteMany({ where });
        await tx.supplierMetric.createMany({ data: metricData });
      },
      { timeout: 30000 },
    );
  } catch (err) {
    // 12. Mark imports FAILED (records exist because they were created above)
    const message = (err as Error).message?.slice(0, 500) ?? "Unknown error";
    await Promise.all(
      importRecords.map((imp) =>
        prisma.import.update({
          where: { id: imp.id },
          data: { status: "FAILED", errorMessage: message },
        }),
      ),
    );
    return NextResponse.json(
      { error: "Import failed during database write. No partial data was saved." },
      { status: 500 },
    );
  }

  // 11d. Mark imports SUCCESS with row counts
  const processedAt = new Date();
  await Promise.all(
    importRecords.map((imp, idx) =>
      prisma.import.update({
        where: { id: imp.id },
        data: {
          status: "SUCCESS",
          rowCount: sheetMeta[idx].rowCount,
          processedAt,
        },
      }),
    ),
  );

  // 13. Compute analyses for EACH detected year period, SEQUENTIALLY (avoids
  // concurrent python/DB contention). Data is already committed, so a compute
  // failure does NOT fail the upload — recompute via POST /api/analyses/compute.
  let analysesComputed = true;
  for (const year of years) {
    const compute = await runComputeAnalyses(yearToPeriodId.get(year)!);
    if (compute.code !== 0) {
      analysesComputed = false;
      console.error(`compute_analyses failed for ${year}:`, compute.stderr);
    }
  }

  // 13b. Invalidate the cached RANGE results — the data has changed, so every
  // cached range must be recomputed on next view. (Range rows are the ones with
  // a null periodId.)
  await prisma.analysisResult.deleteMany({ where: { periodId: null } });

  // 14. Summary
  return NextResponse.json({
    success: true,
    suppliers: supplierData.length,
    purchases: purchaseData.length,
    metrics: metricData.length,
    analyses_computed: analysesComputed,
    periodsCreated: years.map(String),
  });
}
