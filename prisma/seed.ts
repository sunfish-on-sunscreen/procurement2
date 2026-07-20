import "dotenv/config";
import path from "node:path";
import fs from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import bcrypt from "bcrypt";
import * as xlsx from "xlsx";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const DATA_FILE = path.join(
  process.cwd(),
  "data",
  "raw",
  "procurement_dataset_full.xlsx",
);

// --- helpers ---------------------------------------------------------------
type Row = Record<string, unknown>;

/** String, trimmed; empty / blank → null (used for optional FKs + optional text). */
function s(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}
/** Required string (never null; blank collapses to ""). */
function str(v: unknown): string {
  return v === undefined || v === null ? "" : String(v).trim();
}
function num(v: unknown): number {
  if (v === undefined || v === null || v === "") return 0;
  return typeof v === "number" ? v : Number(v);
}
function int(v: unknown): number {
  return Math.round(num(v));
}
function bool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return String(v).trim().toLowerCase() === "true";
}
/** Date | null; xlsx is read with cellDates:true so date cells are JS Dates. */
function date(v: unknown): Date | null {
  if (v === undefined || v === null || v === "") return null;
  if (v instanceof Date) return v;
  const d = new Date(v as string);
  return isNaN(d.getTime()) ? null : d;
}
/** Required date (throws surface a bad row rather than a silent null insert). */
function reqDate(v: unknown, ctx: string): Date {
  const d = date(v);
  if (!d) throw new Error(`Missing/invalid required date in ${ctx}: ${String(v)}`);
  return d;
}

function readSheet(wb: xlsx.WorkBook, name: string): Row[] {
  const sheet = wb.Sheets[name];
  if (!sheet) throw new Error(`Sheet "${name}" not found in ${DATA_FILE}`);
  return xlsx.utils.sheet_to_json<Row>(sheet, { defval: null });
}

/** createMany in chunks (keeps well under the pg parameter ceiling). */
async function insertChunked<T>(
  label: string,
  rows: T[],
  create: (chunk: T[]) => Promise<{ count: number }>,
  size = 500,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < rows.length; i += size) {
    const res = await create(rows.slice(i, i + size));
    total += res.count;
  }
  console.log(`  ${label}: inserted ${total}`);
  return total;
}

// Reporting periods: order-year buckets with calendar-year bounds. Membership is
// by PurchaseOrder.period; these bounds drive the compute layer's Mode A window.
const PERIODS = ["2024", "2025", "2026"] as const;

async function seedUsers() {
  const users = [
    { email: "admin@mail.com", password: "admin123", name: "Admin User", role: "ADMIN" as const },
    { email: "viewer@mail.com", password: "viewer123", name: "Viewer User", role: "VIEWER" as const },
  ];
  for (const u of users) {
    const passwordHash = await bcrypt.hash(u.password, 12);
    await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, passwordHash },
      create: { email: u.email, name: u.name, role: u.role, passwordHash },
    });
  }
  console.log(`  users: ${await prisma.user.count()}`);
}

async function seedPeriods() {
  for (const name of PERIODS) {
    const y = Number(name);
    await prisma.reportingPeriod.upsert({
      where: { name },
      update: {},
      create: {
        name,
        startDate: new Date(Date.UTC(y, 0, 1, 0, 0, 0)),
        endDate: new Date(Date.UTC(y, 11, 31, 23, 59, 59)),
      },
    });
  }
  console.log(`  reportingPeriods: ${await prisma.reportingPeriod.count()}`);
}

/** Wipe the 12 transaction tables in reverse-FK order so the seed is re-runnable. */
async function clearTransactionTables() {
  await prisma.payment.deleteMany();
  await prisma.invoiceLine.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.grnLine.deleteMany();
  await prisma.goodsReceipt.deleteMany();
  await prisma.poLine.deleteMany();
  await prisma.purchaseOrder.deleteMany();
  await prisma.response.deleteMany();
  await prisma.sourcingEvent.deleteMany();
  await prisma.requisition.deleteMany();
  await prisma.framework.deleteMany();
  // SupplierChangeLog FKs Supplier with ON DELETE RESTRICT, so its rows must go
  // first or the supplier wipe below fails. A full re-seed replaces the supplier
  // master outright, which makes the old master-data audit history meaningless.
  await prisma.supplierChangeLog.deleteMany();
  await prisma.supplier.deleteMany();
}

async function main() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      throw new Error(`Dataset not found: ${DATA_FILE}`);
    }
    console.log(`Seeding from ${DATA_FILE}`);
    const wb = xlsx.read(new Uint8Array(fs.readFileSync(DATA_FILE)), {
      cellDates: true,
    });

    // Parse all 12 sheets up front (also gives us the file's own row counts).
    const sheets = {
      suppliers: readSheet(wb, "suppliers"),
      frameworks: readSheet(wb, "frameworks"),
      requisitions: readSheet(wb, "requisitions"),
      sourcing_events: readSheet(wb, "sourcing_events"),
      responses: readSheet(wb, "responses"),
      purchase_orders: readSheet(wb, "purchase_orders"),
      po_lines: readSheet(wb, "po_lines"),
      goods_receipts: readSheet(wb, "goods_receipts"),
      grn_lines: readSheet(wb, "grn_lines"),
      invoices: readSheet(wb, "invoices"),
      invoice_lines: readSheet(wb, "invoice_lines"),
      payments: readSheet(wb, "payments"),
    };

    console.log("Auth + periods:");
    await seedUsers();
    await seedPeriods();

    console.log("Clearing transaction tables…");
    await clearTransactionTables();

    console.log("Inserting normalized transaction data (FK order):");

    // 1. Supplier (master)
    await insertChunked("suppliers", sheets.suppliers, (c) =>
      prisma.supplier.createMany({
        data: c.map((r) => ({
          id: str(r.supplier_id),
          supplierName: str(r.supplier_name),
          country: str(r.country),
          category: str(r.category),
          status: str(r.status),
          isMiningService: bool(r.is_mining_service),
          iujpNo: s(r.iujp_no),
          iujpValidUntil: date(r.iujp_valid_until),
        })),
      }),
    );

    // 2. Framework
    await insertChunked("frameworks", sheets.frameworks, (c) =>
      prisma.framework.createMany({
        data: c.map((r) => ({
          id: str(r.framework_id),
          supplierId: str(r.supplier_id),
          title: str(r.title),
          category: str(r.category),
          startDate: reqDate(r.start_date, "frameworks.start_date"),
          endDate: reqDate(r.end_date, "frameworks.end_date"),
          status: str(r.status),
        })),
      }),
    );

    // 3. Requisition
    await insertChunked("requisitions", sheets.requisitions, (c) =>
      prisma.requisition.createMany({
        data: c.map((r) => ({
          id: str(r.pr_id),
          prDate: reqDate(r.pr_date, "requisitions.pr_date"),
          requester: str(r.requester),
          department: str(r.department),
          category: str(r.category),
          needByDate: reqDate(r.need_by_date, "requisitions.need_by_date"),
          estimatedValueUsd: num(r.estimated_value_usd),
          status: str(r.status),
        })),
      }),
    );

    // 4. SourcingEvent (awarded_supplier_id / awarded_response_id optional)
    await insertChunked("sourcing_events", sheets.sourcing_events, (c) =>
      prisma.sourcingEvent.createMany({
        data: c.map((r) => ({
          id: str(r.sourcing_event_id),
          prId: str(r.pr_id),
          issueDate: reqDate(r.issue_date, "sourcing_events.issue_date"),
          closeDate: reqDate(r.close_date, "sourcing_events.close_date"),
          numSuppliersInvited: int(r.num_suppliers_invited),
          awardedSupplierId: s(r.awarded_supplier_id),
          awardedResponseId: s(r.awarded_response_id),
        })),
      }),
    );

    // 5. Response
    await insertChunked("responses", sheets.responses, (c) =>
      prisma.response.createMany({
        data: c.map((r) => ({
          id: str(r.response_id),
          sourcingEventId: str(r.sourcing_event_id),
          supplierId: str(r.supplier_id),
          quotedUnitPriceUsd: num(r.quoted_unit_price_usd),
          quotedLeadTimeDays: int(r.quoted_lead_time_days),
          submittedDate: reqDate(r.submitted_date, "responses.submitted_date"),
          isAwarded: bool(r.is_awarded),
        })),
      }),
    );

    // 6. PurchaseOrder (sourcing_event_id / framework_id / justification optional)
    await insertChunked("purchase_orders", sheets.purchase_orders, (c) =>
      prisma.purchaseOrder.createMany({
        data: c.map((r) => ({
          id: str(r.po_id),
          prId: str(r.pr_id),
          sourcingEventId: s(r.sourcing_event_id),
          supplierId: str(r.supplier_id),
          buyingMethod: str(r.buying_method),
          frameworkId: s(r.framework_id),
          justification: s(r.justification),
          poDate: reqDate(r.po_date, "purchase_orders.po_date"),
          promisedDeliveryDate: reqDate(r.promised_delivery_date, "purchase_orders.promised_delivery_date"),
          paymentTerms: str(r.payment_terms),
          complaintCount: int(r.complaint_count),
          status: str(r.status),
          period: str(r.period),
        })),
      }),
    );

    // 7. PoLine
    await insertChunked("po_lines", sheets.po_lines, (c) =>
      prisma.poLine.createMany({
        data: c.map((r) => ({
          id: str(r.po_line_id),
          poId: str(r.po_id),
          itemName: str(r.item_name),
          category: str(r.category),
          unit: str(r.unit),
          quantityOrdered: num(r.quantity_ordered),
          unitPriceUsd: num(r.unit_price_usd),
          needByDate: reqDate(r.need_by_date, "po_lines.need_by_date"),
        })),
      }),
    );

    // 8. GoodsReceipt
    await insertChunked("goods_receipts", sheets.goods_receipts, (c) =>
      prisma.goodsReceipt.createMany({
        data: c.map((r) => ({
          id: str(r.grn_id),
          poId: str(r.po_id),
          receiptDate: reqDate(r.receipt_date, "goods_receipts.receipt_date"),
          receivedBy: str(r.received_by),
          site: str(r.site),
          status: str(r.status),
        })),
      }),
    );

    // 9. GrnLine
    await insertChunked("grn_lines", sheets.grn_lines, (c) =>
      prisma.grnLine.createMany({
        data: c.map((r) => ({
          id: str(r.grn_line_id),
          grnId: str(r.grn_id),
          poLineId: str(r.po_line_id),
          quantityReceived: num(r.quantity_received),
          quantityRejected: num(r.quantity_rejected),
          defectCount: int(r.defect_count),
        })),
      }),
    );

    // 10. Invoice
    await insertChunked("invoices", sheets.invoices, (c) =>
      prisma.invoice.createMany({
        data: c.map((r) => ({
          id: str(r.invoice_id),
          poId: str(r.po_id),
          supplierId: str(r.supplier_id),
          supplierInvoiceNo: str(r.supplier_invoice_no),
          invoiceDate: reqDate(r.invoice_date, "invoices.invoice_date"),
          totalAmountUsd: num(r.total_amount_usd),
          status: str(r.status),
        })),
      }),
    );

    // 11. InvoiceLine
    await insertChunked("invoice_lines", sheets.invoice_lines, (c) =>
      prisma.invoiceLine.createMany({
        data: c.map((r) => ({
          id: str(r.invoice_line_id),
          invoiceId: str(r.invoice_id),
          poLineId: str(r.po_line_id),
          quantityBilled: num(r.quantity_billed),
          unitPriceUsd: num(r.unit_price_usd),
        })),
      }),
    );

    // 12. Payment
    await insertChunked("payments", sheets.payments, (c) =>
      prisma.payment.createMany({
        data: c.map((r) => ({
          id: str(r.payment_id),
          invoiceId: str(r.invoice_id),
          paymentDate: reqDate(r.payment_date, "payments.payment_date"),
          amountPaidUsd: num(r.amount_paid_usd),
          method: str(r.method),
        })),
      }),
    );

    // --- CHECKPOINT: DB counts vs file row counts --------------------------
    const dbCounts = {
      suppliers: await prisma.supplier.count(),
      frameworks: await prisma.framework.count(),
      requisitions: await prisma.requisition.count(),
      sourcing_events: await prisma.sourcingEvent.count(),
      responses: await prisma.response.count(),
      purchase_orders: await prisma.purchaseOrder.count(),
      po_lines: await prisma.poLine.count(),
      goods_receipts: await prisma.goodsReceipt.count(),
      grn_lines: await prisma.grnLine.count(),
      invoices: await prisma.invoice.count(),
      invoice_lines: await prisma.invoiceLine.count(),
      payments: await prisma.payment.count(),
    } as const;

    console.log("\n=== CHECKPOINT: row counts (DB vs file) ===");
    let allMatch = true;
    for (const key of Object.keys(dbCounts) as (keyof typeof dbCounts)[]) {
      const db = dbCounts[key];
      const file = sheets[key].length;
      const ok = db === file;
      if (!ok) allMatch = false;
      console.log(`  ${key.padEnd(16)} DB=${String(db).padStart(5)}  file=${String(file).padStart(5)}  ${ok ? "OK" : "*** MISMATCH ***"}`);
    }
    console.log(
      `\nreportingPeriods: ${await prisma.reportingPeriod.count()}  |  users: ${await prisma.user.count()}`,
    );
    console.log(allMatch ? "\nAll 12 tables reconcile with the file. ✅" : "\n*** COUNT MISMATCH — investigate. ***");
    if (!allMatch) process.exitCode = 1;
  } catch (error) {
    console.error("Seed failed:", error);
    process.exitCode = 1;
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main();
