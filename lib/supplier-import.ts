import { z } from "zod";

/**
 * Shared "how a supplier row is validated + shaped" — the SINGLE source of truth
 * used by BOTH the bulk import (app/api/imports/upload) and the single-record
 * create (app/api/suppliers). The bulk path resolves ids from the in-file max;
 * the single-create resolves from the DB max — same `makeIdGen` scheme, same
 * format (S + 4-pad), same field mapping.
 */

// An id cell may be a string, a number (if a hand-authored sheet typed a bare
// number), or absent/blank — a blank id is auto-generated in sequence on import.
export const idCell = z.union([z.string(), z.number()]).optional();

export const SuppliersRow = z.object({
  supplier_id: idCell,
  supplier_name: z.string(),
  country: z.string(),
  category: z.string(),
  status: z.string().optional(),
  is_mining_service: z.union([z.boolean(), z.number(), z.string()]).optional(),
  iujp_no: z.string().optional(),
  iujp_valid_until: z.union([z.string(), z.date()]).optional(),
});

export type SupplierRowData = z.infer<typeof SuppliersRow>;

/**
 * The `Supplier.status` vocabulary. The seeded dataset only ever contains
 * "active" (55/55), so "inactive" is the deliberate complement — chosen to match
 * the lowercase single-word convention the other status columns already use
 * (Framework.status "active", PurchaseOrder.status "closed", GoodsReceipt.status
 * "complete" | "partial") rather than inventing a new one.
 *
 * ⚠️ Status is MASTER-DATA ONLY — the compute layer never filters on it, and
 * `load_roster_category_counts` counts inactive suppliers on purpose (an
 * inactive-but-qualified supplier is still an available alternative for the
 * supply-concentration signal). Deactivating therefore changes no analytics number.
 */
export const SUPPLIER_STATUSES = ["active", "inactive"] as const;
export type SupplierStatus = (typeof SUPPLIER_STATUSES)[number];

/** Fields an admin may set on create. The id is server-assigned, never in the body. */
export const SupplierWriteBody = z.object({
  supplier_name: z.string().trim().min(1, "Supplier name is required"),
  country: z.string().trim().min(1, "Country is required"),
  category: z.string().trim().min(1, "Category is required"),
  status: z.enum(SUPPLIER_STATUSES).default("active"),
  is_mining_service: z.boolean().default(false),
  iujp_no: z.string().trim().min(1).optional(),
  iujp_valid_until: z.string().trim().min(1).optional(),
});
export type SupplierWriteInput = z.infer<typeof SupplierWriteBody>;

/**
 * Body schema for a supplier EDIT (PATCH /api/suppliers/[id]). Every field is
 * optional — only what's present is changed, and each changed field is written to
 * SupplierChangeLog. The id is immutable (it is the natural key the whole
 * document graph FKs against).
 *
 * ⚠️ Declared field-by-field rather than as `SupplierWriteBody.partial()`: zod's
 * `.partial()` does NOT strip `.default()`, so the create schema's defaults would
 * be injected into every patch. A request changing only `country` would then also
 * silently reset `is_mining_service` to false and — far worse — force `status`
 * back to "active", reactivating a deactivated supplier. No defaults here.
 */
export const SupplierPatchBody = z.object({
  supplier_name: z.string().trim().min(1, "Supplier name is required").optional(),
  country: z.string().trim().min(1, "Country is required").optional(),
  category: z.string().trim().min(1, "Category is required").optional(),
  status: z.enum(SUPPLIER_STATUSES).optional(),
  is_mining_service: z.boolean().optional(),
  iujp_no: z.string().trim().nullable().optional(),
  iujp_valid_until: z.string().trim().nullable().optional(),
});
export type SupplierPatchInput = z.infer<typeof SupplierPatchBody>;

/** The editable master-data fields, mapped to their Prisma column names. */
export const SUPPLIER_EDITABLE_FIELDS = {
  supplier_name: "supplierName",
  country: "country",
  category: "category",
  status: "status",
  is_mining_service: "isMiningService",
  iujp_no: "iujpNo",
  iujp_valid_until: "iujpValidUntil",
} as const;

/** A supplier row after id resolution (own-identity id guaranteed present). */
export type ResolvedSupplierRow = {
  supplier_id: string;
  supplier_name: string;
  country: string;
  category: string;
  status?: string;
  is_mining_service?: boolean;
  iujp_no?: string | null;
  iujp_valid_until?: Date | null;
};

/** Format a supplier external id from a sequence number: 56 -> "S0056". */
export const SUPPLIER_ID_RE = /^S(\d+)$/;
export function formatSupplierId(seq: number): string {
  return `S${String(seq).padStart(4, "0")}`;
}

/** Normalize an id cell to a trimmed string, or undefined when blank/absent. */
export function idStr(value: string | number | undefined): string | undefined {
  if (value === undefined || value === null) return undefined;
  const s = String(value).trim();
  return s.length > 0 ? s : undefined;
}

/**
 * Build an id generator that continues the numeric sequence after the highest
 * matching id already present. e.g. prefix "S", pad 4, existing max S0007 ->
 * next() yields "S0008", "S0009", … Ids that don't match `re` are ignored when
 * seeding the sequence. Used by the bulk import (in-file ids) and the single
 * create (DB ids).
 */
export function makeIdGen(
  existing: (string | undefined)[],
  prefix: string,
  pad: number,
  re: RegExp,
) {
  let max = 0;
  for (const id of existing) {
    const m = id?.match(re);
    if (m) max = Math.max(max, parseInt(m[1], 10));
  }
  return () => `${prefix}${String(++max).padStart(pad, "0")}`;
}

/** The next supplier external id given the ids already in use. */
export function nextSupplierId(existing: (string | undefined)[]): string {
  return makeIdGen(existing, "S", 4, SUPPLIER_ID_RE)();
}

/**
 * Map a resolved supplier row to a Prisma Supplier create object.
 *
 * ⚠️ Normalized-model shape: the PK is the natural id (`id`, e.g. "S0056") — the
 * old `externalId` column is gone — and Supplier is a period-free master, so
 * there is no `periodId`. `status` + `isMiningService` are required columns with
 * no DB default, hence the fallbacks here.
 */
export function toSupplierCreateData(row: ResolvedSupplierRow) {
  return {
    id: row.supplier_id,
    supplierName: row.supplier_name,
    country: row.country,
    category: row.category,
    status: row.status ?? "active",
    isMiningService: row.is_mining_service ?? false,
    iujpNo: row.iujp_no ?? null,
    iujpValidUntil: row.iujp_valid_until ?? null,
  };
}
