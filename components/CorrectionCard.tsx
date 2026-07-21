"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Scale, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TypeableCombobox, type ComboOption } from "@/components/ui/typeable-combobox";
import { panelElevation, formatCompactCurrency } from "@/lib/utils";

/** One selectable purchase order, assembled server-side (see the import page). */
export type CorrectablePo = {
  id: string;
  supplierId: string;
  supplierName: string;
  category: string;
  period: string;
  buyingMethod: string;
  totalValueUsd: number;
  matchPass: boolean;
  defectCount: number;
  /** ISO day, for the PO-date range filter. */
  poDate?: string;
};

type Line = {
  id: string;
  itemName: string;
  category: string;
  unit: string;
  orderedQty: number;
  netQty: number;
  unitPriceUsd: number;
  billedQty: number;
  billedPrice: number | null;
  defects: number;
  correctionCount: number;
  receiptQuantities: { grnId: string; received: number; rejected: number }[];
};

type Receipt = {
  id: string;
  receiptDate: string | null;
  site: string;
  receivedBy: string;
  status: string;
};

type Chain = {
  po: {
    id: string;
    supplierId: string;
    supplierName: string;
    buyingMethod: string;
    frameworkId: string | null;
    justification: string | null;
    paymentTerms: string;
    complaintCount: number;
    period: string;
    requester: string;
    department: string;
    supplierInvoiceNo: string;
    dates: {
      pr: string | null;
      po: string | null;
      promised: string | null;
      invoice: string | null;
      payment: string | null;
    };
  };
  receipts: Receipt[];
  lines: Line[];
};

/** What the user typed per line — absolute values, exactly as record-purchase shows them. */
type Edit = { quantity: string; invoicePrice: string; defects: string };
const EMPTY_EDIT: Edit = { quantity: "", invoicePrice: "", defects: "" };

const METHOD_LABEL: Record<string, string> = {
  rfq: "RFQ",
  tender: "Tender",
  spot_buy: "Spot buy",
  call_off: "Call-off",
  direct: "Direct award",
};

const n2 = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });

function parseNum(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

type MatchFilter = "all" | "fail" | "pass";

/**
 * Post a correction against a posted transactional record.
 *
 * The form MIRRORS the record-purchase layout field for field, so the order reads
 * the same way it was entered. Almost everything is disabled: a correction can only
 * move quantity, billed price and defects, and only at line level. A wrong supplier,
 * date or buying method is not correctable at all — that order is voided and
 * re-recorded.
 *
 * ⚠️ Fields hold ABSOLUTE values, like record-purchase; the signed deltas the
 * correction API wants are derived on submit. Each changed field becomes its own
 * signed correction row, so one submit can move several fields and the ledger still
 * records them one by one.
 */
export function CorrectionCard({ pos }: { pos: CorrectablePo[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Step 1 — finding the order.
  const [fSupplier, setFSupplier] = useState("");
  const [fMatch, setFMatch] = useState<MatchFilter>("all");
  const [fPeriod, setFPeriod] = useState("all");
  const [fFrom, setFFrom] = useState("");
  const [fTo, setFTo] = useState("");
  const [poId, setPoId] = useState("");

  // Step 2 — the loaded order.
  const [chain, setChain] = useState<Chain | null>(null);
  const [edits, setEdits] = useState<Record<string, Edit>>({});
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const periods = useMemo(() => [...new Set(pos.map((p) => p.period))].sort(), [pos]);

  const supplierOptions = useMemo<ComboOption[]>(() => {
    const byId = new Map<string, string>();
    for (const p of pos) byId.set(p.supplierId, p.supplierName);
    return [
      { value: "", label: "All suppliers" },
      ...[...byId.entries()]
        .sort((a, b) => a[1].localeCompare(b[1]))
        .map(([id, name]) => ({ value: id, label: name, keywords: id })),
    ];
  }, [pos]);

  const visiblePos = useMemo(
    () =>
      pos.filter((p) => {
        if (fSupplier !== "" && p.supplierId !== fSupplier) return false;
        if (fMatch === "fail" && p.matchPass) return false;
        if (fMatch === "pass" && !p.matchPass) return false;
        if (fPeriod !== "all" && p.period !== fPeriod) return false;
        // ⚠️ PO DATE is a separate axis from period. Period groups by order YEAR;
        // this range finds orders placed inside a specific window, which may sit
        // inside one year or straddle several.
        if (fFrom && (!p.poDate || p.poDate < fFrom)) return false;
        if (fTo && (!p.poDate || p.poDate > fTo)) return false;
        return true;
      }),
    [pos, fSupplier, fMatch, fPeriod, fFrom, fTo],
  );

  const poOptions = useMemo<ComboOption[]>(
    () =>
      visiblePos.map((p) => ({
        value: p.id,
        label: `${p.id} — ${p.supplierName}`,
        keywords: `${p.supplierId} ${p.category} ${p.period} ${p.buyingMethod} ${
          p.matchPass ? "passing" : "failing"
        }`,
      })),
    [visiblePos],
  );

  const poById = useMemo(() => new Map(pos.map((p) => [p.id, p])), [pos]);

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) resetAll();
  }

  function resetAll() {
    setFSupplier("");
    setFMatch("all");
    setFPeriod("all");
    setFFrom("");
    setFTo("");
    setPoId("");
    setChain(null);
    setEdits({});
    setReason("");
    setError(null);
    setBusy(false);
  }

  async function selectPo() {
    if (!poId) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/corrections/lines?poId=${encodeURIComponent(poId)}`);
      const data = (await res.json().catch(() => ({}))) as Partial<Chain> & { error?: string };
      if (res.ok && data.lines && data.po) {
        setChain(data as Chain);
        setEdits(
          Object.fromEntries(
            data.lines.map((l) => [
              l.id,
              {
                quantity: String(l.netQty),
                invoicePrice: l.billedPrice !== null ? String(l.billedPrice) : "",
                defects: String(l.defects),
              },
            ]),
          ),
        );
      } else {
        setError(data.error ?? "Could not load that purchase order.");
      }
    } catch {
      setError("Could not load that purchase order.");
    } finally {
      setBusy(false);
    }
  }

  function setEdit(lineId: string, patch: Partial<Edit>) {
    setEdits((prev) => ({ ...prev, [lineId]: { ...(prev[lineId] ?? EMPTY_EDIT), ...patch } }));
  }

  /**
   * Turn the typed absolute values into the signed items the API wants. A field is
   * only sent when it actually differs from what is on record, so an untouched form
   * posts nothing.
   */
  const items = useMemo(() => {
    if (!chain) return [];
    const out: {
      po_line_id: string;
      kind: "quantity" | "price" | "defect";
      quantity_delta?: number;
      corrected_unit_price?: number;
      defect_delta?: number;
      label: string;
    }[] = [];
    for (const l of chain.lines) {
      const e = edits[l.id] ?? EMPTY_EDIT;
      const q = parseNum(e.quantity);
      if (q !== null && q !== l.netQty) {
        out.push({
          po_line_id: l.id,
          kind: "quantity",
          quantity_delta: q - l.netQty,
          label: `${l.itemName}: quantity ${n2(l.netQty)} → ${n2(q)}`,
        });
      }
      const p = parseNum(e.invoicePrice);
      if (p !== null && l.billedPrice !== null && p !== l.billedPrice) {
        out.push({
          po_line_id: l.id,
          kind: "price",
          corrected_unit_price: p,
          label: `${l.itemName}: billed price ${n2(l.billedPrice)} → ${n2(p)}`,
        });
      }
      const d = parseNum(e.defects);
      if (d !== null && Number.isInteger(d) && d !== l.defects) {
        out.push({
          po_line_id: l.id,
          kind: "defect",
          defect_delta: d - l.defects,
          label: `${l.itemName}: defects ${l.defects} → ${d}`,
        });
      }
    }
    return out;
  }, [chain, edits]);

  const reasonValid = reason.trim().length >= 3;

  async function submit() {
    if (!chain || items.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          reason,
          // `label` is display-only; the API takes the signed values.
          items: items.map((i) => ({
            po_line_id: i.po_line_id,
            kind: i.kind,
            ...(i.quantity_delta !== undefined ? { quantity_delta: i.quantity_delta } : {}),
            ...(i.corrected_unit_price !== undefined
              ? { corrected_unit_price: i.corrected_unit_price }
              : {}),
            ...(i.defect_delta !== undefined ? { defect_delta: i.defect_delta } : {}),
          })),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        success?: boolean;
        corrections?: { netEffect: string }[];
      };
      if (res.ok && data.corrections) {
        const n = data.corrections.length;
        toast.success(
          `${n} correction${n === 1 ? "" : "s"} posted — ${data.corrections
            .map((c) => c.netEffect)
            .join("; ")}.`,
        );
        setOpen(false);
        router.refresh();
      } else {
        setError(data.error ?? "Could not post the correction.");
      }
    } catch {
      setError("Could not post the correction.");
    } finally {
      setBusy(false);
    }
  }

  const selectedPo = poId ? poById.get(poId) ?? null : null;

  /**
   * Hand this order over to the data browser for voiding. The locked fields have no
   * correction path — a wrong supplier or date is not an adjustment, it is an order
   * that should not stand — so the offer is made where the user actually hits the
   * wall, on the field they just tried to edit.
   */
  function handOverToVoid() {
    if (!chain) return;
    setOpen(false);
    router.push(`/import?focusPo=${encodeURIComponent(chain.po.id)}`, { scroll: false });
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">Corrections</h2>
        <Button size="sm" variant="outline" onClick={() => setOpen(true)}>
          <Scale className="mr-1 h-4 w-4" />
          Post correction
        </Button>
      </div>
      <p className="text-sm text-muted-foreground">
        Posted records are immutable — the database rejects any attempt to edit one. A
        mistake is corrected by posting a linked, signed adjustment that nets against
        the original, leaving both the original entry and the correction on the record.
        Posting recomputes every period, which takes a few seconds.
      </p>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent
          showCloseButton={false}
          aria-label="Post a correction"
          className={`flex max-h-[88vh] w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[900px] ${panelElevation}`}
        >
          <header className="flex items-start justify-between gap-2 border-b p-4">
            <div className="min-w-0">
              <DialogTitle className="truncate font-heading text-base font-medium leading-snug">
                {chain ? `Correct ${chain.po.id}` : "Post a correction"}
              </DialogTitle>
              <p className="truncate text-xs text-muted-foreground">
                {chain
                  ? "Only quantity, billed price and defects can be corrected."
                  : "Find the order first."}
              </p>
            </div>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              aria-label="Close"
              onClick={() => setOpen(false)}
            >
              <X className="h-4 w-4" />
            </Button>
          </header>

          <div className="flex flex-col gap-5 p-4">
            {/* ---------------- STEP 1: find the order ---------------- */}
            {!chain && (
              <>
                <div>
                  <p className="mb-2 text-sm font-medium">Find the purchase order</p>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="corr-supplier">Supplier</Label>
                      <TypeableCombobox
                        id="corr-supplier"
                        aria-label="Supplier"
                        value={fSupplier}
                        onChange={(v) => {
                          setFSupplier(v);
                          setPoId("");
                        }}
                        options={supplierOptions}
                        placeholder="All suppliers"
                      />
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="corr-match">Three-way match</Label>
                      <select
                        id="corr-match"
                        value={fMatch}
                        onChange={(e) => {
                          setFMatch(e.target.value as MatchFilter);
                          setPoId("");
                        }}
                        className="h-9 rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring"
                      >
                        <option value="all">All</option>
                        <option value="fail">Failing only</option>
                        <option value="pass">Passing only</option>
                      </select>
                    </div>

                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="corr-period">Period (order year)</Label>
                      <div className="flex flex-wrap gap-1.5" id="corr-period" role="radiogroup">
                        <Button
                          type="button"
                          role="radio"
                          aria-checked={fPeriod === "all"}
                          variant={fPeriod === "all" ? "default" : "outline"}
                          size="sm"
                          onClick={() => {
                            setFPeriod("all");
                            setPoId("");
                          }}
                        >
                          All
                        </Button>
                        {periods.map((p) => (
                          <Button
                            key={p}
                            type="button"
                            role="radio"
                            aria-checked={fPeriod === p}
                            variant={fPeriod === p ? "default" : "outline"}
                            size="sm"
                            onClick={() => {
                              setFPeriod(p);
                              setPoId("");
                            }}
                          >
                            {p}
                          </Button>
                        ))}
                      </div>
                    </div>
                  </div>

                  {/* ⚠️ A DIFFERENT AXIS from period, and labelled as such. */}
                  <div className="mt-4 grid gap-4 sm:grid-cols-3">
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="corr-from">PO date from</Label>
                      <Input
                        id="corr-from"
                        type="date"
                        value={fFrom}
                        onChange={(e) => {
                          setFFrom(e.target.value);
                          setPoId("");
                        }}
                      />
                    </div>
                    <div className="flex flex-col gap-1.5">
                      <Label htmlFor="corr-to">PO date to</Label>
                      <Input
                        id="corr-to"
                        type="date"
                        value={fTo}
                        onChange={(e) => {
                          setFTo(e.target.value);
                          setPoId("");
                        }}
                      />
                    </div>
                    <div className="flex items-end">
                      <p className="text-[11px] text-muted-foreground">
                        The date the order was placed. Separate from period, which groups
                        by order year — a range can sit inside one year or cross several.
                      </p>
                    </div>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="corr-po">Purchase order</Label>
                  <TypeableCombobox
                    id="corr-po"
                    aria-label="Purchase order"
                    value={poId}
                    onChange={setPoId}
                    options={poOptions}
                    maxVisible={40}
                    placeholder="Type a PO id, supplier or category"
                    emptyText="No purchase orders match these filters"
                  />
                  <p className="text-[11px] text-muted-foreground">
                    {visiblePos.length} of {pos.length} orders selectable.
                  </p>
                </div>

                {selectedPo && (
                  <div className="rounded-lg border bg-muted/30 p-3 text-sm">
                    <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
                      <span className="font-mono text-xs">{selectedPo.id}</span>
                      <span className="font-medium">{selectedPo.supplierName}</span>
                      <span className="text-muted-foreground">{selectedPo.category}</span>
                      <span className="text-muted-foreground">{selectedPo.period}</span>
                      <span className="text-muted-foreground">
                        {formatCompactCurrency(selectedPo.totalValueUsd)}
                      </span>
                      <span
                        className="rounded px-1.5 py-0.5 text-xs"
                        style={{
                          color: selectedPo.matchPass ? "var(--success)" : "var(--destructive)",
                          backgroundColor: `color-mix(in srgb, ${
                            selectedPo.matchPass ? "var(--success)" : "var(--destructive)"
                          } 14%, transparent)`,
                        }}
                      >
                        {selectedPo.matchPass ? "Match pass" : "Match fail"}
                      </span>
                    </div>
                  </div>
                )}
              </>
            )}

            {/* ---------------- STEP 2: the mirrored form ---------------- */}
            {chain && (
              <>
                <div className="flex items-center justify-between gap-2">
                  <p className="text-[11px] text-muted-foreground">
                    Fields shown in <span className="font-medium text-foreground">amber</span> can
                    be corrected. Everything else is part of the posted record and cannot be
                    changed here.
                  </p>
                  <Button
                    type="button"
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      setChain(null);
                      setEdits({});
                      setError(null);
                    }}
                  >
                    Change order
                  </Button>
                </div>

                {/* Supplier + method */}
                <div className="grid gap-4 sm:grid-cols-2">
                  <LockedField label="Supplier" value={chain.po.supplierName} onVoidHint={handOverToVoid} />
                  <LockedField
                    label="Buying method"
                    value={METHOD_LABEL[chain.po.buyingMethod] ?? chain.po.buyingMethod}
                  onVoidHint={handOverToVoid}
                  />
                </div>
                {chain.po.frameworkId && (
                  <LockedField label="Framework agreement" value={chain.po.frameworkId} onVoidHint={handOverToVoid} />
                )}
                {chain.po.justification && (
                  <LockedField label="Justification" value={chain.po.justification} onVoidHint={handOverToVoid} />
                )}

                {/* Requisition + logistics */}
                <div className="grid gap-4 sm:grid-cols-3">
                  <LockedField label="Requester" value={chain.po.requester} onVoidHint={handOverToVoid} />
                  <LockedField label="Department" value={chain.po.department} onVoidHint={handOverToVoid} />
                  <LockedField label="Payment terms" value={chain.po.paymentTerms} onVoidHint={handOverToVoid} />
                  <LockedField label="Supplier invoice no." value={chain.po.supplierInvoiceNo} onVoidHint={handOverToVoid} />
                  <LockedField label="Complaints" value={String(chain.po.complaintCount)} onVoidHint={handOverToVoid} />
                </div>

                {/* Dates */}
                <div>
                  <p className="mb-2 text-sm font-medium">Document dates</p>
                  <div className="grid gap-4 sm:grid-cols-3">
                    <LockedField label="Requisition" value={chain.po.dates.pr} onVoidHint={handOverToVoid} />
                    <LockedField label="PO" value={chain.po.dates.po} onVoidHint={handOverToVoid} />
                    <LockedField label="Promised delivery" value={chain.po.dates.promised} onVoidHint={handOverToVoid} />
                    <LockedField label="Invoice" value={chain.po.dates.invoice} onVoidHint={handOverToVoid} />
                    <LockedField label="Payment" value={chain.po.dates.payment} onVoidHint={handOverToVoid} />
                  </div>
                </div>

                {/* Order lines — the only correctable part */}
                <div>
                  <p className="mb-2 text-sm font-medium">
                    Order lines{" "}
                    <span className="font-normal text-muted-foreground">
                      · quantity, billed price and defects can be corrected
                    </span>
                  </p>
                  <div className="flex flex-col gap-3">
                    {chain.lines.map((l) => {
                      const e = edits[l.id] ?? EMPTY_EDIT;
                      return (
                        <div key={l.id} className="rounded-lg border p-3">
                          <div className="mb-2 flex flex-wrap items-baseline gap-x-3">
                            <span className="font-medium">{l.itemName}</span>
                            <span className="font-mono text-[11px] text-muted-foreground">
                              {l.id}
                            </span>
                            {l.correctionCount > 0 && (
                              <span className="text-[11px] text-muted-foreground">
                                {l.correctionCount} existing correction(s)
                              </span>
                            )}
                          </div>
                          <div className="grid gap-3 sm:grid-cols-12">
                            <div className="sm:col-span-3">
                              <LockedField label="Category" value={l.category} onVoidHint={handOverToVoid} />
                            </div>
                            <div className="sm:col-span-2">
                              <LockedField label="Unit" value={l.unit} onVoidHint={handOverToVoid} />
                            </div>
                            <div className="sm:col-span-2">
                              <EditableField
                                id={`corr-qty-${l.id}`}
                                label="Quantity"
                                value={e.quantity}
                                onChange={(v) => setEdit(l.id, { quantity: v })}
                                original={String(l.netQty)}
                              />
                            </div>
                            {/* ⚠️ PO price is NOT correctable — only a void fixes it. */}
                            <div className="sm:col-span-2">
                              <LockedField label="PO price" value={n2(l.unitPriceUsd)} onVoidHint={handOverToVoid} />
                            </div>
                            <div className="sm:col-span-3">
                              <EditableField
                                id={`corr-price-${l.id}`}
                                label="Billed price"
                                value={e.invoicePrice}
                                onChange={(v) => setEdit(l.id, { invoicePrice: v })}
                                original={l.billedPrice !== null ? String(l.billedPrice) : ""}
                              />
                            </div>
                          </div>
                          <div className="mt-3 grid gap-3 border-t pt-3 sm:grid-cols-12">
                            <div className="sm:col-span-3">
                              <LockedField label="Billed qty" value={n2(l.billedQty)} onVoidHint={handOverToVoid} />
                            </div>
                            {/* ⚠️ DELIBERATE DIVERGENCE from record-purchase, which
                                records defects per receipt: a defect correction is per
                                PO LINE, aggregated across every GRN, so it belongs here. */}
                            <div className="sm:col-span-3">
                              <EditableField
                                id={`corr-def-${l.id}`}
                                label="Defects (all receipts)"
                                value={e.defects}
                                onChange={(v) => setEdit(l.id, { defects: v })}
                                original={String(l.defects)}
                              />
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>

                {/* Goods receipts — context only */}
                {chain.receipts.length > 0 && (
                  <div>
                    <p className="mb-2 text-sm font-medium">
                      Goods receipts{" "}
                      <span className="font-normal text-muted-foreground">
                        · {chain.receipts.length}{" "}
                        {chain.receipts.length === 1 ? "delivery" : "deliveries"}, not correctable
                      </span>
                    </p>
                    <div className="flex flex-col gap-3">
                      {chain.receipts.map((r) => (
                        <div key={r.id} className="rounded-lg border p-3">
                          <div className="grid gap-3 sm:grid-cols-3">
                            <LockedField label="Receipt date" value={r.receiptDate} onVoidHint={handOverToVoid} />
                            <LockedField label="Receiving site" value={r.site} onVoidHint={handOverToVoid} />
                            <LockedField label="Received by" value={r.receivedBy} onVoidHint={handOverToVoid} />
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {/* What will be posted */}
                <div className="rounded-lg border bg-muted/30 p-3">
                  <p className="text-sm font-medium">
                    {items.length === 0
                      ? "No changes yet"
                      : `${items.length} correction${items.length === 1 ? "" : "s"} will be posted`}
                  </p>
                  {items.length > 0 && (
                    <ul className="mt-1 list-inside list-disc text-xs text-muted-foreground">
                      {items.map((i, n) => (
                        <li key={n}>{i.label}</li>
                      ))}
                    </ul>
                  )}
                  {items.length === 0 && (
                    <p className="mt-1 text-xs text-muted-foreground">
                      Change a quantity, billed price or defect count above. Each changed
                      field is posted as its own signed entry.
                    </p>
                  )}
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="corr-reason">Reason</Label>
                  <Input
                    id="corr-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why these corrections are being posted"
                  />
                  {reason.trim().length > 0 && !reasonValid && (
                    <p className="text-[11px] text-destructive">
                      A reason must be at least 3 characters.
                    </p>
                  )}
                </div>
              </>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <footer className="flex items-center justify-between gap-2 border-t bg-muted/50 p-4">
            <span className="text-[11px] text-muted-foreground">
              {chain
                ? "Posting appends one signed entry per changed field and recomputes every period."
                : "Posted records are never edited — a correction is appended beside the original."}
            </span>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              {chain ? (
                <Button
                  onClick={submit}
                  disabled={busy || items.length === 0 || !reasonValid}
                >
                  {busy ? "Posting…" : "Post correction"}
                </Button>
              ) : (
                <Button onClick={selectPo} disabled={busy || !poId}>
                  {busy ? "Loading…" : "Select PO"}
                </Button>
              )}
            </div>
          </footer>
        </DialogContent>
      </Dialog>
    </div>
  );
}

/**
 * A field that is part of the posted record. Rendered as a real disabled input so
 * it occupies the same space as its record-purchase counterpart — the mirror only
 * works if the locked fields look like fields, not like text.
 */
function LockedField({
  label,
  value,
  onVoidHint,
}: {
  label: string;
  value: string | null;
  /** Offers the void route on hover — these fields have no correction path at all. */
  onVoidHint?: () => void;
}) {
  return (
    <div className="group relative flex flex-col gap-1.5">
      <Label className="text-muted-foreground">{label}</Label>
      <Input
        value={value ?? "—"}
        disabled
        readOnly
        data-locked="true"
        className="cursor-not-allowed bg-muted/60 text-muted-foreground"
      />
      {onVoidHint && (
        // Absolutely positioned so appearing on hover shifts nothing in the grid.
        <button
          type="button"
          onClick={onVoidHint}
          data-void-hint="true"
          className="absolute left-0 top-full z-20 mt-1 hidden whitespace-nowrap rounded-md border px-2 py-1 text-[11px] shadow-sm group-hover:block group-focus-within:block"
          style={{
            borderColor: "color-mix(in srgb, var(--warning) 45%, transparent)",
            backgroundColor: "color-mix(in srgb, var(--warning) 12%, var(--background))",
            color: "var(--warning)",
          }}
        >
          Want to void this purchase instead?
        </button>
      )}
    </div>
  );
}

/** A correctable field. Amber, because it is the exception on this form. */
function EditableField({
  id,
  label,
  value,
  onChange,
  original,
}: {
  id: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  original: string;
}) {
  const changed = value.trim() !== original.trim() && value.trim() !== "";
  return (
    <div className="flex flex-col gap-1.5">
      <Label htmlFor={id} style={{ color: "var(--warning)" }}>
        {label}
      </Label>
      <Input
        id={id}
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        style={{
          borderColor: "color-mix(in srgb, var(--warning) 55%, transparent)",
          backgroundColor: `color-mix(in srgb, var(--warning) ${changed ? 16 : 7}%, transparent)`,
        }}
      />
      {changed && (
        <p className="text-[11px] text-muted-foreground">was {original}</p>
      )}
    </div>
  );
}
