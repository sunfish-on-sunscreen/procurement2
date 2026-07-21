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
 * The registry, in document-chain order — the same order as `SHEET_NAMES` and the
 * importer's insert order, so the picker reads the way the data flows: supplier ->
 * framework -> requisition -> sourcing -> order -> receipt -> invoice -> payment.
 *
 * The picker is driven by this list, so a table appears only once it is genuinely
 * implemented — there is no state where picking an entry errors.
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
    table: "frameworks",
    label: "Frameworks",
    // ⚠️ No period: a framework carries its OWN validity window (start_date /
    // end_date) spanning years, which is not a reporting period. Deriving one from
    // the call-offs that reference it would invent a fact the row does not state.
    supplierFilter: true,
    periodFilter: false,
    columns: [
      { key: "framework_id", type: "id" },
      { key: "supplier_id", type: "id" },
      { key: "title", type: "text" },
      { key: "category", type: "text" },
      { key: "start_date", type: "date" },
      { key: "end_date", type: "date" },
      { key: "status", type: "text" },
    ],
  },
  {
    table: "requisitions",
    label: "Requisitions",
    // Carries neither dimension, but is 1:1 with its purchase order (verified: 647
    // requisitions, 647 distinct prId on POs, none orphaned, none with two), so both
    // resolve unambiguously through it.
    supplierFilter: true,
    periodFilter: true,
    columns: [
      { key: "pr_id", type: "id" },
      { key: "pr_date", type: "date" },
      { key: "requester", type: "text" },
      { key: "department", type: "text" },
      { key: "category", type: "text" },
      { key: "need_by_date", type: "date" },
      { key: "estimated_value_usd", type: "money" },
      { key: "status", type: "text" },
    ],
  },
  {
    table: "sourcing_events",
    label: "Sourcing events",
    // Also 1:1 with its PO (226 events, 226 POs carrying one, none with two). Both
    // dimensions resolve through the PO rather than through `awarded_supplier_id`,
    // so every table uses the same anchor — the two never disagree in the data.
    supplierFilter: true,
    periodFilter: true,
    columns: [
      { key: "sourcing_event_id", type: "id" },
      { key: "pr_id", type: "id" },
      { key: "issue_date", type: "date" },
      { key: "close_date", type: "date" },
      { key: "num_suppliers_invited", type: "number" },
      // Nullable in the schema, so absent from REQUIRED_COLUMNS — appended here.
      { key: "awarded_supplier_id", type: "id" },
      { key: "awarded_response_id", type: "id" },
    ],
  },
  {
    table: "responses",
    label: "Responses",
    // ⚠️ The supplier here is the BIDDER, not the awarded supplier — 677 responses
    // across 29 suppliers, losing bids included. Filtering by supplier answers "what
    // did this supplier bid on", which is the useful reading, so the column is
    // labelled to stop it being mistaken for the winner.
    supplierFilter: true,
    periodFilter: true,
    columns: [
      { key: "response_id", type: "id" },
      { key: "sourcing_event_id", type: "id" },
      { key: "supplier_id", label: "supplier_id (bidder)", type: "id" },
      { key: "quoted_unit_price_usd", type: "money" },
      { key: "quoted_lead_time_days", type: "number" },
      { key: "submitted_date", type: "date" },
      { key: "is_awarded", type: "bool" },
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
    table: "po_lines",
    label: "PO lines",
    supplierFilter: true,
    periodFilter: true,
    columns: [
      { key: "po_line_id", type: "id" },
      { key: "po_id", type: "id" },
      { key: "item_name", type: "text" },
      { key: "category", type: "text" },
      { key: "unit", type: "text" },
      { key: "quantity_ordered", type: "number" },
      { key: "unit_price_usd", type: "money" },
      { key: "need_by_date", type: "date" },
      // ⚠️ Not a sheet column: a correction is a real signed row in this table,
      // linked to the line it adjusts. Without this the browser would show it as an
      // inexplicable negative-quantity duplicate of the original.
      { key: "corrects_line_id", type: "id" },
    ],
  },
  {
    table: "goods_receipts",
    label: "Goods receipts",
    supplierFilter: true,
    periodFilter: true,
    columns: [
      { key: "grn_id", type: "id" },
      { key: "po_id", type: "id" },
      { key: "receipt_date", type: "date" },
      { key: "received_by", type: "text" },
      { key: "site", type: "text" },
      { key: "status", type: "text" },
    ],
  },
  {
    table: "grn_lines",
    label: "GRN lines",
    // Two hops to the anchor: grn_line -> goods_receipt -> purchase_order.
    supplierFilter: true,
    periodFilter: true,
    columns: [
      { key: "grn_line_id", type: "id" },
      { key: "grn_id", type: "id" },
      { key: "po_line_id", type: "id" },
      { key: "quantity_received", type: "number" },
      { key: "quantity_rejected", type: "number" },
      { key: "defect_count", type: "number" },
      { key: "corrects_line_id", type: "id" },
    ],
  },
  {
    table: "invoices",
    label: "Invoices",
    // Supplier is a direct column and never disagrees with its PO's supplier
    // (verified: zero mismatches); period comes from the PO.
    supplierFilter: true,
    periodFilter: true,
    columns: [
      { key: "invoice_id", type: "id" },
      { key: "po_id", type: "id" },
      { key: "supplier_id", type: "id" },
      { key: "supplier_invoice_no", type: "text" },
      { key: "invoice_date", type: "date" },
      { key: "total_amount_usd", type: "money" },
      { key: "status", type: "text" },
    ],
  },
  {
    table: "invoice_lines",
    label: "Invoice lines",
    supplierFilter: true,
    periodFilter: true,
    columns: [
      { key: "invoice_line_id", type: "id" },
      { key: "invoice_id", type: "id" },
      { key: "po_line_id", type: "id" },
      { key: "quantity_billed", type: "number" },
      { key: "unit_price_usd", type: "money" },
      { key: "corrects_line_id", type: "id" },
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
