/**
 * Read-only data browser — per-table display config.
 *
 * ONE generic table component renders all of these; a table is a config, never a
 * bespoke component. Every table does the same three things: show rows, filter by
 * supplier and period, paginate.
 *
 * ⚠️ Client-safe by design: NO imports from `lib/dataset-import.ts`, which pulls in
 * `xlsx`. The column keys below must still match `REQUIRED_COLUMNS` there — the API
 * route asserts exactly that on every request (see `assertNoColumnDrift`), so a
 * schema change that this file misses fails loudly instead of silently showing a
 * stale set of columns.
 */

export type ColumnType = "id" | "text" | "number" | "money" | "date" | "bool";

export type ColumnConfig = {
  /** Sheet-schema column name, snake_case — also the key in `BrowserRow.cells`. */
  key: string;
  /** Header override. Used where the column name alone would mislead. */
  label?: string;
  type: ColumnType;
};

export type TableConfig = {
  /** Sheet name, matching `SHEET_NAMES` in lib/dataset-import.ts. */
  table: string;
  /** Human label for the picker. */
  label: string;
  columns: ColumnConfig[];
  /**
   * Whether each filter applies. Not every table carries these dimensions:
   * `suppliers` has no period at all, `frameworks` has its own validity window
   * rather than a reporting period. A false here means the control is not rendered.
   */
  supplierFilter: boolean;
  periodFilter: boolean;
};

/**
 * Every row the API returns, whatever the table. The three underscore fields are
 * the resolved filter keys — direct columns on some tables, joined through the
 * purchase order on others — so the component filters uniformly and never needs to
 * know how they were derived.
 */
export type BrowserRow = {
  id: string;
  cells: Record<string, string | number | boolean | null>;
  _supplierId: string | null;
  _supplierName: string | null;
  _period: string | null;
};

export type BrowserResponse = { rows: BrowserRow[] };

/**
 * The registry. The picker is driven by this, so a table appears only once it is
 * genuinely implemented — there is no state where picking an entry errors.
 */
export const TABLE_CONFIGS: TableConfig[] = [
  {
    table: "suppliers",
    label: "Suppliers",
    // Master data: period-free by design, so no period filter. The supplier filter
    // degenerates to selecting one row, which is harmless and consistent.
    supplierFilter: true,
    periodFilter: false,
    columns: [
      { key: "supplier_id", type: "id" },
      { key: "supplier_name", type: "text" },
      { key: "country", type: "text" },
      { key: "category", type: "text" },
      { key: "status", type: "text" },
      { key: "is_mining_service", type: "bool" },
      // Persisted but not in REQUIRED_COLUMNS — appended explicitly.
      { key: "iujp_no", type: "text" },
      { key: "iujp_valid_until", type: "date" },
    ],
  },
  {
    table: "purchase_orders",
    label: "Purchase orders",
    // The anchor table: both dimensions are direct columns here, and every other
    // table's period is resolved by joining back to this one.
    supplierFilter: true,
    periodFilter: true,
    columns: [
      { key: "po_id", type: "id" },
      { key: "pr_id", type: "id" },
      // Conditional per buying method, so absent from REQUIRED_COLUMNS.
      { key: "sourcing_event_id", type: "id" },
      { key: "supplier_id", type: "id" },
      { key: "buying_method", type: "text" },
      { key: "framework_id", type: "id" },
      { key: "justification", type: "text" },
      { key: "po_date", type: "date" },
      { key: "promised_delivery_date", type: "date" },
      { key: "payment_terms", type: "text" },
      { key: "complaint_count", type: "number" },
      { key: "status", type: "text" },
      { key: "period", type: "text" },
    ],
  },
  {
    table: "payments",
    label: "Payments",
    // Deepest join: payment -> invoice -> supplier, and -> invoice -> PO for period.
    supplierFilter: true,
    periodFilter: true,
    columns: [
      { key: "payment_id", type: "id" },
      { key: "invoice_id", type: "id" },
      { key: "payment_date", type: "date" },
      { key: "amount_paid_usd", type: "money" },
      { key: "method", type: "text" },
    ],
  },
];

export const CONFIG_BY_TABLE = new Map(TABLE_CONFIGS.map((c) => [c.table, c]));
