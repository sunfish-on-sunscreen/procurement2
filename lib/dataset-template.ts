import * as xlsx from "xlsx";
import { SHEET_NAMES, REQUIRED_COLUMNS, type SheetName, type Row } from "@/lib/dataset-import";

/**
 * The downloadable import template.
 *
 * Headers are generated from `REQUIRED_COLUMNS`, the same constant the validator
 * checks against, so the template can never drift from what the importer accepts —
 * a checked-in workbook would go stale the moment a column changed.
 *
 * The example rows form ONE valid, complete document chain (PR → PO + 2 lines → GRN
 * + 2 lines → invoice + 2 lines → payment), so the file demonstrates the
 * chain-completeness rule rather than just the column names. Ids use a 2027 sequence
 * and a fresh supplier id so nothing collides with the seeded data.
 */

// The example chain references the template's OWN supplier row, so the workbook is
// referentially self-contained: it validates as a full 12-sheet replace file, and as
// an append example it matches the documented order (upload suppliers first).
const EX_SUPPLIER = "S9001";
const EX_PO = "PO-2027-00001";
const EX_PR = "PR-2027-00001";
const EX_GRN = "GRN-2027-00001";
const EX_INV = "AP-2027-00001";
const L1 = `${EX_PO}-010`;
const L2 = `${EX_PO}-020`;

const EXAMPLE_ROWS: Record<SheetName, Row[]> = {
  suppliers: [
    {
      supplier_id: "S9001",
      supplier_name: "PT Contoh Pemasok",
      country: "ID",
      category: "Tires",
      status: "active",
      is_mining_service: false,
      iujp_no: "",
      iujp_valid_until: "",
    },
  ],
  frameworks: [
    {
      framework_id: "FA-TIRE-2027-01",
      supplier_id: EX_SUPPLIER,
      title: "Tyre supply agreement 2027",
      category: "Tires",
      start_date: "2027-01-01",
      end_date: "2027-12-31",
      status: "active",
    },
  ],
  requisitions: [
    {
      pr_id: EX_PR,
      pr_date: "2027-02-01",
      requester: "Budi Santoso",
      department: "Plant Maintenance",
      category: "Tires",
      need_by_date: "2027-03-15",
      estimated_value_usd: 250000,
      status: "approved",
    },
  ],
  sourcing_events: [
    {
      sourcing_event_id: "RFQ-2027-0001",
      pr_id: EX_PR,
      issue_date: "2027-02-01",
      close_date: "2027-02-10",
      num_suppliers_invited: 3,
      awarded_supplier_id: EX_SUPPLIER,
      awarded_response_id: "RFQ-2027-0001-Q01",
    },
  ],
  responses: [
    {
      response_id: "RFQ-2027-0001-Q01",
      sourcing_event_id: "RFQ-2027-0001",
      supplier_id: EX_SUPPLIER,
      quoted_unit_price_usd: 1500,
      quoted_lead_time_days: 30,
      submitted_date: "2027-02-08",
      is_awarded: true,
    },
  ],
  purchase_orders: [
    {
      po_id: EX_PO,
      pr_id: EX_PR,
      sourcing_event_id: "RFQ-2027-0001",
      supplier_id: EX_SUPPLIER,
      buying_method: "rfq",
      framework_id: "",
      justification: "",
      po_date: "2027-02-12",
      promised_delivery_date: "2027-03-15",
      payment_terms: "Net 30",
      complaint_count: 0,
      status: "closed",
      period: "2027",
    },
  ],
  po_lines: [
    {
      po_line_id: L1,
      po_id: EX_PO,
      item_name: "OTR tyre 27.00R49",
      category: "Tires",
      unit: "pcs",
      quantity_ordered: 100,
      unit_price_usd: 1500,
      need_by_date: "2027-03-15",
    },
    {
      po_line_id: L2,
      po_id: EX_PO,
      item_name: "Tyre protection chain",
      category: "Tires",
      unit: "pcs",
      quantity_ordered: 50,
      unit_price_usd: 2000,
      need_by_date: "2027-03-15",
    },
  ],
  goods_receipts: [
    {
      grn_id: EX_GRN,
      po_id: EX_PO,
      receipt_date: "2027-03-12",
      received_by: "Warehouse Team A",
      site: "Tutupan",
      status: "complete",
    },
  ],
  grn_lines: [
    {
      grn_line_id: `${EX_GRN}-010`,
      grn_id: EX_GRN,
      po_line_id: L1,
      quantity_received: 100,
      quantity_rejected: 0,
      defect_count: 0,
    },
    {
      grn_line_id: `${EX_GRN}-020`,
      grn_id: EX_GRN,
      po_line_id: L2,
      quantity_received: 50,
      quantity_rejected: 0,
      defect_count: 0,
    },
  ],
  invoices: [
    {
      invoice_id: EX_INV,
      po_id: EX_PO,
      supplier_id: EX_SUPPLIER,
      supplier_invoice_no: "INV-EXAMPLE-001",
      invoice_date: "2027-03-16",
      total_amount_usd: 250000,
      status: "paid",
    },
  ],
  invoice_lines: [
    {
      invoice_line_id: "INV-2027-00001-010",
      invoice_id: EX_INV,
      po_line_id: L1,
      quantity_billed: 100,
      unit_price_usd: 1500,
    },
    {
      invoice_line_id: "INV-2027-00001-020",
      invoice_id: EX_INV,
      po_line_id: L2,
      quantity_billed: 50,
      unit_price_usd: 2000,
    },
  ],
  payments: [
    {
      payment_id: "PAY-2027-00001",
      invoice_id: EX_INV,
      payment_date: "2027-04-15",
      amount_paid_usd: 250000,
      method: "Bank Transfer",
    },
  ],
};

/** A README sheet so the file explains its own rules without external docs. */
const README_ROWS: string[][] = [
  ["Procurement dataset — import template"],
  [],
  ["This workbook shows the structure every import expects. The example rows form ONE"],
  ["complete document chain: requisition → purchase order + lines → goods receipt +"],
  ["lines → invoice + lines → payment. Replace them with your own data."],
  [],
  ["Three ways to use it:"],
  ["  1. Full replace  — all 12 sheets. REPLACES the entire dataset."],
  ["  2. Suppliers append — the 'suppliers' sheet only. Upserts by supplier_id."],
  ["  3. Transactions append — the 8 document sheets (requisitions, purchase_orders,"],
  ["     po_lines, goods_receipts, grn_lines, invoices, invoice_lines, payments), plus"],
  ["     sourcing_events + responses if any PO uses a competitive buying_method (rfq or"],
  ["     tender). Suppliers must"],
  ["     already exist — upload them first."],
  [],
  ["Rules:"],
  ["  • Raw facts only. Do NOT add derived columns (no *_days, no total_value_usd, no"],
  ["    three_way_match_pass, no scores) — those are computed on read."],
  ["  • Every purchase order must be a COMPLETE chain. A PO without its receipt,"],
  ["    invoice and payment would be scored as a three-way-match pass."],
  ["  • Ids are natural keys and must be unique. Posted documents are immutable:"],
  ["    re-uploading an existing po_id is rejected, not overwritten."],
  ["  • Dates must run in order: pr_date ≤ po_date ≤ receipt_date ≤ invoice_date ≤"],
  ["    payment_date."],
  ["  • buying_method: one of rfq, tender, spot_buy, call_off, direct. 'rfq' and"],
  ["    'tender' are the competitive methods — each needs its own sourcing_event"],
  ["    with responses and an award. 'call_off' needs a framework_id, 'direct' a"],
  ["    justification, 'spot_buy' none of them."],
  ["  • period = the order YEAR of po_date."],
  [],
  ["Dates may be real Excel dates or YYYY-MM-DD text. Booleans are TRUE/FALSE."],
];

/** Build the template workbook as a Buffer. Headers come from REQUIRED_COLUMNS. */
export function buildTemplateWorkbook(): Buffer {
  const wb = xlsx.utils.book_new();
  xlsx.utils.book_append_sheet(wb, xlsx.utils.aoa_to_sheet(README_ROWS), "README");

  for (const sheet of SHEET_NAMES) {
    // Union of the required columns and any extra keys the examples demonstrate
    // (e.g. optional justification / framework_id), required columns first.
    const required = REQUIRED_COLUMNS[sheet];
    const extras = [
      ...new Set(EXAMPLE_ROWS[sheet].flatMap((r) => Object.keys(r))),
    ].filter((k) => !required.includes(k));
    const header = [...required, ...extras];
    const ws = xlsx.utils.json_to_sheet(EXAMPLE_ROWS[sheet], { header });
    xlsx.utils.book_append_sheet(wb, ws, sheet);
  }

  return xlsx.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}
