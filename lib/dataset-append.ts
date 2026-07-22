import type { Prisma } from "@/lib/generated/prisma/client";
import {
  REQUIRED_COLUMNS,
  ROW_MAPPERS,
  findExistingIds,
  insertSheet,
  s,
  str,
  num,
  bool,
  date,
  type Row,
  type SheetName,
} from "@/lib/dataset-import";
import { BUYING_METHODS, SOURCED_METHODS, isSourcedMethod } from "@/lib/transaction-create";
import {
  diffSupplier,
  changeLogRows,
  type FieldChange,
  type SupplierSnapshot,
} from "@/lib/supplier-audit";
import { SUPPLIER_STATUSES, type SupplierStatus } from "@/lib/supplier-import";

/**
 * Partial APPEND uploads — additive counterparts to the full replace-all importer.
 *
 * The two differ in three ways, and the third is not a style choice:
 *  1. FK closure widens from "within the file" to "file ∪ database" — an appended
 *     row normally references rows that already exist.
 *  2. Primary keys must be unique within the file AND checked against the database.
 *  3. What a database collision MEANS depends on the table:
 *       • Supplier is MASTER data with no immutability trigger -> UPSERT.
 *       • The ten posted document tables carry BEFORE UPDATE triggers -> a collision
 *         is REJECTED. Upserting a posted document would be an in-place edit of a
 *         posted record, which is exactly what those triggers forbid.
 *  This module currently implements the supplier (upsert) half.
 */

const MAX_REPORTED_ERRORS = 25;

// --- suppliers -------------------------------------------------------------

/** One supplier row's resolved disposition against the current database. */
export type SupplierAppendPlan = {
  inserts: Row[];
  updates: { id: string; name: string; data: Prisma.SupplierUpdateInput; changes: FieldChange[] }[];
  unchanged: string[];
  errors: string[];
};

/** The existing supplier state the planner diffs against. */
export type ExistingSupplier = SupplierSnapshot & { id: string };

const SUPPLIER_SELECT = {
  id: true,
  supplierName: true,
  country: true,
  category: true,
  status: true,
  isMiningService: true,
  iujpNo: true,
  iujpValidUntil: true,
} as const;

export const SUPPLIER_APPEND_SELECT = SUPPLIER_SELECT;

/**
 * A sheet row rendered into the patch shape `diffSupplier` expects. Only called
 * after validation has confirmed `status` is one of SUPPLIER_STATUSES, which is what
 * narrows it here.
 */
function rowToPatch(r: Row) {
  const validUntil = date(r.iujp_valid_until);
  return {
    supplier_name: str(r.supplier_name),
    country: str(r.country),
    category: str(r.category),
    status: str(r.status) as SupplierStatus,
    is_mining_service: bool(r.is_mining_service),
    iujp_no: s(r.iujp_no),
    iujp_valid_until: validUntil ? validUntil.toISOString().slice(0, 10) : null,
  };
}

/**
 * Resolve a suppliers sheet against the current roster: what inserts, what updates
 * (with the per-field diff), what is already identical. Pure — no writes — so the
 * same call powers both the preview and the apply.
 *
 * Suppliers have no outgoing foreign keys, so the file ∪ DB closure check that the
 * transaction append needs is trivially satisfied here; the DB is consulted only to
 * decide insert-vs-upsert.
 */
export function planSupplierAppend(rows: Row[], existing: ExistingSupplier[]): SupplierAppendPlan {
  const errors: string[] = [];
  const push = (m: string) => {
    if (errors.length < MAX_REPORTED_ERRORS) errors.push(m);
  };

  if (rows.length === 0) {
    return { inserts: [], updates: [], unchanged: [], errors: ['Sheet "suppliers" is empty.'] };
  }

  // 1. Required columns.
  const present = new Set(Object.keys(rows[0]));
  for (const col of REQUIRED_COLUMNS.suppliers) {
    if (!present.has(col)) push(`Sheet "suppliers" is missing required column "${col}".`);
  }
  if (errors.length > 0) return { inserts: [], updates: [], unchanged: [], errors };

  // 2. Primary key present + unique WITHIN the file.
  const seen = new Set<string>();
  rows.forEach((row, i) => {
    const id = s(row.supplier_id);
    if (!id) {
      push(`Sheet "suppliers" row ${i + 2}: missing "supplier_id".`);
      return;
    }
    if (seen.has(id)) push(`Sheet "suppliers" row ${i + 2}: duplicate supplier_id "${id}".`);
    seen.add(id);
  });

  // 3. Field-level checks. Status is constrained to the known vocabulary — an append
  //    is hand-prepared, and a typo like "Active" would otherwise sail through and
  //    fragment the roster's state values.
  rows.forEach((row, i) => {
    const name = str(row.supplier_name);
    if (!name) push(`Sheet "suppliers" row ${i + 2}: "supplier_name" is required.`);
    if (!str(row.country)) push(`Sheet "suppliers" row ${i + 2}: "country" is required.`);
    if (!str(row.category)) push(`Sheet "suppliers" row ${i + 2}: "category" is required.`);
    const status = str(row.status);
    if (!(SUPPLIER_STATUSES as readonly string[]).includes(status)) {
      push(
        `Sheet "suppliers" row ${i + 2}: status "${status}" is not one of ${SUPPLIER_STATUSES.join(", ")}.`,
      );
    }
    if (row.iujp_valid_until != null && String(row.iujp_valid_until).trim() !== "" && !date(row.iujp_valid_until)) {
      push(`Sheet "suppliers" row ${i + 2}: "iujp_valid_until" is not a valid date.`);
    }
  });

  if (errors.length > 0) return { inserts: [], updates: [], unchanged: [], errors };

  // 4. Disposition against the database.
  const byId = new Map(existing.map((e) => [e.id, e]));
  const byName = new Map(existing.map((e) => [e.supplierName, e.id]));

  const inserts: Row[] = [];
  const updates: SupplierAppendPlan["updates"] = [];
  const unchanged: string[] = [];

  rows.forEach((row, i) => {
    const id = s(row.supplier_id)!;
    const current = byId.get(id);
    if (!current) {
      // A NEW supplier must not reuse another supplier's exact name — the manual
      // create path rejects that too, and a duplicate name is almost always a
      // mistyped id rather than a genuine second company.
      const clash = byName.get(str(row.supplier_name));
      if (clash && clash !== id) {
        push(
          `Sheet "suppliers" row ${i + 2}: a different supplier (${clash}) already uses the name "${str(row.supplier_name)}".`,
        );
        return;
      }
      inserts.push(row);
      return;
    }
    const { data, changes } = diffSupplier(current, rowToPatch(row));
    if (changes.length === 0) unchanged.push(id);
    else updates.push({ id, name: current.supplierName, data, changes });
  });

  return { inserts, updates, unchanged, errors };
}

/** Does this plan change anything? Drives whether a recompute is worth running. */
export function planTouchesData(plan: SupplierAppendPlan): boolean {
  return plan.inserts.length > 0 || plan.updates.length > 0;
}

/**
 * Apply a supplier append. MUST run inside a transaction.
 *
 * Inserts go through the shared ROW_MAPPERS so an appended supplier is shaped
 * exactly like an imported one. Every insert and every changed field is written to
 * SupplierChangeLog, matching the manual CRUD path — an upload is not a reason for
 * a change to go unrecorded.
 */
export async function applySupplierAppend(
  tx: Prisma.TransactionClient,
  plan: SupplierAppendPlan,
  userId: string,
): Promise<{ inserted: number; updated: number; unchanged: number; fieldsChanged: number }> {
  for (const row of plan.inserts) {
    const data = ROW_MAPPERS.suppliers(row);
    await tx.supplier.create({ data });
    await tx.supplierChangeLog.createMany({
      data: changeLogRows(data.id, userId, "create", []),
    });
  }

  let fieldsChanged = 0;
  for (const u of plan.updates) {
    await tx.supplier.update({ where: { id: u.id }, data: u.data });
    await tx.supplierChangeLog.createMany({
      data: changeLogRows(u.id, userId, "update", u.changes),
    });
    fieldsChanged += u.changes.length;
  }

  return {
    inserted: plan.inserts.length,
    updated: plan.updates.length,
    unchanged: plan.unchanged.length,
    fieldsChanged,
  };
}


// --- transactions ----------------------------------------------------------

/** Sheets a transactions append must carry, in FK (insert) order. */
export const TXN_REQUIRED_SHEETS = [
  "requisitions",
  "purchase_orders",
  "po_lines",
  "goods_receipts",
  "grn_lines",
  "invoices",
  "invoice_lines",
  "payments",
] as const;

/** Required only if some PO is an rfq. */
export const TXN_CONDITIONAL_SHEETS = ["sourcing_events", "responses"] as const;

/** Insert order for the append (SHEET_NAMES order, minus the master-data sheets). */
const TXN_INSERT_ORDER: SheetName[] = [
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
];

export type TxnSheets = Partial<Record<SheetName, Row[]>>;

export type TxnAppendPlan = {
  sheets: TxnSheets;
  poCount: number;
  lineCount: number;
  totalValueUsd: number;
  periods: string[];
  errors: string[];
};

const PK_OF: Partial<Record<SheetName, string>> = {
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

const ymd = (v: unknown): string | null => {
  const d = date(v);
  return d ? d.toISOString().slice(0, 10) : null;
};

/**
 * Validate + plan a multi-sheet transactions append against the live database.
 *
 * ⚠️ The rule that makes this safe: every CHAIN reference must resolve INSIDE the
 * file, while master-data references (supplier, framework) must resolve in the
 * DATABASE. A child document pointing at a parent that exists only in the database
 * is an edit of a posted chain, not an append, and is rejected — the immutability
 * triggers would refuse it anyway, but a clear error beats a constraint violation.
 *
 * Complete chains only, matching the transaction-create feature: an invoice-less PO
 * would be COALESCEd to threeWayMatchPass = TRUE by the EnrichedPurchase view while
 * contributing to no other rate denominator, silently inflating processScore.
 */
export async function planTransactionAppend(
  db: Prisma.TransactionClient,
  sheets: TxnSheets,
): Promise<TxnAppendPlan> {
  const errors: string[] = [];
  const push = (m: string) => {
    if (errors.length < MAX_REPORTED_ERRORS) errors.push(m);
  };
  const empty: TxnAppendPlan = {
    sheets,
    poCount: 0,
    lineCount: 0,
    totalValueUsd: 0,
    periods: [],
    errors,
  };

  const rowsOf = (n: SheetName): Row[] => sheets[n] ?? [];

  // 1. Sheet presence + required columns.
  for (const name of TXN_REQUIRED_SHEETS) {
    const rows = rowsOf(name);
    if (rows.length === 0) {
      push(`Sheet "${name}" is missing or empty — a transactions file needs all ${TXN_REQUIRED_SHEETS.length} document sheets.`);
      continue;
    }
    const present = new Set(Object.keys(rows[0]));
    for (const col of REQUIRED_COLUMNS[name]) {
      if (!present.has(col)) push(`Sheet "${name}" is missing required column "${col}".`);
    }
  }
  const usesSourcing = rowsOf("purchase_orders").some((r) => isSourcedMethod(str(r.buying_method)));
  if (usesSourcing) {
    for (const name of TXN_CONDITIONAL_SHEETS) {
      const rows = rowsOf(name);
      if (rows.length === 0) {
        push(
          `Sheet "${name}" is required because at least one purchase order uses a competitively sourced buying_method (${SOURCED_METHODS.join(" or ")}).`,
        );
        continue;
      }
      const present = new Set(Object.keys(rows[0]));
      for (const col of REQUIRED_COLUMNS[name]) {
        if (!present.has(col)) push(`Sheet "${name}" is missing required column "${col}".`);
      }
    }
  }
  if (errors.length > 0) return empty;

  // 2. Primary keys: present, unique in file, and ABSENT from the database. A
  //    collision on a posted document is rejected, never upserted.
  const fileIds: Partial<Record<SheetName, Set<string>>> = {};
  for (const [name, pk] of Object.entries(PK_OF) as [SheetName, string][]) {
    const rows = rowsOf(name);
    const seen = new Set<string>();
    rows.forEach((row, i) => {
      const id = s(row[pk]);
      if (!id) {
        push(`Sheet "${name}" row ${i + 2}: missing "${pk}".`);
        return;
      }
      if (seen.has(id)) push(`Sheet "${name}" row ${i + 2}: duplicate ${pk} "${id}".`);
      seen.add(id);
    });
    fileIds[name] = seen;
  }
  if (errors.length > 0) return empty;

  for (const [name, pk] of Object.entries(PK_OF) as [SheetName, string][]) {
    const ids = [...fileIds[name]!];
    const clash = await findExistingIds(db, name, ids);
    for (const id of ids) {
      if (clash.has(id)) {
        push(
          `Sheet "${name}": ${pk} "${id}" already exists. Posted records are immutable — a correction must be posted instead of re-uploading.`,
        );
      }
    }
  }
  if (errors.length > 0) return empty;

  // 3. Master-data references must resolve in the DATABASE (suppliers are uploaded
  //    separately, by design).
  const supplierRefs = new Set<string>();
  for (const r of rowsOf("purchase_orders")) { const v = s(r.supplier_id); if (v) supplierRefs.add(v); }
  for (const r of rowsOf("invoices")) { const v = s(r.supplier_id); if (v) supplierRefs.add(v); }
  for (const r of rowsOf("responses")) { const v = s(r.supplier_id); if (v) supplierRefs.add(v); }
  for (const r of rowsOf("sourcing_events")) { const v = s(r.awarded_supplier_id); if (v) supplierRefs.add(v); }
  const knownSuppliers = await findExistingIds(db, "suppliers", [...supplierRefs]);
  for (const ref of supplierRefs) {
    if (!knownSuppliers.has(ref)) {
      push(`supplier_id "${ref}" does not exist. Upload the supplier first — a transactions file cannot create suppliers.`);
    }
  }

  // Raising an order against a RETIRED supplier is blocked here exactly as the
  // record-purchase dropdown (active-only) and POST /api/purchases both block it —
  // otherwise a transactions file is a way around the same rule. Scoped to the PO
  // supplier: that is the party an order is actually raised against (the invoice and
  // the award resolve to the same supplier in a valid chain, and a losing bidder in
  // `responses` is not "ordering"). Only suppliers that exist are checked — a missing
  // one already errored above. Deduped per supplier, so one message names each.
  const poSupplierIds = new Set<string>();
  for (const r of rowsOf("purchase_orders")) {
    const v = s(r.supplier_id);
    if (v && knownSuppliers.has(v)) poSupplierIds.add(v);
  }
  if (poSupplierIds.size > 0) {
    const supStatuses = await db.supplier.findMany({
      where: { id: { in: [...poSupplierIds] } },
      select: { supplierName: true, status: true },
    });
    for (const sup of supStatuses) {
      if (sup.status !== "active") {
        push(`${sup.supplierName} is inactive — reactivate it before ordering.`);
      }
    }
  }

  const frameworkRefs = new Set<string>();
  for (const r of rowsOf("purchase_orders")) { const v = s(r.framework_id); if (v) frameworkRefs.add(v); }
  const knownFrameworks = await findExistingIds(db, "frameworks", [...frameworkRefs]);
  for (const ref of frameworkRefs) {
    if (!knownFrameworks.has(ref)) push(`framework_id "${ref}" does not exist in the database.`);
  }

  // 4. Chain references must resolve INSIDE the file. If the parent exists only in
  //    the database, the upload is trying to extend a posted chain — call that out
  //    specifically rather than reporting a generic dangling reference.
  const chainEdges: { from: SheetName; column: string; to: SheetName; optional?: boolean }[] = [
    { from: "purchase_orders", column: "pr_id", to: "requisitions" },
    { from: "purchase_orders", column: "sourcing_event_id", to: "sourcing_events", optional: true },
    { from: "sourcing_events", column: "pr_id", to: "requisitions" },
    { from: "responses", column: "sourcing_event_id", to: "sourcing_events" },
    { from: "po_lines", column: "po_id", to: "purchase_orders" },
    { from: "goods_receipts", column: "po_id", to: "purchase_orders" },
    { from: "grn_lines", column: "grn_id", to: "goods_receipts" },
    { from: "grn_lines", column: "po_line_id", to: "po_lines" },
    { from: "invoices", column: "po_id", to: "purchase_orders" },
    { from: "invoice_lines", column: "invoice_id", to: "invoices" },
    { from: "invoice_lines", column: "po_line_id", to: "po_lines" },
    { from: "payments", column: "invoice_id", to: "invoices" },
  ];
  for (const edge of chainEdges) {
    const target = fileIds[edge.to]!;
    const rows = rowsOf(edge.from);
    const missing = new Set<string>();
    rows.forEach((row, i) => {
      const ref = s(row[edge.column]);
      if (ref === null) {
        if (!edge.optional) push(`Sheet "${edge.from}" row ${i + 2}: "${edge.column}" is required.`);
        return;
      }
      if (!target.has(ref)) missing.add(ref);
    });
    if (missing.size > 0) {
      const existing = await findExistingIds(db, edge.to, [...missing]);
      for (const ref of missing) {
        if (existing.has(ref)) {
          push(
            `Sheet "${edge.from}": ${edge.column} "${ref}" refers to a record that already exists in the database. Appending to a posted ${edge.to.slice(0, -1)} is an edit, not an append — post a correction instead.`,
          );
        } else {
          push(`Sheet "${edge.from}": ${edge.column} "${ref}" not found in "${edge.to}".`);
        }
      }
    }
  }
  if (errors.length > 0) return empty;

  // 5. Complete chain per PO — the transaction-create rule, expressed over sheets.
  const linesByPo = new Map<string, Row[]>();
  for (const r of rowsOf("po_lines")) {
    const po = str(r.po_id);
    (linesByPo.get(po) ?? linesByPo.set(po, []).get(po)!).push(r);
  }
  const grnsByPo = new Map<string, Row[]>();
  for (const r of rowsOf("goods_receipts")) {
    const po = str(r.po_id);
    (grnsByPo.get(po) ?? grnsByPo.set(po, []).get(po)!).push(r);
  }
  const invoicesByPo = new Map<string, Row[]>();
  for (const r of rowsOf("invoices")) {
    const po = str(r.po_id);
    (invoicesByPo.get(po) ?? invoicesByPo.set(po, []).get(po)!).push(r);
  }
  const grnLinesByPoLine = new Map<string, number>();
  for (const r of rowsOf("grn_lines")) {
    const k = str(r.po_line_id);
    grnLinesByPoLine.set(k, (grnLinesByPoLine.get(k) ?? 0) + 1);
  }
  const invLinesByPoLine = new Map<string, number>();
  for (const r of rowsOf("invoice_lines")) {
    const k = str(r.po_line_id);
    invLinesByPoLine.set(k, (invLinesByPoLine.get(k) ?? 0) + 1);
  }
  const paymentsByInvoice = new Map<string, number>();
  for (const r of rowsOf("payments")) {
    const k = str(r.invoice_id);
    paymentsByInvoice.set(k, (paymentsByInvoice.get(k) ?? 0) + 1);
  }
  const reqByPr = new Map(rowsOf("requisitions").map((r) => [str(r.pr_id), r]));
  const sourcingById = new Map(rowsOf("sourcing_events").map((r) => [str(r.sourcing_event_id), r]));
  const responseIds = fileIds.responses ?? new Set<string>();

  let totalValueUsd = 0;
  let lineCount = 0;
  const periods = new Set<string>();

  for (const po of rowsOf("purchase_orders")) {
    const id = str(po.po_id);
    const lines = linesByPo.get(id) ?? [];
    const grns = grnsByPo.get(id) ?? [];
    const invs = invoicesByPo.get(id) ?? [];

    if (lines.length === 0) push(`PO "${id}": has no po_lines.`);
    if (grns.length === 0) push(`PO "${id}": has no goods receipt — a complete chain is required (an unreceived PO cannot be appended).`);
    if (invs.length === 0) {
      push(`PO "${id}": has no invoice. An invoice-less purchase order would be scored as a three-way-match PASS — complete chains only.`);
    } else if (invs.length > 1) {
      push(`PO "${id}": has ${invs.length} invoices; exactly one is expected.`);
    }

    for (const l of lines) {
      const lid = str(l.po_line_id);
      lineCount += 1;
      totalValueUsd += num(l.quantity_ordered) * num(l.unit_price_usd);
      if ((grnLinesByPoLine.get(lid) ?? 0) < 1) push(`PO line "${lid}": has no grn_line (nothing was received against it).`);
      const nInv = invLinesByPoLine.get(lid) ?? 0;
      if (nInv !== 1) push(`PO line "${lid}": has ${nInv} invoice_lines; exactly one is expected.`);
    }
    for (const inv of invs) {
      const n = paymentsByInvoice.get(str(inv.invoice_id)) ?? 0;
      if (n !== 1) push(`Invoice "${str(inv.invoice_id)}": has ${n} payments; exactly one is expected.`);
    }

    // 6. Buying-method conditionals — mirroring the seeded data exactly.
    const method = str(po.buying_method);
    const sourcing = s(po.sourcing_event_id);
    const framework = s(po.framework_id);
    const justification = s(po.justification);
    if (!BUYING_METHODS.includes(method as (typeof BUYING_METHODS)[number])) {
      push(`PO "${id}": buying_method "${method}" is not one of ${BUYING_METHODS.join(", ")}.`);
    }
    // Both sourced methods (rfq, tender) are competitive and carry their own
    // sourcing event, responses and award; the non-competitive methods carry none.
    if (isSourcedMethod(method)) {
      if (!sourcing) push(`PO "${id}": buying_method "${method}" requires a sourcing_event_id.`);
      else {
        const ev = sourcingById.get(sourcing);
        const awarded = ev ? s(ev.awarded_response_id) : null;
        if (!awarded) push(`PO "${id}": sourcing event "${sourcing}" has no awarded_response_id.`);
        else if (!responseIds.has(awarded)) {
          push(`PO "${id}": awarded_response_id "${awarded}" is not present in the responses sheet.`);
        }
      }
    } else if (sourcing) {
      push(
        `PO "${id}": only a competitively sourced order (${SOURCED_METHODS.join(", ")}) may reference a sourcing event.`,
      );
    }
    if (method === "call_off" && !framework) push(`PO "${id}": buying_method "call_off" requires a framework_id.`);
    if (method !== "call_off" && framework) push(`PO "${id}": only buying_method "call_off" may reference a framework.`);
    if (method === "direct" && !justification) push(`PO "${id}": buying_method "direct" requires a justification.`);

    // 7. Dates must run forward across the chain; the view derives every *Days
    //    column as a plain date difference.
    const req = reqByPr.get(str(po.pr_id));
    const prD = req ? ymd(req.pr_date) : null;
    const poD = ymd(po.po_date);
    const recD = grns.map((g) => ymd(g.receipt_date)).filter(Boolean).sort().pop() ?? null;
    const invD = invs.length ? ymd(invs[0].invoice_date) : null;
    const payRow = invs.length
      ? rowsOf("payments").find((p) => str(p.invoice_id) === str(invs[0].invoice_id))
      : undefined;
    const payD = payRow ? ymd(payRow.payment_date) : null;

    if (!poD) push(`PO "${id}": po_date is missing or invalid.`);
    if (prD && poD && prD > poD) push(`PO "${id}": po_date ${poD} precedes requisition date ${prD}.`);
    if (poD && recD && poD > recD) push(`PO "${id}": receipt date ${recD} precedes po_date ${poD}.`);
    if (recD && invD && recD > invD) push(`PO "${id}": invoice date ${invD} precedes receipt date ${recD}.`);
    if (invD && payD && invD > payD) push(`PO "${id}": payment date ${payD} precedes invoice date ${invD}.`);

    // 8. period must be the ORDER YEAR — the compute layer filters on poDate and
    //    buckets by this column, so a mismatch would hide the PO from its period.
    const period = str(po.period);
    const orderYear = poD ? poD.slice(0, 4) : "";
    if (period && orderYear && period !== orderYear) {
      push(`PO "${id}": period "${period}" does not match the order year of po_date (${orderYear}).`);
    }
    if (orderYear) periods.add(orderYear);
  }

  return {
    sheets,
    poCount: rowsOf("purchase_orders").length,
    lineCount,
    totalValueUsd: Math.round(totalValueUsd * 100) / 100,
    periods: [...periods].sort(),
    errors,
  };
}

/**
 * Apply a transactions append: INSERT-only, in FK order, reusing the shared
 * ROW_MAPPERS. MUST run inside a transaction. Assumes planTransactionAppend passed.
 */
export async function applyTransactionAppend(
  tx: Prisma.TransactionClient,
  plan: TxnAppendPlan,
): Promise<Record<string, number>> {
  // Every order year in the file needs a reporting period, or the compute layer
  // would silently skip the appended POs.
  for (const name of plan.periods) {
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

  const counts: Record<string, number> = {};
  for (const sheet of TXN_INSERT_ORDER) {
    const rows = plan.sheets[sheet] ?? [];
    if (rows.length === 0) continue;
    counts[sheet] = await insertSheet(tx, sheet, rows);
  }
  return counts;
}
