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
});

export type SupplierRowData = z.infer<typeof SuppliersRow>;

/** A supplier row after id resolution (own-identity id guaranteed present). */
export type ResolvedSupplierRow = {
  supplier_id: string;
  supplier_name: string;
  country: string;
  category: string;
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

/** Map a resolved supplier row + period to a Prisma Supplier create object. */
export function toSupplierCreateData(row: ResolvedSupplierRow, periodId: string) {
  return {
    externalId: row.supplier_id,
    supplierName: row.supplier_name,
    country: row.country,
    category: row.category,
    periodId,
  };
}
