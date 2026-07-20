import type { Prisma } from "@/lib/generated/prisma/client";
import {
  REQUIRED_COLUMNS,
  ROW_MAPPERS,
  s,
  str,
  bool,
  date,
  type Row,
} from "@/lib/dataset-import";
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
