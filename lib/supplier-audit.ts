import type { Prisma } from "@/lib/generated/prisma/client";
import { SUPPLIER_EDITABLE_FIELDS, type SupplierPatchInput } from "@/lib/supplier-import";

/**
 * Supplier master-data audit trail.
 *
 * Pattern: append-only HISTORY LOG — the Supplier row is updated in place and every
 * changed field is recorded (who / when / before → after). This is deliberately a
 * different guarantee from posted transactional documents (PO / GRN / invoice /
 * payment), which are immutable and take linked correction entries instead. Master
 * data is a description of a counterparty, not a posted financial record: correcting
 * a misspelled supplier name should fix the name, not post an adjusting entry.
 */

/** A supplier's current state, as read before an edit. */
export type SupplierSnapshot = {
  supplierName: string;
  country: string;
  category: string;
  status: string;
  isMiningService: boolean;
  iujpNo: string | null;
  iujpValidUntil: Date | null;
};

/** One field-level change, ready to insert into SupplierChangeLog. */
export type FieldChange = {
  field: string;
  oldValue: string | null;
  newValue: string | null;
};

/** Render any supplier field as stable audit text. `null` means "was not set". */
function render(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  return String(value);
}

/**
 * Diff a patch against the current row. Returns the Prisma update payload plus one
 * FieldChange per ACTUALLY changed field — a field submitted with its existing value
 * produces no update and no log row, so a no-op save leaves no audit noise.
 */
export function diffSupplier(
  current: SupplierSnapshot,
  patch: SupplierPatchInput,
): { data: Prisma.SupplierUpdateInput; changes: FieldChange[] } {
  const data: Record<string, unknown> = {};
  const changes: FieldChange[] = [];

  for (const [bodyKey, column] of Object.entries(SUPPLIER_EDITABLE_FIELDS)) {
    if (!(bodyKey in patch)) continue;
    const raw = (patch as Record<string, unknown>)[bodyKey];
    if (raw === undefined) continue;

    // Dates arrive as YYYY-MM-DD strings; everything else is scalar.
    const next =
      column === "iujpValidUntil" && typeof raw === "string" && raw.length > 0
        ? new Date(`${raw}T00:00:00.000Z`)
        : raw;

    const before = render(current[column as keyof SupplierSnapshot]);
    const after = render(next);
    if (before === after) continue;

    data[column] = next;
    changes.push({ field: column, oldValue: before, newValue: after });
  }

  return { data: data as Prisma.SupplierUpdateInput, changes };
}

/** Build SupplierChangeLog rows for a set of field changes. */
export function changeLogRows(
  supplierId: string,
  changedBy: string,
  action: "create" | "update" | "deactivate" | "reactivate",
  changes: FieldChange[],
): Prisma.SupplierChangeLogCreateManyInput[] {
  if (changes.length === 0) {
    // `create` has no per-field diff — the whole row is new.
    return [{ supplierId, changedBy, action, field: null, oldValue: null, newValue: null }];
  }
  return changes.map((c) => ({
    supplierId,
    changedBy,
    action,
    field: c.field,
    oldValue: c.oldValue,
    newValue: c.newValue,
  }));
}
