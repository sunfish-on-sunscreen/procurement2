import * as xlsx from "xlsx";
import type { Prisma } from "@/lib/generated/prisma/client";

/**
 * The 12-sheet normalized dataset: parse, validate, wipe, insert.
 *
 * ONE proven path shared by `prisma/seed.ts` and the admin upload route, so a
 * re-import cannot drift from the seed. The 12 sheets are a referentially closed
 * graph keyed by natural ids from the file, which is why the importer is
 * REPLACE-ALL: there is no meaningful merge key between two independently
 * generated corpora, and appending one would invite dangling FKs and duplicate PKs.
 */

export type Row = Record<string, unknown>;

/** Sheets in FK order — this is also the insert order. */
export const SHEET_NAMES = [
  "suppliers",
  "frameworks",
  "requisitions",
  "sourcing_events",
  "responses",
  "purchase_orders",
  "po_lines",
  "goods_receipts",
  "grn_lines",
  "invoices",
  "invoice_lines",
  "payments",
] as const;

export type SheetName = (typeof SHEET_NAMES)[number];
export type Dataset = Record<SheetName, Row[]>;

/** Sheets that must carry rows — without them the compute layer has nothing to do. */
const MUST_BE_NON_EMPTY: SheetName[] = ["suppliers", "requisitions", "purchase_orders", "po_lines"];

/** Required columns per sheet. Extra columns are ignored. */
export const REQUIRED_COLUMNS: Record<SheetName, string[]> = {
  suppliers: ["supplier_id", "supplier_name", "country", "category", "status", "is_mining_service"],
  frameworks: ["framework_id", "supplier_id", "title", "category", "start_date", "end_date", "status"],
  requisitions: ["pr_id", "pr_date", "requester", "department", "category", "need_by_date", "estimated_value_usd", "status"],
  sourcing_events: ["sourcing_event_id", "pr_id", "issue_date", "close_date", "num_suppliers_invited"],
  responses: ["response_id", "sourcing_event_id", "supplier_id", "quoted_unit_price_usd", "quoted_lead_time_days", "submitted_date", "is_awarded"],
  purchase_orders: ["po_id", "pr_id", "supplier_id", "buying_method", "po_date", "promised_delivery_date", "payment_terms", "complaint_count", "status", "period"],
  po_lines: ["po_line_id", "po_id", "item_name", "category", "unit", "quantity_ordered", "unit_price_usd", "need_by_date"],
  goods_receipts: ["grn_id", "po_id", "receipt_date", "received_by", "site", "status"],
  grn_lines: ["grn_line_id", "grn_id", "po_line_id", "quantity_received", "quantity_rejected", "defect_count"],
  invoices: ["invoice_id", "po_id", "supplier_id", "supplier_invoice_no", "invoice_date", "total_amount_usd", "status"],
  invoice_lines: ["invoice_line_id", "invoice_id", "po_line_id", "quantity_billed", "unit_price_usd"],
  payments: ["payment_id", "invoice_id", "payment_date", "amount_paid_usd", "method"],
};

/** Primary-key column per sheet. */
const PK_COLUMN: Record<SheetName, string> = {
  suppliers: "supplier_id",
  frameworks: "framework_id",
  requisitions: "pr_id",
  sourcing_events: "sourcing_event_id",
  responses: "response_id",
  purchase_orders: "po_id",
  po_lines: "po_line_id",
  goods_receipts: "grn_id",
  grn_lines: "grn_line_id",
  invoices: "invoice_id",
  invoice_lines: "invoice_line_id",
  payments: "payment_id",
};

/**
 * Foreign-key edges to check for closure, mirroring the Prisma relations exactly.
 *
 * `sourcing_events.awarded_response_id` is deliberately absent: it is a plain
 * nullable String in the schema with no relation (a real FK there would be
 * circular — a response points back at its sourcing event), so enforcing it here
 * would reject files the database itself accepts.
 */
const FK_EDGES: { from: SheetName; column: string; to: SheetName; optional?: boolean }[] = [
  { from: "frameworks", column: "supplier_id", to: "suppliers" },
  { from: "sourcing_events", column: "pr_id", to: "requisitions" },
  { from: "sourcing_events", column: "awarded_supplier_id", to: "suppliers", optional: true },
  { from: "responses", column: "sourcing_event_id", to: "sourcing_events" },
  { from: "responses", column: "supplier_id", to: "suppliers" },
  { from: "purchase_orders", column: "pr_id", to: "requisitions" },
  { from: "purchase_orders", column: "sourcing_event_id", to: "sourcing_events", optional: true },
  { from: "purchase_orders", column: "supplier_id", to: "suppliers" },
  { from: "purchase_orders", column: "framework_id", to: "frameworks", optional: true },
  { from: "po_lines", column: "po_id", to: "purchase_orders" },
  { from: "goods_receipts", column: "po_id", to: "purchase_orders" },
  { from: "grn_lines", column: "grn_id", to: "goods_receipts" },
  { from: "grn_lines", column: "po_line_id", to: "po_lines" },
  { from: "invoices", column: "po_id", to: "purchase_orders" },
  { from: "invoices", column: "supplier_id", to: "suppliers" },
  { from: "invoice_lines", column: "invoice_id", to: "invoices" },
  { from: "invoice_lines", column: "po_line_id", to: "po_lines" },
  { from: "payments", column: "invoice_id", to: "invoices" },
];

// --- cell coercion ---------------------------------------------------------

/** String, trimmed; empty / blank → null (optional FKs + optional text). */
export function s(v: unknown): string | null {
  if (v === undefined || v === null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}
/** Required string (never null; blank collapses to ""). */
export function str(v: unknown): string {
  return v === undefined || v === null ? "" : String(v).trim();
}
export function num(v: unknown): number {
  if (v === undefined || v === null || v === "") return 0;
  return typeof v === "number" ? v : Number(v);
}
export function int(v: unknown): number {
  return Math.round(num(v));
}
export function bool(v: unknown): boolean {
  if (typeof v === "boolean") return v;
  if (typeof v === "number") return v !== 0;
  return String(v).trim().toLowerCase() === "true";
}
/** Date | null; workbooks are read with cellDates so date cells arrive as Dates. */
export function date(v: unknown): Date | null {
  if (v === undefined || v === null || v === "") return null;
  if (v instanceof Date) return v;
  const d = new Date(v as string);
  return isNaN(d.getTime()) ? null : d;
}
/** Required date; a bad cell surfaces the row rather than silently inserting null. */
export function reqDate(v: unknown, ctx: string): Date {
  const d = date(v);
  if (!d) throw new Error(`Missing/invalid required date in ${ctx}: ${String(v)}`);
  return d;
}

// --- parse -----------------------------------------------------------------

/** Read one sheet; a missing sheet is an error, not an empty result. */
function readSheet(wb: xlsx.WorkBook, name: string): Row[] {
  const sheet = wb.Sheets[name];
  if (!sheet) throw new Error(`Sheet "${name}" not found in the workbook.`);
  return xlsx.utils.sheet_to_json<Row>(sheet, { defval: null });
}

/**
 * Parse a SUBSET of sheets from workbook bytes. Throws if a requested sheet is
 * missing. Used by the partial append uploads, which carry only the sheets their
 * mode needs.
 */
export function parseWorkbookSheets<T extends SheetName>(
  data: Uint8Array,
  names: readonly T[],
): Record<T, Row[]> {
  const wb = xlsx.read(data, { cellDates: true });
  const out = {} as Record<T, Row[]>;
  for (const name of names) out[name] = readSheet(wb, name);
  return out;
}

/** Parse all 12 sheets from workbook bytes. Throws if a sheet is missing. */
export function parseWorkbook(data: Uint8Array): Dataset {
  return parseWorkbookSheets(data, SHEET_NAMES);
}

// --- validate --------------------------------------------------------------

const MAX_REPORTED_ERRORS = 25;

/**
 * Structural + referential validation over the WHOLE dataset, run BEFORE any
 * write: required columns, non-empty core sheets, primary-key uniqueness, and FK
 * closure (every referenced id must exist in the file). Returns [] when valid.
 */
export function validateDataset(ds: Dataset): string[] {
  const errors: string[] = [];
  const push = (msg: string) => {
    if (errors.length < MAX_REPORTED_ERRORS) errors.push(msg);
  };

  // 1. Required columns + non-empty core sheets.
  for (const sheet of SHEET_NAMES) {
    const rows = ds[sheet];
    if (rows.length === 0) {
      if (MUST_BE_NON_EMPTY.includes(sheet)) push(`Sheet "${sheet}" is empty.`);
      continue;
    }
    const present = new Set(Object.keys(rows[0]));
    for (const col of REQUIRED_COLUMNS[sheet]) {
      if (!present.has(col)) push(`Sheet "${sheet}" is missing required column "${col}".`);
    }
  }
  if (errors.length > 0) return errors; // columns missing → id checks would be noise

  // 2. Primary-key presence + uniqueness, collecting the id sets for step 3.
  const ids: Partial<Record<SheetName, Set<string>>> = {};
  for (const sheet of SHEET_NAMES) {
    const pk = PK_COLUMN[sheet];
    const seen = new Set<string>();
    ds[sheet].forEach((row, i) => {
      const id = s(row[pk]);
      if (!id) {
        push(`Sheet "${sheet}" row ${i + 2}: missing "${pk}".`);
        return;
      }
      if (seen.has(id)) push(`Sheet "${sheet}" row ${i + 2}: duplicate ${pk} "${id}".`);
      seen.add(id);
    });
    ids[sheet] = seen;
  }

  // 3. FK closure — every referenced id must exist in the file.
  for (const edge of FK_EDGES) {
    const target = ids[edge.to];
    if (!target) continue;
    ds[edge.from].forEach((row, i) => {
      const ref = s(row[edge.column]);
      if (ref === null) {
        if (!edge.optional) {
          push(`Sheet "${edge.from}" row ${i + 2}: "${edge.column}" is required.`);
        }
        return;
      }
      if (!target.has(ref)) {
        push(
          `Sheet "${edge.from}" row ${i + 2}: ${edge.column} "${ref}" not found in "${edge.to}".`,
        );
      }
    });
  }

  return errors;
}

/** Reporting-period names (order years) the dataset covers, ascending. */
export function datasetPeriods(ds: Dataset): string[] {
  const years = new Set<string>();
  for (const row of ds.purchase_orders) {
    const p = s(row.period);
    if (p) years.add(p);
  }
  return [...years].sort();
}

// --- write -----------------------------------------------------------------

/** A Prisma client or an interactive-transaction client. */
export type DbClient = Prisma.TransactionClient;

/**
 * Wipe the 12 transaction tables in reverse-FK order.
 *
 * ⚠️ SupplierChangeLog FKs Supplier with ON DELETE RESTRICT, so callers must deal
 * with it before the supplier wipe. `clearDataset` does NOT touch it — the two
 * callers want different things (the seed discards it; the admin re-import
 * preserves what it can), so the decision stays with them.
 */
export async function clearDataset(tx: DbClient): Promise<void> {
  await tx.payment.deleteMany();
  await tx.invoiceLine.deleteMany();
  await tx.invoice.deleteMany();
  await tx.grnLine.deleteMany();
  await tx.goodsReceipt.deleteMany();
  await tx.poLine.deleteMany();
  await tx.purchaseOrder.deleteMany();
  await tx.response.deleteMany();
  await tx.sourcingEvent.deleteMany();
  await tx.requisition.deleteMany();
  await tx.framework.deleteMany();
  await tx.supplier.deleteMany();
}

/** createMany in chunks (keeps well under the pg parameter ceiling). */
async function insertChunked<T>(
  rows: T[],
  create: (chunk: T[]) => Promise<{ count: number }>,
  size = 500,
): Promise<number> {
  let total = 0;
  for (let i = 0; i < rows.length; i += size) {
    total += (await create(rows.slice(i, i + size))).count;
  }
  return total;
}

/**
 * Per-sheet row mappers: one raw sheet row -> the Prisma create payload.
 *
 * THE single definition of how a spreadsheet row becomes a database row, shared by
 * the replace-all importer and the append paths so the two can never disagree about
 * column meaning or coercion. The date coercions throw on a malformed cell, which
 * aborts the surrounding transaction.
 */
export const ROW_MAPPERS = {
  suppliers: (r: Row) => ({
    id: str(r.supplier_id),
    supplierName: str(r.supplier_name),
    country: str(r.country),
    category: str(r.category),
    status: str(r.status),
    isMiningService: bool(r.is_mining_service),
    iujpNo: s(r.iujp_no),
    iujpValidUntil: date(r.iujp_valid_until),
  }),
  frameworks: (r: Row) => ({
    id: str(r.framework_id),
    supplierId: str(r.supplier_id),
    title: str(r.title),
    category: str(r.category),
    startDate: reqDate(r.start_date, "frameworks.start_date"),
    endDate: reqDate(r.end_date, "frameworks.end_date"),
    status: str(r.status),
  }),
  requisitions: (r: Row) => ({
    id: str(r.pr_id),
    prDate: reqDate(r.pr_date, "requisitions.pr_date"),
    requester: str(r.requester),
    department: str(r.department),
    category: str(r.category),
    needByDate: reqDate(r.need_by_date, "requisitions.need_by_date"),
    estimatedValueUsd: num(r.estimated_value_usd),
    status: str(r.status),
  }),
  sourcing_events: (r: Row) => ({
    id: str(r.sourcing_event_id),
    prId: str(r.pr_id),
    issueDate: reqDate(r.issue_date, "sourcing_events.issue_date"),
    closeDate: reqDate(r.close_date, "sourcing_events.close_date"),
    numSuppliersInvited: int(r.num_suppliers_invited),
    awardedSupplierId: s(r.awarded_supplier_id),
    awardedResponseId: s(r.awarded_response_id),
  }),
  responses: (r: Row) => ({
    id: str(r.response_id),
    sourcingEventId: str(r.sourcing_event_id),
    supplierId: str(r.supplier_id),
    quotedUnitPriceUsd: num(r.quoted_unit_price_usd),
    quotedLeadTimeDays: int(r.quoted_lead_time_days),
    submittedDate: reqDate(r.submitted_date, "responses.submitted_date"),
    isAwarded: bool(r.is_awarded),
  }),
  purchase_orders: (r: Row) => ({
    id: str(r.po_id),
    prId: str(r.pr_id),
    sourcingEventId: s(r.sourcing_event_id),
    supplierId: str(r.supplier_id),
    buyingMethod: str(r.buying_method),
    frameworkId: s(r.framework_id),
    justification: s(r.justification),
    poDate: reqDate(r.po_date, "purchase_orders.po_date"),
    promisedDeliveryDate: reqDate(
      r.promised_delivery_date,
      "purchase_orders.promised_delivery_date",
    ),
    paymentTerms: str(r.payment_terms),
    complaintCount: int(r.complaint_count),
    status: str(r.status),
    period: str(r.period),
  }),
  po_lines: (r: Row) => ({
    id: str(r.po_line_id),
    poId: str(r.po_id),
    itemName: str(r.item_name),
    category: str(r.category),
    unit: str(r.unit),
    quantityOrdered: num(r.quantity_ordered),
    unitPriceUsd: num(r.unit_price_usd),
    needByDate: reqDate(r.need_by_date, "po_lines.need_by_date"),
  }),
  goods_receipts: (r: Row) => ({
    id: str(r.grn_id),
    poId: str(r.po_id),
    receiptDate: reqDate(r.receipt_date, "goods_receipts.receipt_date"),
    receivedBy: str(r.received_by),
    site: str(r.site),
    status: str(r.status),
  }),
  grn_lines: (r: Row) => ({
    id: str(r.grn_line_id),
    grnId: str(r.grn_id),
    poLineId: str(r.po_line_id),
    quantityReceived: num(r.quantity_received),
    quantityRejected: num(r.quantity_rejected),
    defectCount: int(r.defect_count),
  }),
  invoices: (r: Row) => ({
    id: str(r.invoice_id),
    poId: str(r.po_id),
    supplierId: str(r.supplier_id),
    supplierInvoiceNo: str(r.supplier_invoice_no),
    invoiceDate: reqDate(r.invoice_date, "invoices.invoice_date"),
    totalAmountUsd: num(r.total_amount_usd),
    status: str(r.status),
  }),
  invoice_lines: (r: Row) => ({
    id: str(r.invoice_line_id),
    invoiceId: str(r.invoice_id),
    poLineId: str(r.po_line_id),
    quantityBilled: num(r.quantity_billed),
    unitPriceUsd: num(r.unit_price_usd),
  }),
  payments: (r: Row) => ({
    id: str(r.payment_id),
    invoiceId: str(r.invoice_id),
    paymentDate: reqDate(r.payment_date, "payments.payment_date"),
    amountPaidUsd: num(r.amount_paid_usd),
    method: str(r.method),
  }),
} as const;

/**
 * Per-sheet bulk insert, in FK order (SHEET_NAMES order). Kept as an explicit record
 * rather than a generic loop so each call keeps its own Prisma delegate types.
 */
const SHEET_INSERTERS: Record<
  SheetName,
  (tx: DbClient, rows: Row[]) => Promise<number>
> = {
  suppliers: (tx, rows) =>
    insertChunked(rows, (c) => tx.supplier.createMany({ data: c.map(ROW_MAPPERS.suppliers) })),
  frameworks: (tx, rows) =>
    insertChunked(rows, (c) => tx.framework.createMany({ data: c.map(ROW_MAPPERS.frameworks) })),
  requisitions: (tx, rows) =>
    insertChunked(rows, (c) => tx.requisition.createMany({ data: c.map(ROW_MAPPERS.requisitions) })),
  sourcing_events: (tx, rows) =>
    insertChunked(rows, (c) =>
      tx.sourcingEvent.createMany({ data: c.map(ROW_MAPPERS.sourcing_events) }),
    ),
  responses: (tx, rows) =>
    insertChunked(rows, (c) => tx.response.createMany({ data: c.map(ROW_MAPPERS.responses) })),
  purchase_orders: (tx, rows) =>
    insertChunked(rows, (c) =>
      tx.purchaseOrder.createMany({ data: c.map(ROW_MAPPERS.purchase_orders) }),
    ),
  po_lines: (tx, rows) =>
    insertChunked(rows, (c) => tx.poLine.createMany({ data: c.map(ROW_MAPPERS.po_lines) })),
  goods_receipts: (tx, rows) =>
    insertChunked(rows, (c) =>
      tx.goodsReceipt.createMany({ data: c.map(ROW_MAPPERS.goods_receipts) }),
    ),
  grn_lines: (tx, rows) =>
    insertChunked(rows, (c) => tx.grnLine.createMany({ data: c.map(ROW_MAPPERS.grn_lines) })),
  invoices: (tx, rows) =>
    insertChunked(rows, (c) => tx.invoice.createMany({ data: c.map(ROW_MAPPERS.invoices) })),
  invoice_lines: (tx, rows) =>
    insertChunked(rows, (c) =>
      tx.invoiceLine.createMany({ data: c.map(ROW_MAPPERS.invoice_lines) }),
    ),
  payments: (tx, rows) =>
    insertChunked(rows, (c) => tx.payment.createMany({ data: c.map(ROW_MAPPERS.payments) })),
};

/** Insert one sheet's rows. Exported so the append paths reuse the same mappers. */
export function insertSheet(tx: DbClient, sheet: SheetName, rows: Row[]): Promise<number> {
  return SHEET_INSERTERS[sheet](tx, rows);
}

/**
 * Insert all 12 sheets in FK order. Assumes `clearDataset` already ran and that
 * `validateDataset` passed.
 */
export async function insertDataset(
  tx: DbClient,
  ds: Dataset,
  onProgress?: (sheet: SheetName, inserted: number) => void,
): Promise<Record<SheetName, number>> {
  const counts = {} as Record<SheetName, number>;
  for (const sheet of SHEET_NAMES) {
    const n = await insertSheet(tx, sheet, ds[sheet]);
    counts[sheet] = n;
    onProgress?.(sheet, n);
  }
  return counts;
}
