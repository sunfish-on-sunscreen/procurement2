import { NextResponse } from "next/server";
import * as xlsx from "xlsx";
import { z } from "zod";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { runComputeAnalyses } from "@/lib/python";

export const runtime = "nodejs";

const REQUIRED_SHEETS = ["Suppliers", "Purchases", "SupplierMetrics"] as const;

// Dates arrive from the xlsx parser as ISO strings (the sample stores them as
// text). Accept Date too, in case a future file stores real Excel dates.
const dateLike = z.union([z.date(), z.string()]);

const SuppliersRow = z.object({
  supplier_id: z.string(),
  supplier_name: z.string(),
  country: z.string(),
  category: z.string(),
  product_description: z.string(),
  tier: z.string(),
});

const PurchasesRow = z.object({
  po_id: z.string(),
  supplier_id: z.string(),
  supplier_name: z.string(),
  category: z.string(),
  item_description: z.string(),
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
  automation_period: z.string(),
});

// The SupplierMetrics sheet also carries country + product_description columns
// that are not in the schema; zod strips unknown keys by default.
const SupplierMetricsRow = z.object({
  supplier_id: z.string(),
  supplier_name: z.string(),
  category: z.string(),
  tier: z.string(),
  total_spend_usd: z.number(),
  num_pos: z.number().int(),
  avg_po_value_usd: z.number(),
  avg_lead_time_days: z.number(),
  avg_cycle_time_days: z.number(),
  on_time_delivery_pct: z.number(),
  three_way_match_pct: z.number(),
  defect_rate_pct: z.number(),
  complaint_count_annual: z.number().int(),
  rfx_response_rate_pct: z.number(),
  avg_response_time_days: z.number(),
  single_source_risk: z.number().int(),
  quality_score: z.number(),
  delivery_score: z.number(),
  service_score: z.number(),
  process_score: z.number(),
  risk_score: z.number(),
  composite_score: z.number(),
  calculated_tier: z.string(),
  tier_mismatch: z.boolean(),
});

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

export async function POST(request: Request) {
  // 1. Auth: ADMIN only
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  // 2. Parse form data
  let formData: FormData;
  try {
    formData = await request.formData();
  } catch {
    return NextResponse.json({ error: "Invalid form data" }, { status: 400 });
  }
  const file = formData.get("file");
  if (!(file instanceof Blob)) {
    return NextResponse.json({ error: "No file uploaded" }, { status: 400 });
  }
  const filename = file instanceof File ? file.name : "upload.xlsx";

  // 4. Parse workbook
  let workbook: xlsx.WorkBook;
  try {
    const buffer = new Uint8Array(await file.arrayBuffer());
    workbook = xlsx.read(buffer, { type: "array", cellDates: true });
  } catch {
    return NextResponse.json({ error: "Could not read the Excel file" }, { status: 400 });
  }

  // 5. Validate required sheets are present
  for (const sheet of REQUIRED_SHEETS) {
    if (!workbook.SheetNames.includes(sheet)) {
      return NextResponse.json(
        { error: `Missing required sheet: ${sheet}` },
        { status: 400 },
      );
    }
  }

  // 6. Sheet -> JSON
  const suppliersRaw = xlsx.utils.sheet_to_json(workbook.Sheets["Suppliers"]);
  const purchasesRaw = xlsx.utils.sheet_to_json(workbook.Sheets["Purchases"]);
  const metricsRaw = xlsx.utils.sheet_to_json(workbook.Sheets["SupplierMetrics"]);

  // 7-8. Validate ALL rows BEFORE any DB writes (fail-fast)
  const suppliersParsed = SuppliersRow.array().safeParse(suppliersRaw);
  if (!suppliersParsed.success) {
    return NextResponse.json(
      { error: `Validation failed in Suppliers sheet: ${formatIssues(suppliersParsed.error)}` },
      { status: 400 },
    );
  }
  const purchasesParsed = PurchasesRow.array().safeParse(purchasesRaw);
  if (!purchasesParsed.success) {
    return NextResponse.json(
      { error: `Validation failed in Purchases sheet: ${formatIssues(purchasesParsed.error)}` },
      { status: 400 },
    );
  }
  const metricsParsed = SupplierMetricsRow.array().safeParse(metricsRaw);
  if (!metricsParsed.success) {
    return NextResponse.json(
      { error: `Validation failed in SupplierMetrics sheet: ${formatIssues(metricsParsed.error)}` },
      { status: 400 },
    );
  }

  // 9. Auto-create reporting periods from the YEARS present in Purchases.
  // Periods are keyed by INVOICE date (when spend is realized), falling back to
  // PR date for any row missing an invoice. This is what surfaces e.g. a 2026
  // period from invoices that arrive after their 2025 POs.
  let years: number[];
  try {
    years = [
      ...new Set(
        purchasesParsed.data.map((r) =>
          (r.invoice_date
            ? parseExcelDate(r.invoice_date)
            : parseExcelDate(r.pr_date)
          ).getUTCFullYear(),
        ),
      ),
    ].sort((a, b) => a - b);
  } catch (err) {
    return NextResponse.json(
      { error: `Date parsing failed in Purchases sheet: ${(err as Error).message}` },
      { status: 400 },
    );
  }
  if (years.length === 0) {
    return NextResponse.json({ error: "No purchase rows to import" }, { status: 400 });
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
  // Suppliers/metrics aren't year-specific; tag them to the latest detected year.
  const maxYearPeriodId = yearToPeriodId.get(years[years.length - 1])!;
  const affectedPeriodIds = [...yearToPeriodId.values()];

  // 10. Transform CSV column names -> Prisma field names (+ period tagging)
  const supplierData = suppliersParsed.data.map((r) => ({
    externalId: r.supplier_id,
    supplierName: r.supplier_name,
    country: r.country,
    category: r.category,
    productDescription: r.product_description,
    tier: r.tier,
    periodId: maxYearPeriodId,
  }));

  let purchaseData;
  try {
    purchaseData = purchasesParsed.data.map((r) => {
      const prDate = parseExcelDate(r.pr_date);
      const invoiceDate = parseExcelDate(r.invoice_date);
      return {
        poId: r.po_id,
        supplierExternalId: r.supplier_id,
        supplierName: r.supplier_name,
        category: r.category,
        itemDescription: r.item_description,
        unit: r.unit,
        quantity: r.quantity,
        unitPriceUsd: r.unit_price_usd,
        totalValueUsd: r.total_value_usd,
        prDate,
        poDate: parseExcelDate(r.po_date),
        deliveryDate: parseExcelDate(r.delivery_date),
        invoiceDate,
        paymentDate: parseExcelDate(r.payment_date),
        prToPoDays: r.pr_to_po_days,
        poToDeliveryDays: r.po_to_delivery_days,
        deliveryToInvoiceDays: r.delivery_to_invoice_days,
        invoiceToPaymentDays: r.invoice_to_payment_days,
        totalCycleDays: r.total_cycle_days,
        onTimeDelivery: r.on_time_delivery,
        threeWayMatchPass: r.three_way_match_pass,
        automationPeriod: r.automation_period,
        // Tag each purchase to the period for the YEAR it was invoiced (when
        // spend is realized), falling back to its pr_date year if no invoice.
        periodId: yearToPeriodId.get(
          (invoiceDate ?? prDate).getUTCFullYear(),
        )!,
      };
    });
  } catch (err) {
    return NextResponse.json(
      { error: `Date parsing failed in Purchases sheet: ${(err as Error).message}` },
      { status: 400 },
    );
  }

  const metricData = metricsParsed.data.map((r) => ({
    supplierExternalId: r.supplier_id,
    supplierName: r.supplier_name,
    category: r.category,
    tier: r.tier,
    totalSpendUsd: r.total_spend_usd,
    numPos: r.num_pos,
    avgPoValueUsd: r.avg_po_value_usd,
    avgLeadTimeDays: r.avg_lead_time_days,
    avgCycleTimeDays: r.avg_cycle_time_days,
    onTimeDeliveryPct: r.on_time_delivery_pct,
    threeWayMatchPct: r.three_way_match_pct,
    defectRatePct: r.defect_rate_pct,
    complaintCountAnnual: r.complaint_count_annual,
    rfxResponseRatePct: r.rfx_response_rate_pct,
    avgResponseTimeDays: r.avg_response_time_days,
    singleSourceRisk: r.single_source_risk,
    qualityScore: r.quality_score,
    deliveryScore: r.delivery_score,
    serviceScore: r.service_score,
    processScore: r.process_score,
    riskScore: r.risk_score,
    compositeScore: r.composite_score,
    calculatedTier: r.calculated_tier,
    tierMismatch: r.tier_mismatch,
    periodId: maxYearPeriodId,
  }));

  // 11a. Create PROCESSING import records OUTSIDE the data transaction, so a
  // FAILED status survives a rollback and stays visible in the audit table.
  const sheetMeta = [
    { fileType: "suppliers", rowCount: supplierData.length },
    { fileType: "purchases", rowCount: purchaseData.length },
    { fileType: "supplier_metrics", rowCount: metricData.length },
  ];
  const importRecords = await Promise.all(
    sheetMeta.map((meta) =>
      prisma.import.create({
        data: {
          userId: session.userId,
          periodId: maxYearPeriodId,
          filename,
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
