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

type Line = {
  item_name: string;
  category: string;
  unit: string;
  quantity_ordered: string;
  unit_price_usd: string;
  quantity_received: string;
  quantity_rejected: string;
  defect_count: string;
  quantity_billed: string;
  invoice_unit_price_usd: string;
};

const EMPTY_LINE: Line = {
  item_name: "",
  category: "",
  unit: "",
  quantity_ordered: "",
  unit_price_usd: "",
  quantity_received: "",
  quantity_rejected: "",
  defect_count: "",
  quantity_billed: "",
  invoice_unit_price_usd: "",
};

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
  const [terms, setTerms] = useState<(typeof PAYMENT_TERMS)[number]>("Net 30");
  const [site, setSite] = useState("");
  const [receivedBy, setReceivedBy] = useState("");
  const [invoiceNo, setInvoiceNo] = useState("");
  const [dates, setDates] = useState({
    pr_date: "",
    po_date: "",
    promised_delivery_date: "",
    receipt_date: "",
    invoice_date: "",
    payment_date: "",
  });
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }]);

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

  // Mirrors the zod rules in lib/transaction-create.ts (personName / orgName). The
  // server stays authoritative; this only surfaces the problem before submitting.
  const requesterError =
    requester.trim() !== "" && (/\d/u.test(requester) || !/\p{L}/u.test(requester))
      ? "Requester must be a person's name, not a number."
      : null;
  const departmentError =
    department.trim() !== "" && !/\p{L}/u.test(department)
      ? "Department must contain a letter, not just digits."
      : null;

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
      setTerms("Net 30");
      setSite("");
      setReceivedBy("");
      setInvoiceNo("");
      setDates({
        pr_date: "",
        po_date: "",
        promised_delivery_date: "",
        receipt_date: "",
        invoice_date: "",
        payment_date: "",
      });
      setLines([{ ...EMPTY_LINE }]);
      setErrors(null);
      setShowDetail(false);
      setSaving(false);
    }
  }

  function setLine(i: number, patch: Partial<Line>) {
    setLines((prev) => prev.map((l, j) => (j === i ? { ...l, ...patch } : l)));
  }

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
        payment_terms: terms,
        site,
        received_by: receivedBy,
        supplier_invoice_no: invoiceNo,
        ...dates,
        lines: lines.map((l) => ({
          item_name: l.item_name,
          category: l.category,
          unit: l.unit,
          quantity_ordered: Number(l.quantity_ordered) || 0,
          unit_price_usd: Number(l.unit_price_usd) || 0,
          quantity_received: numOrUndef(l.quantity_received),
          quantity_rejected: Number(l.quantity_rejected) || 0,
          defect_count: Number(l.defect_count) || 0,
          quantity_billed: numOrUndef(l.quantity_billed),
          invoice_unit_price_usd: numOrUndef(l.invoice_unit_price_usd),
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
                <Label htmlFor="rp-site">Receiving site</Label>
                <TypeableCombobox id="rp-site" aria-label="Receiving site" value={site} onChange={setSite} options={opts(sites)} creatable placeholder="Select or type" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rp-receivedby">Received by</Label>
                <TypeableCombobox id="rp-receivedby" aria-label="Received by" value={receivedBy} onChange={setReceivedBy} options={opts(receivers)} creatable placeholder="Select or type" />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="rp-invoiceno">Supplier invoice no.</Label>
                <Input id="rp-invoiceno" value={invoiceNo} onChange={(e) => setInvoiceNo(e.target.value)} placeholder="e.g. INV-4471" />
              </div>
            </div>

            {/* Dates */}
            <div>
              <p className="mb-2 text-sm font-medium">Document dates</p>
              <div className="grid gap-4 sm:grid-cols-3">
                {dateField("pr_date", "Requisition")}
                {dateField("po_date", "PO")}
                {dateField("promised_delivery_date", "Promised delivery")}
                {dateField("receipt_date", "Goods receipt")}
                {dateField("invoice_date", "Invoice")}
                {dateField("payment_date", "Payment")}
              </div>
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Must run in order: requisition → PO → receipt → invoice → payment. The PO
                year sets the reporting period.
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
                    {showDetail ? "Hide" : "Show"} receipt &amp; billing detail
                  </Button>
                  <Button type="button" variant="outline" size="sm" onClick={() => setLines((l) => [...l, { ...EMPTY_LINE }])}>
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
                      <div className="mt-3 grid gap-3 border-t pt-3 sm:grid-cols-5">
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor={`rp-recv-${i}`}>Received</Label>
                          <Input id={`rp-recv-${i}`} type="number" min={0} value={l.quantity_received} onChange={(e) => setLine(i, { quantity_received: e.target.value })} placeholder="= ordered" />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor={`rp-rej-${i}`}>Rejected</Label>
                          <Input id={`rp-rej-${i}`} type="number" min={0} value={l.quantity_rejected} onChange={(e) => setLine(i, { quantity_rejected: e.target.value })} placeholder="0" />
                        </div>
                        <div className="flex flex-col gap-1.5">
                          <Label htmlFor={`rp-def-${i}`}>Defects</Label>
                          <Input id={`rp-def-${i}`} type="number" min={0} value={l.defect_count} onChange={(e) => setLine(i, { defect_count: e.target.value })} placeholder="0" />
                        </div>
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
                        <Button type="button" variant="ghost" size="sm" onClick={() => setLines((prev) => prev.filter((_, j) => j !== i))}>
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
                  Billed quantity and invoice price default to the accepted quantity and the
                  PO price — a correct invoice, which passes the three-way match. Overriding
                  either records a genuine billing discrepancy and will fail the match.
                </p>
              )}
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
              <Button onClick={handleSave} disabled={saving || !!requesterError || !!departmentError}>
                {saving ? "Recording…" : "Record purchase"}
              </Button>
            </div>
          </footer>
        </DialogContent>
      </Dialog>
    </div>
  );
}
