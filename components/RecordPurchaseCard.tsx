"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Plus, Trash2, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TypeableCombobox, type ComboOption } from "@/components/ui/typeable-combobox";
import { panelElevation, formatCompactCurrency } from "@/lib/utils";
import { BUYING_METHODS, PAYMENT_TERMS, isSourcedMethod } from "@/lib/transaction-create";

export type SupplierPick = { id: string; name: string; category: string };
export type FrameworkPick = { id: string; supplierId: string; title: string };
/** An item plus the suppliers that have supplied it. category/unit are 1:1 with the item. */
export type ItemPick = {
  name: string;
  category: string;
  unit: string;
  supplierIds: string[];
};

/** An ORDER line: what was ordered, and how it was billed. Receiving moved to
 *  the receipts below, because one order line can arrive across several. */
type Line = {
  item_name: string;
  category: string;
  unit: string;
  quantity_ordered: string;
  unit_price_usd: string;
  quantity_billed: string;
  invoice_unit_price_usd: string;
};

const EMPTY_LINE: Line = {
  item_name: "",
  category: "",
  unit: "",
  quantity_ordered: "",
  unit_price_usd: "",
  quantity_billed: "",
  invoice_unit_price_usd: "",
};

/** What ONE receipt recorded against ONE order line — index-aligned with `lines`. */
type ReceiptLine = { received: string; rejected: string; defects: string };
type Receipt = {
  receipt_date: string;
  site: string;
  received_by: string;
  lines: ReceiptLine[];
};

const EMPTY_RECEIPT_LINE: ReceiptLine = { received: "", rejected: "", defects: "" };
const newReceipt = (lineCount: number): Receipt => ({
  receipt_date: "",
  site: "",
  received_by: "",
  lines: Array.from({ length: lineCount }, () => ({ ...EMPTY_RECEIPT_LINE })),
});

/**
 * Keyed to BUYING_METHODS, so a method added without a label is a type error
 * rather than a silently blank button.
 */
const METHOD_LABEL: Record<(typeof BUYING_METHODS)[number], string> = {
  rfq: "RFQ",
  tender: "Tender",
  spot_buy: "Spot buy",
  call_off: "Call-off",
  direct: "Direct award",
};

const opts = (values: string[]): ComboOption[] => values.map((v) => ({ value: v, label: v }));
const numOrUndef = (v: string) => (v.trim() === "" ? undefined : Number(v));

/**
 * Client mirror of the `personName` / `orgName` zod rules in
 * lib/transaction-create.ts — the server stays authoritative, this only surfaces
 * the problem before submitting. A person may hold no digit at all; an
 * organisation or place may not be digits ONLY ("Warehouse 2" is fine).
 */
function nameError(value: string, kind: "person" | "org"): string | null {
  const v = value.trim();
  if (v === "") return null;
  if (!/\p{L}/u.test(v)) {
    return kind === "person"
      ? "Must be a name, not a number."
      : "Must contain a letter, not just digits.";
  }
  if (kind === "person" && /\d/u.test(v)) return "Must be a person's name, not a number.";
  return null;
}

/**
 * Record a COMPLETE purchase: requisition → PO + lines → receipt → invoice →
 * payment, written atomically. There is no open-PO mode by design — a PO without
 * its invoice would be scored as a three-way-match pass.
 */
export function RecordPurchaseCard({
  suppliers,
  frameworks,
  items,
  categories,
  units,
  sites,
  receivers,
  departments,
  requesters,
}: {
  suppliers: SupplierPick[];
  frameworks: FrameworkPick[];
  items: ItemPick[];
  categories: string[];
  units: string[];
  sites: string[];
  receivers: string[];
  departments: string[];
  requesters: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [errors, setErrors] = useState<string[] | null>(null);
  const [showDetail, setShowDetail] = useState(false);

  const [supplierId, setSupplierId] = useState("");
  const [method, setMethod] = useState<(typeof BUYING_METHODS)[number]>("spot_buy");
  const [frameworkId, setFrameworkId] = useState("");
  const [justification, setJustification] = useState("");
  const [invited, setInvited] = useState("3");
  const [requester, setRequester] = useState("");
  const [department, setDepartment] = useState("");
  const [estimate, setEstimate] = useState("");
  const [terms, setTerms] = useState<(typeof PAYMENT_TERMS)[number]>("Net 30");
  const [invoiceNo, setInvoiceNo] = useState("");
  /** PO-level complaint count; blank means none, matching the zod default of 0. */
  const [complaints, setComplaints] = useState("");
  const [dates, setDates] = useState({
    pr_date: "",
    po_date: "",
    promised_delivery_date: "",
    invoice_date: "",
    payment_date: "",
  });
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }]);
  const [receipts, setReceipts] = useState<Receipt[]>([newReceipt(1)]);

  const supplierOptions = useMemo<ComboOption[]>(
    () => suppliers.map((s) => ({ value: s.id, label: s.name, keywords: `${s.id} ${s.category}` })),
    [suppliers],
  );
  const supplier = suppliers.find((s) => s.id === supplierId) ?? null;

  // Only this supplier's frameworks are selectable — verified correct against the
  // data: every call-off references a framework owned by its own supplier. But only
  // 21 of 55 suppliers HAVE one, so an empty list is the common, legitimate case and
  // must explain itself rather than read as a broken field.
  const supplierFrameworks = useMemo(
    () => frameworks.filter((f) => f.supplierId === supplierId),
    [frameworks, supplierId],
  );
  const noFrameworks = !!supplierId && supplierFrameworks.length === 0;

  // Items this supplier has actually supplied (2-5 each). Creatable, so a genuinely
  // new item is still possible.
  const supplierItems = useMemo(
    () => items.filter((i) => i.supplierIds.includes(supplierId)),
    [items, supplierId],
  );
  const itemOptions = useMemo<ComboOption[]>(
    () => supplierItems.map((i) => ({ value: i.name, label: i.name, keywords: `${i.category} ${i.unit}` })),
    [supplierItems],
  );

  const requesterError = nameError(requester, "person");
  const departmentError = nameError(department, "org");
  // Mirrors the required, positive, capped rule in CreateTransactionBody's
  // estimated_value_usd (zod is authoritative). Required because the column is NOT
  // NULL and no fallback may fabricate it.
  const estimateNum = Number(estimate);
  const estimateError =
    estimate.trim() === ""
      ? "Estimated value is required"
      : !Number.isFinite(estimateNum) || estimateNum <= 0
        ? "Estimated value must be greater than zero"
        : estimateNum > 1_000_000_000
          ? "Estimated value looks implausibly large"
          : null;
  // Receiving names follow the same rules, per receipt.
  const receiptNameError = receipts.some(
    (r) => nameError(r.site, "org") || nameError(r.received_by, "person"),
  );

  const total = lines.reduce(
    (sum, l) => sum + (Number(l.quantity_ordered) || 0) * (Number(l.unit_price_usd) || 0),
    0,
  );

  // Reset on open (render-time transition — avoids set-state-in-effect).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setSupplierId("");
      setMethod("spot_buy");
      setFrameworkId("");
      setJustification("");
      setInvited("3");
      setRequester("");
      setDepartment("");
      setEstimate("");
      setTerms("Net 30");
      setInvoiceNo("");
      setComplaints("");
      setDates({
        pr_date: "",
        po_date: "",
        promised_delivery_date: "",
        invoice_date: "",
        payment_date: "",
      });
      setLines([{ ...EMPTY_LINE }]);
      setReceipts([newReceipt(1)]);
      setErrors(null);
      setShowDetail(false);
      setSaving(false);
    }
  }

  function setLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }
  function setReceipt(ri: number, patch: Partial<Omit<Receipt, "lines">>) {
    setReceipts((prev) => prev.map((r, j) => (j === ri ? { ...r, ...patch } : r)));
  }
  function setReceiptLine(ri: number, li: number, patch: Partial<ReceiptLine>) {
    setReceipts((prev) =>
      prev.map((r, j) =>
        j === ri ? { ...r, lines: r.lines.map((rl, k) => (k === li ? { ...rl, ...patch } : rl)) } : r,
      ),
    );
  }
  // Order lines and receipt lines are index-aligned, so adding or removing an
  // order line has to reshape every receipt in the same step.
  function addLine() {
    setLines((prev) => [...prev, { ...EMPTY_LINE }]);
    setReceipts((prev) => prev.map((r) => ({ ...r, lines: [...r.lines, { ...EMPTY_RECEIPT_LINE }] })));
  }
  function removeLine(i: number) {
    setLines((prev) => prev.filter((_, j) => j !== i));
    setReceipts((prev) => prev.map((r) => ({ ...r, lines: r.lines.filter((_, j) => j !== i) })));
  }

  const single = receipts.length === 1;
  /**
   * With ONE receipt a blank quantity still means "all of it arrived", preserving
   * the previous ergonomics. With SEVERAL, blank means zero — "the rest" would be
   * ambiguous once quantities are split, so they must be stated.
   */
  const receivedOf = (rl: ReceiptLine, li: number) =>
    single && rl.received.trim() === ""
      ? Number(lines[li]?.quantity_ordered) || 0
      : Number(rl.received) || 0;
  /** Total received per order line across every receipt — drives the reconciliation hint. */
  const receivedTotals = lines.map((_, li) =>
    receipts.reduce((sum, r) => sum + receivedOf(r.lines[li] ?? EMPTY_RECEIPT_LINE, li), 0),
  );
  const overReceived = lines.some(
    (l, li) => Number(l.quantity_ordered) > 0 && receivedTotals[li] > Number(l.quantity_ordered),
  );

  async function handleSave() {
    setErrors(null);
    setSaving(true);
    try {
      const payload = {
        supplier_id: supplierId,
        buying_method: method,
        ...(method === "call_off" ? { framework_id: frameworkId } : {}),
        ...(method === "direct" ? { justification } : {}),
        ...(isSourcedMethod(method) ? { num_suppliers_invited: Number(invited) || 3 } : {}),
        requester,
        department,
        estimated_value_usd: estimateNum,
        payment_terms: terms,
        supplier_invoice_no: invoiceNo,
        // Blank -> 0, matching the zod default; a fractional entry is floored so
        // the integer schema cannot reject a stray "1.5".
        complaint_count: Math.max(0, Math.floor(Number(complaints) || 0)),
        ...dates,
        lines: lines.map((l) => ({
          item_name: l.item_name,
          category: l.category,
          unit: l.unit,
          quantity_ordered: Number(l.quantity_ordered) || 0,
          unit_price_usd: Number(l.unit_price_usd) || 0,
          quantity_billed: numOrUndef(l.quantity_billed),
          invoice_unit_price_usd: numOrUndef(l.invoice_unit_price_usd),
        })),
        receipts: receipts.map((r) => ({
          receipt_date: r.receipt_date,
          site: r.site,
          received_by: r.received_by,
          // A single receipt covers every line (blank = all of it arrived). With
          // several, only the lines this receipt actually touched are sent, so a
          // split delivery does not create meaningless zero-quantity GRN lines.
          lines: r.lines
            .map((rl, li) => ({ rl, li }))
            .filter(
              ({ rl }) =>
                single || rl.received.trim() !== "" || rl.rejected.trim() !== "" || rl.defects.trim() !== "",
            )
            .map(({ rl, li }) => ({
              line_index: li,
              quantity_received: receivedOf(rl, li),
              quantity_rejected: Number(rl.rejected) || 0,
              defect_count: Number(rl.defects) || 0,
            })),
        })),
      };
      const res = await fetch("/api/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        issues?: string[];
        success?: boolean;
        purchase?: { poId: string; totalValueUsd: number };
      };
      if (res.ok && data.purchase) {
        toast.success(
          `Recorded ${data.purchase.poId} — ${formatCompactCurrency(data.purchase.totalValueUsd)}.`,
        );
        setOpen(false);
        router.refresh();
      } else {
        setErrors(data.issues ?? [data.error ?? "Could not record the purchase."]);
      }
    } catch {
      setErrors(["Could not record the purchase — the request did not complete."]);
    } finally {
      setSaving(false);
    }
  }

  const dateField = (key: keyof typeof dates, label: string) => (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={`rp-${key}`}>{label}</Label>
      <Input
        id={`rp-${key}`}
        type="date"
        value={dates[key]}
        onChange={(e) => setDates((d) => ({ ...d, [key]: e.target.value }))}
      />
    </div>
  );

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Transactions</h2>
        <Button size="sm" onClick={() => setOpen(true)}>
          <Plus className="mr-1 h-4 w-4" />
          Record purchase
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Records the complete document chain — requisition, purchase order and lines,
        goods receipt, invoice and payment — in one atomic write, then recomputes every
        period. Partially-completed orders are not supported: a PO without its invoice
        would be scored as a three-way-match pass.
      </p>

      <Dialog open={open} onOpenChange={(o) => !saving && setOpen(o)}>
        <DialogContent
          showCloseButton={false}
          aria-label="Record a purchase"
          className={`flex max-h-[88vh] w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[900px] ${panelElevation}`}
        >
          <header className="flex items-start justify-between gap-2 border-b p-4">
            <div className="min-w-0">
              <DialogTitle className="truncate font-heading text-base font-medium leading-snug">
                Record a purchase
              </DialogTitle>
              <p className="truncate text-xs text-muted-foreground">
                All document ids are assigned automatically, continuing the existing sequences.
              </p>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Close" onClick={() => setOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </header>

          <div className="flex flex-col gap-5 p-4">
            {/* Supplier + method */}
            <div className="grid gap-4 sm:grid-cols-2">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rp-supplier">Supplier</Label>
                <TypeableCombobox
                  id="rp-supplier"
                  aria-label="Supplier"
                  value={supplierId}
                  onChange={(v) => {
                    setSupplierId(v);
                    setFrameworkId("");
                  }}
                  options={supplierOptions}
                  placeholder="Type to search suppliers"
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rp-method">Buying method</Label>
                <div className="flex flex-wrap gap-1.5" id="rp-method" role="radiogroup">
                  {BUYING_METHODS.map((m) => {
                    // Call-off is unavailable when the chosen supplier has no
                    // framework — shown ON the button so the dead end is visible
                    // before it is selected, not after.
                    const blocked = m === "call_off" && noFrameworks;
                    return (
                      <Button
                        key={m}
                        type="button"
                        role="radio"
                        aria-checked={method === m}
                        aria-disabled={blocked}
                        title={
                          blocked
                            ? `${supplier?.name} has no active framework agreement`
                            : undefined
                        }
                        variant={method === m ? "default" : "outline"}
                        size="sm"
                        className={blocked ? "opacity-40" : undefined}
                        onClick={() => !blocked && setMethod(m)}
                      >
                        {METHOD_LABEL[m]}
                      </Button>
                    );
                  })}
                </div>
                {noFrameworks && (
                  <p className="text-[11px] text-muted-foreground">
                    Call-off unavailable — {supplier?.name} has no framework agreement.
                  </p>
                )}
              </div>
            </div>

            {/* Method-conditional field */}
            {method === "call_off" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rp-framework">Framework agreement</Label>
                <TypeableCombobox
                  id="rp-framework"
                  aria-label="Framework agreement"
                  value={frameworkId}
                  onChange={setFrameworkId}
                  options={supplierFrameworks.map((f) => ({ value: f.id, label: `${f.id} — ${f.title}` }))}
                  // Inert until a supplier is chosen: with no supplier the list is
                  // necessarily empty and nothing could ever be committed, so an
                  // editable-looking field would just swallow typing.
                  disabled={!supplierId}
                  placeholder={supplierId ? "Select a framework" : "Choose a supplier first"}
                  emptyText={
                    supplier
                      ? `${supplier.name} has no active framework agreement`
                      : "Choose a supplier first"
                  }
                />
                {noFrameworks && (
                  <p className="text-[11px] text-destructive">
                    {supplier?.name} has no active framework agreement — a call-off
                    requires one. Choose another buying method, or another supplier.
                  </p>
                )}
              </div>
            )}
            {method === "direct" && (
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rp-justification">Justification</Label>
                <Input
                  id="rp-justification"
                  value={justification}
                  onChange={(e) => setJustification(e.target.value)}
                  placeholder="Why this supplier was awarded directly"
                />
              </div>
            )}
            {isSourcedMethod(method) && (
              <div className="flex flex-col gap-1.5 sm:max-w-[220px]">
                <Label htmlFor="rp-invited">Suppliers invited</Label>
                <Input
                  id="rp-invited"
                  type="number"
                  min={2}
                  max={10}
                  value={invited}
                  onChange={(e) => setInvited(e.target.value)}
                />
                <p className="text-[11px] text-muted-foreground">
                  {method === "tender"
                    ? "Bidders invited to the tender. A sourcing event, bid responses and the award are recorded."
                    : "Suppliers invited to quote. A sourcing event, bid responses and the award are recorded."}
                </p>
              </div>
            )}

            {/* Requisition + logistics */}
            <div className="grid gap-4 sm:grid-cols-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rp-requester">Requester</Label>
                <TypeableCombobox id="rp-requester" aria-label="Requester" value={requester} onChange={setRequester} options={opts(requesters)} creatable placeholder="Select or type" />
                {requesterError && <p className="text-[11px] text-destructive">{requesterError}</p>}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rp-department">Department</Label>
                <TypeableCombobox id="rp-department" aria-label="Department" value={department} onChange={setDepartment} options={opts(departments)} creatable placeholder="Select or type" />
                {departmentError && <p className="text-[11px] text-destructive">{departmentError}</p>}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rp-estimate">Estimated value (USD)</Label>
                <Input
                  id="rp-estimate"
                  type="number"
                  min={0}
                  step="any"
                  value={estimate}
                  onChange={(e) => setEstimate(e.target.value)}
                  placeholder="e.g. 250000"
                />
                {estimateError ? (
                  <p className="text-[11px] text-destructive">{estimateError}</p>
                ) : (
                  <p className="text-[11px] text-muted-foreground">
                    The budget owner&rsquo;s pre-market estimate for this requisition — what
                    was approved before the order was placed. Need not match the order total.
                  </p>
                )}
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rp-terms">Payment terms</Label>
                <div className="flex gap-1.5" id="rp-terms" role="radiogroup">
                  {PAYMENT_TERMS.map((t) => (
                    <Button key={t} type="button" role="radio" aria-checked={terms === t} variant={terms === t ? "default" : "outline"} size="sm" onClick={() => setTerms(t)}>
                      {t}
                    </Button>
                  ))}
                </div>
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rp-invoiceno">Supplier invoice no.</Label>
                <Input id="rp-invoiceno" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="e.g. INV-4471" />
              </div>
              {/* PO-LEVEL, deliberately not in a receipt card: a complaint is a
                  relational grievance about the ORDER (late, wrong paperwork,
                  poor handling), not a dock-side observation about goods. The
                  physical signals — rejected quantity and defects — are recorded
                  per receipt below. */}
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rp-complaints">Complaints</Label>
                <Input
                  id="rp-complaints"
                  type="number"
                  min={0}
                  step={1}
                  value={complaints}
                  onChange={(e) => setComplaints(e.target.value)}
                  placeholder="0"
                />
                <p className="text-[11px] text-muted-foreground">
                  Complaints raised about this order. Leave blank for none — most orders
                  have none. Feeds the supplier&rsquo;s Quality score, separately from
                  the rejected quantity and defects recorded per receipt.
                </p>
              </div>
            </div>

            {/* Dates */}
            <div>
              <p className="mb-2 text-sm font-medium">Document dates</p>
              <div className="grid gap-4 sm:grid-cols-3">
                {dateField("pr_date", "Requisition")}
                {dateField("po_date", "PO")}
                {dateField("promised_delivery_date", "Promised delivery")}
                {dateField("invoice_date", "Invoice")}
                {dateField("payment_date", "Payment")}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Must run in order: requisition → PO → receipt → invoice → payment. Receipt
                dates are set per receipt below. The PO year sets the reporting period.
              </p>
            </div>

            {/* Lines */}
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  Order lines{" "}
                  <span className="font-normal text-muted-foreground">
                    · {formatCompactCurrency(total)} total
                  </span>
                </p>
                <div className="flex items-center gap-2">
                  <Button type="button" variant="ghost" size="sm" onClick={() => setShowDetail((v) => !v)}>
                    {showDetail ? "Hide" : "Show"} billing detail
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={addLine}>
                    <Plus className="mr-1 h-3.5 w-3.5" />
                    Add line
                  </Button>
                </div>
              </div>

              <div className="flex flex-col gap-3">
                {lines.map((l, i) => (
                  <div key={i} className="rounded-lg border p-3">
                    <div className="grid gap-3 sm:grid-cols-12">
                      <div className="flex flex-col gap-1.5 sm:col-span-4">
                        <Label htmlFor={`rp-item-${i}`}>Item</Label>
                        <TypeableCombobox
                          id={`rp-item-${i}`}
                          aria-label="Item"
                          value={l.item_name}
                          // Picking a known item fills category + unit, which are 1:1
                          // with the item in the data. A newly-created name matches
                          // nothing, so those stay as typed.
                          onChange={(v) => {
                            const known = items.find((it) => it.name === v);
                            setLine(i, known ? { item_name: v, category: known.category, unit: known.unit } : { item_name: v });
                          }}
                          options={itemOptions}
                          creatable
                          disabled={!supplierId}
                          placeholder={supplierId ? "Select or type an item" : "Choose a supplier first"}
                          emptyText={
                            supplier
                              ? `No items on record for ${supplier.name} — type to add one`
                              : "Choose a supplier first"
                          }
                        />
                      </div>
                      <div className="flex flex-col gap-1.5 sm:col-span-3">
                        <Label htmlFor={`rp-cat-${i}`}>Category</Label>
                        <TypeableCombobox id={`rp-cat-${i}`} aria-label="Category" value={l.category} onChange={(v) => setLine(i, { category: v })} options={opts(categories)} creatable placeholder="Select" />
                      </div>
                      <div className="flex flex-col gap-1.5 sm:col-span-2">
                        <Label htmlFor={`rp-unit-${i}`}>Unit</Label>
                        <TypeableCombobox id={`rp-unit-${i}`} aria-label="Unit" value={l.unit} onChange={(v) => setLine(i, { unit: v })} options={opts(units)} creatable placeholder="pcs" />
                      </div>
                      <div className="flex flex-col gap-1.5 sm:col-span-1">
                        <Label htmlFor={`rp-qty-${i}`}>Qty</Label>
                        <Input id={`rp-qty-${i}`} type="number" min={0} value={l.quantity_ordered} onChange={(e) => setLine(i, { quantity_ordered: e.target.value })} />
                      </div>
                      <div className="flex flex-col gap-1.5 sm:col-span-2">
                        <Label htmlFor={`rp-price-${i}`}>Unit price (USD)</Label>
                        <Input id={`rp-price-${i}`} type="number" min={0} step="0.01" value={l.unit_price_usd} onChange={(e) => setLine(i, { unit_price_usd: e.target.value })} />
                      </div>
                    </div>

                    {showDetail && (
                      <div className="mt-3 grid gap-3 border-t pt-3 sm:grid-cols-2">
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor={`rp-bill-${i}`}>Billed qty</Label>
                          <Input id={`rp-bill-${i}`} type="number" min={0} value={l.quantity_billed} onChange={(e) => setLine(i, { quantity_billed: e.target.value })} placeholder="= accepted" />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor={`rp-iprice-${i}`}>Invoice price</Label>
                          <Input id={`rp-iprice-${i}`} type="number" min={0} step="0.01" value={l.invoice_unit_price_usd} onChange={(e) => setLine(i, { invoice_unit_price_usd: e.target.value })} placeholder="= PO price" />
                        </div>
                      </div>
                    )}

                    {lines.length > 1 && (
                      <div className="mt-2 flex justify-end">
                        <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(i)}>
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
                          Remove line
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              {showDetail && (
                <p className="mt-1.5 text-[11px] text-muted-foreground">
                  Billed quantity and invoice price default to the accepted quantity
                  (received minus rejected, across every receipt) and the PO price — a
                  correct invoice, which passes the three-way match. Overriding either
                  records a genuine billing discrepancy and will fail the match.
                </p>
              )}
            </div>

            {/* Goods receipts — one per physical delivery */}
            <div>
              <div className="mb-2 flex items-center justify-between gap-2">
                <p className="text-sm font-medium">
                  Goods receipts{" "}
                  <span className="font-normal text-muted-foreground">
                    · {receipts.length} {receipts.length === 1 ? "delivery" : "deliveries"}
                  </span>
                </p>
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={() => setReceipts((prev) => [...prev, newReceipt(lines.length)])}
                >
                  <Plus className="mr-1 h-3.5 w-3.5" />
                  Add receipt
                </Button>
              </div>

              <div className="flex flex-col gap-3">
                {receipts.map((r, ri) => (
                  <div key={ri} className="rounded-lg border p-3">
                    <div className="grid gap-3 sm:grid-cols-3">
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`rp-rdate-${ri}`}>Receipt date</Label>
                        <Input
                          id={`rp-rdate-${ri}`}
                          type="date"
                          value={r.receipt_date}
                          onChange={(e) => setReceipt(ri, { receipt_date: e.target.value })}
                        />
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`rp-rsite-${ri}`}>Receiving site</Label>
                        <TypeableCombobox
                          id={`rp-rsite-${ri}`}
                          aria-label="Receiving site"
                          value={r.site}
                          onChange={(v) => setReceipt(ri, { site: v })}
                          options={opts(sites)}
                          creatable
                          placeholder="Select or type"
                        />
                        {nameError(r.site, "org") && (
                          <p className="text-[11px] text-destructive">{nameError(r.site, "org")}</p>
                        )}
                      </div>
                      <div className="flex flex-col gap-1.5">
                        <Label htmlFor={`rp-rby-${ri}`}>Received by</Label>
                        <TypeableCombobox
                          id={`rp-rby-${ri}`}
                          aria-label="Received by"
                          value={r.received_by}
                          onChange={(v) => setReceipt(ri, { received_by: v })}
                          options={opts(receivers)}
                          creatable
                          placeholder="Select or type"
                        />
                        {nameError(r.received_by, "person") && (
                          <p className="text-[11px] text-destructive">
                            {nameError(r.received_by, "person")}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="mt-3 border-t pt-3">
                      <p className="mb-2 text-xs font-medium text-muted-foreground">
                        Quantities received in this delivery
                      </p>
                      <div className="flex flex-col gap-2">
                        {lines.map((l, li) => {
                          const rl = r.lines[li] ?? EMPTY_RECEIPT_LINE;
                          const ordered = Number(l.quantity_ordered) || 0;
                          const over = ordered > 0 && receivedTotals[li] > ordered;
                          return (
                            <div key={li} className="grid items-end gap-2 sm:grid-cols-12">
                              <div className="sm:col-span-5">
                                <p className="truncate text-xs">
                                  {l.item_name || <span className="text-muted-foreground">Line {li + 1}</span>}
                                </p>
                                <p className={`text-[11px] ${over ? "text-destructive" : "text-muted-foreground"}`}>
                                  {receivedTotals[li]} of {ordered || "—"} received
                                  {over ? " — more than ordered" : ""}
                                </p>
                              </div>
                              <div className="flex flex-col gap-1 sm:col-span-3">
                                <Label htmlFor={`rp-recv-${ri}-${li}`} className="text-[11px]">Received</Label>
                                <Input
                                  id={`rp-recv-${ri}-${li}`}
                                  type="number"
                                  min={0}
                                  value={rl.received}
                                  onChange={(e) => setReceiptLine(ri, li, { received: e.target.value })}
                                  placeholder={single ? "= ordered" : "0"}
                                />
                              </div>
                              <div className="flex flex-col gap-1 sm:col-span-2">
                                <Label htmlFor={`rp-rej-${ri}-${li}`} className="text-[11px]">Rejected</Label>
                                <Input
                                  id={`rp-rej-${ri}-${li}`}
                                  type="number"
                                  min={0}
                                  value={rl.rejected}
                                  onChange={(e) => setReceiptLine(ri, li, { rejected: e.target.value })}
                                  placeholder="0"
                                />
                              </div>
                              <div className="flex flex-col gap-1 sm:col-span-2">
                                <Label htmlFor={`rp-def-${ri}-${li}`} className="text-[11px]">Defects</Label>
                                <Input
                                  id={`rp-def-${ri}-${li}`}
                                  type="number"
                                  min={0}
                                  value={rl.defects}
                                  onChange={(e) => setReceiptLine(ri, li, { defects: e.target.value })}
                                  placeholder="0"
                                />
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {receipts.length > 1 && (
                      <div className="mt-2 flex justify-end">
                        <Button
                          type="button"
                          variant="ghost"
                          size="sm"
                          onClick={() => setReceipts((prev) => prev.filter((_, j) => j !== ri))}
                        >
                          <Trash2 className="mr-1 h-3.5 w-3.5" />
                          Remove receipt
                        </Button>
                      </div>
                    )}
                  </div>
                ))}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                {single
                  ? "One delivery. A blank quantity means the whole line arrived. Add a receipt to split a delivery across dates or sites."
                  : "Split delivery — enter what arrived in each one; blanks count as zero. Delivery performance is judged on the LAST receipt date, and a receipt is marked complete once everything ordered has arrived."}
              </p>
            </div>

            {errors && (
              <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3">
                <p className="text-sm font-medium text-destructive">Nothing was written.</p>
                <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                  {errors.slice(0, 8).map((e, i) => (
                    <li key={i}>{e}</li>
                  ))}
                </ul>
              </div>
            )}
          </div>

          <footer className="flex items-center justify-between gap-2 border-t bg-muted/50 p-4">
            <span className="text-sm text-muted-foreground">
              Order total <span className="font-medium text-foreground">{formatCompactCurrency(total)}</span>
            </span>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={saving}>
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={saving || !!requesterError || !!departmentError || !!estimateError || receiptNameError || overReceived}
              >
                {saving ? "Recording…" : "Record purchase"}
              </Button>
            </div>
          </footer>
        </DialogContent>
      </Dialog>
    </div>
  );
}
