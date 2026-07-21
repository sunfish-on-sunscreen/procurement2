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
import { CORRECTION_KINDS, CORRECTION_KIND_LABELS, type CorrectionKind } from "@/lib/corrections";

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
};

type Line = {
  id: string;
  itemName: string;
  unit: string;
  orderedQty: number;
  netQty: number;
  unitPriceUsd: number;
  billedQty: number;
  billedPrice: number | null;
  defects: number;
  correctionCount: number;
};

const n2 = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });

/** Short labels for the segmented row; the full sentence is shown below it. */
const KIND_SHORT: Record<CorrectionKind, string> = {
  quantity: "Quantity",
  price: "Price",
  defect: "Defects",
};

const METHOD_LABEL: Record<string, string> = {
  rfq: "RFQ",
  tender: "Tender",
  spot_buy: "Spot buy",
  call_off: "Call-off",
  direct: "Direct award",
};

type MatchFilter = "all" | "fail" | "pass";

/** Blank -> null so an empty field is "not answered yet", not zero. */
function parseNum(s: string): number | null {
  const t = s.trim();
  if (t === "") return null;
  const v = Number(t);
  return Number.isFinite(v) ? v : null;
}

function matchesFilters(
  po: CorrectablePo,
  period: string,
  match: MatchFilter,
  supplierId: string,
): boolean {
  if (period !== "all" && po.period !== period) return false;
  if (match === "fail" && po.matchPass) return false;
  if (match === "pass" && !po.matchPass) return false;
  if (supplierId !== "" && po.supplierId !== supplierId) return false;
  return true;
}

/**
 * Post a correction against a posted transactional record.
 *
 * The original is never edited — the UI deliberately offers no "edit" affordance.
 * A correction is an appended signed entry, so the form asks for a CHANGE (a signed
 * delta or a corrected price) plus a reason, never a replacement value. The
 * Current -> Change -> Resulting read makes that signed convention self-evident
 * and previews the effect before an irreversible, un-deletable entry is written.
 */
export function CorrectionCard({ pos }: { pos: CorrectablePo[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);

  // Picker filters.
  const [fPeriod, setFPeriod] = useState("all");
  const [fMatch, setFMatch] = useState<MatchFilter>("all");
  const [fSupplier, setFSupplier] = useState("");

  const [poId, setPoId] = useState("");
  const [lines, setLines] = useState<Line[] | null>(null);
  const [selected, setSelected] = useState<Line | null>(null);
  const [kind, setKind] = useState<CorrectionKind>("quantity");
  const [qtyDelta, setQtyDelta] = useState("");
  const [price, setPrice] = useState("");
  const [defectDelta, setDefectDelta] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const periods = useMemo(
    () => [...new Set(pos.map((p) => p.period))].sort(),
    [pos],
  );

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
    () => pos.filter((p) => matchesFilters(p, fPeriod, fMatch, fSupplier)),
    [pos, fPeriod, fMatch, fSupplier],
  );

  // Counts shown ON the filter buttons are what that button would actually yield —
  // i.e. the other two filters stay applied — so a count never promises rows the
  // click cannot deliver.
  const countIf = (period: string, match: MatchFilter, supplier: string) =>
    pos.filter((p) => matchesFilters(p, period, match, supplier)).length;

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
  const selectedPo = poId ? poById.get(poId) ?? null : null;

  // Reset on open (render-time transition — avoids set-state-in-effect).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setFPeriod("all");
      setFMatch("all");
      setFSupplier("");
      clearPo();
      setError(null);
      setBusy(false);
    }
  }

  function clearPo() {
    setPoId("");
    setLines(null);
    setSelected(null);
    setKind("quantity");
    setQtyDelta("");
    setPrice("");
    setDefectDelta("");
    setReason("");
  }

  /**
   * Applying a filter that excludes the chosen PO clears the choice — otherwise
   * the combobox would show a blank field while the loaded lines below still
   * belonged to the now-hidden order.
   */
  function applyFilter(next: { period?: string; match?: MatchFilter; supplier?: string }) {
    const period = next.period ?? fPeriod;
    const match = next.match ?? fMatch;
    const supplier = next.supplier ?? fSupplier;
    setFPeriod(period);
    setFMatch(match);
    setFSupplier(supplier);
    const current = poId ? poById.get(poId) : undefined;
    if (current && !matchesFilters(current, period, match, supplier)) clearPo();
  }

  async function selectPo(nextId: string) {
    clearPo();
    setPoId(nextId);
    setError(null);
    if (!nextId) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/corrections/lines?poId=${encodeURIComponent(nextId)}`);
      const data = (await res.json().catch(() => ({}))) as { error?: string; lines?: Line[] };
      if (res.ok && data.lines) {
        setLines(data.lines);
        // 301 of 647 orders have exactly one line — pre-selecting it removes a
        // click that has no alternative.
        if (data.lines.length === 1) setSelected(data.lines[0]);
        if (data.lines.length === 0) setError("That purchase order has no correctable lines.");
      } else {
        setError(data.error ?? "Could not load that purchase order.");
      }
    } catch {
      setError("Could not load that purchase order.");
    } finally {
      setBusy(false);
    }
  }

  const qty = parseNum(qtyDelta);
  const newPrice = parseNum(price);
  const def = parseNum(defectDelta);

  // Mirrors the zod refinements in lib/corrections.ts, so the form cannot submit
  // something the server will reject after a round trip.
  const valueValid =
    kind === "quantity"
      ? qty !== null && qty !== 0
      : kind === "price"
        ? newPrice !== null && newPrice >= 0
        : def !== null && def !== 0 && Number.isInteger(def);

  const reasonTooShort = reason.trim().length > 0 && reason.trim().length < 3;
  const reasonValid = reason.trim().length >= 3;

  /** Net ordered quantity would go below zero — surfaced, not blocked. */
  const negativeResult =
    kind === "quantity" && qty !== null && selected !== null && selected.netQty + qty < 0;

  /**
   * The same string the server builds in postCorrection, computed client-side so
   * the effect is visible BEFORE the write. Raw number stringification (not
   * locale-formatted) so it lines up with the server's netEffect literally.
   *
   * ⚠️ For a price correction the server quotes the ORIGINAL invoice line's price
   * and quantity; this uses the value-weighted effective billed price and net
   * billed quantity. They coincide until a price correction already exists on the
   * line, at which point the effective figures are the ones the view compares.
   */
  const netEffect = useMemo(() => {
    if (!selected || !valueValid) return null;
    if (kind === "quantity" && qty !== null) {
      const sign = qty > 0 ? "+" : "";
      return `quantity ${sign}${qty} @ ${selected.unitPriceUsd} = ${(qty * selected.unitPriceUsd).toFixed(2)} USD`;
    }
    if (kind === "price" && newPrice !== null) {
      const from = selected.billedPrice ?? selected.unitPriceUsd;
      return `billed price ${from} → ${newPrice} on ${selected.billedQty} units`;
    }
    if (kind === "defect" && def !== null) {
      return `defects ${def > 0 ? "+" : ""}${def}`;
    }
    return null;
  }, [selected, kind, qty, newPrice, def, valueValid]);

  /** USD the correction moves — shown alongside, since only the quantity string carries it. */
  const valueMoved = useMemo(() => {
    if (!selected || !valueValid) return null;
    if (kind === "quantity" && qty !== null) return qty * selected.unitPriceUsd;
    if (kind === "price" && newPrice !== null) {
      const from = selected.billedPrice ?? selected.unitPriceUsd;
      return selected.billedQty * (newPrice - from);
    }
    return null;
  }, [selected, kind, qty, newPrice, valueValid]);

  async function submit() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = { po_line_id: selected.id, kind, reason };
      if (kind === "quantity") payload.quantity_delta = qty;
      if (kind === "price") payload.corrected_unit_price = newPrice;
      if (kind === "defect") payload.defect_delta = def;

      const res = await fetch("/api/corrections", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        success?: boolean;
        correction?: { netEffect: string };
      };
      if (res.ok && data.correction) {
        toast.success(`Correction posted — ${data.correction.netEffect}.`);
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

  /** Rich two-line option row — the collapsed field can only show plain text. */
  const renderPoOption = (o: ComboOption) => {
    const p = poById.get(o.value);
    if (!p) return o.label;
    return (
      <div className="flex min-w-0 flex-col gap-0.5">
        <div className="flex items-baseline gap-2">
          <span className="font-mono text-xs">{p.id}</span>
          <span className="truncate text-sm">{p.supplierName}</span>
        </div>
        <div className="flex flex-wrap items-center gap-1.5 text-[11px] text-muted-foreground">
          <span>{p.category}</span>
          <span>·</span>
          <span>{p.period}</span>
          <span>·</span>
          <span>{formatCompactCurrency(p.totalValueUsd)}</span>
          <span
            className="rounded px-1.5 py-0.5"
            style={{
              color: p.matchPass ? "var(--success)" : "var(--destructive)",
              backgroundColor: `color-mix(in srgb, ${
                p.matchPass ? "var(--success)" : "var(--destructive)"
              } 14%, transparent)`,
            }}
          >
            {p.matchPass ? "Match pass" : "Match fail"}
          </span>
          {p.defectCount > 0 && (
            <span
              className="rounded px-1.5 py-0.5"
              style={{
                color: "var(--warning)",
                backgroundColor: "color-mix(in srgb, var(--warning) 14%, transparent)",
              }}
            >
              {p.defectCount} defect{p.defectCount === 1 ? "" : "s"}
            </span>
          )}
        </div>
      </div>
    );
  };

  const failingCount = countIf(fPeriod, "fail", fSupplier);

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
                Post a correction
              </DialogTitle>
              <p className="truncate text-xs text-muted-foreground">
                The original entry stays exactly as posted.
              </p>
            </div>
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" aria-label="Close" onClick={() => setOpen(false)}>
              <X className="h-4 w-4" />
            </Button>
          </header>

          <div className="flex flex-col gap-5 p-4">
            {/* Find the purchase order */}
            <div>
              <p className="mb-2 text-sm font-medium">Find the purchase order</p>
              <div className="grid gap-4 sm:grid-cols-3">
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="corr-period">Period</Label>
                  <div className="flex flex-wrap gap-1.5" id="corr-period" role="radiogroup">
                    <Button
                      type="button"
                      role="radio"
                      aria-checked={fPeriod === "all"}
                      variant={fPeriod === "all" ? "default" : "outline"}
                      size="sm"
                      onClick={() => applyFilter({ period: "all" })}
                    >
                      All {countIf("all", fMatch, fSupplier)}
                    </Button>
                    {periods.map((p) => (
                      <Button
                        key={p}
                        type="button"
                        role="radio"
                        aria-checked={fPeriod === p}
                        variant={fPeriod === p ? "default" : "outline"}
                        size="sm"
                        onClick={() => applyFilter({ period: p })}
                      >
                        {p} {countIf(p, fMatch, fSupplier)}
                      </Button>
                    ))}
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="corr-match">Three-way match</Label>
                  <div className="flex flex-wrap gap-1.5" id="corr-match" role="radiogroup">
                    <Button
                      type="button"
                      role="radio"
                      aria-checked={fMatch === "all"}
                      variant={fMatch === "all" ? "default" : "outline"}
                      size="sm"
                      onClick={() => applyFilter({ match: "all" })}
                    >
                      All {countIf(fPeriod, "all", fSupplier)}
                    </Button>
                    {/* The usual reason to open this dialog — tinted so it reads as
                        the primary entry point without being the default. */}
                    <Button
                      type="button"
                      role="radio"
                      aria-checked={fMatch === "fail"}
                      variant={fMatch === "fail" ? "default" : "outline"}
                      size="sm"
                      style={
                        fMatch === "fail"
                          ? undefined
                          : {
                              color: "var(--destructive)",
                              borderColor: "color-mix(in srgb, var(--destructive) 40%, transparent)",
                              backgroundColor: "color-mix(in srgb, var(--destructive) 8%, transparent)",
                            }
                      }
                      onClick={() => applyFilter({ match: "fail" })}
                    >
                      Failing {failingCount}
                    </Button>
                    <Button
                      type="button"
                      role="radio"
                      aria-checked={fMatch === "pass"}
                      variant={fMatch === "pass" ? "default" : "outline"}
                      size="sm"
                      onClick={() => applyFilter({ match: "pass" })}
                    >
                      Passing {countIf(fPeriod, "pass", fSupplier)}
                    </Button>
                  </div>
                </div>

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="corr-supplier">Supplier</Label>
                  <TypeableCombobox
                    id="corr-supplier"
                    aria-label="Supplier"
                    value={fSupplier}
                    onChange={(v) => applyFilter({ supplier: v })}
                    options={supplierOptions}
                    placeholder="All suppliers"
                  />
                </div>
              </div>

              <div className="mt-4 flex flex-col gap-1.5">
                <Label htmlFor="corr-po">Purchase order</Label>
                <TypeableCombobox
                  id="corr-po"
                  aria-label="Purchase order"
                  value={poId}
                  onChange={selectPo}
                  options={poOptions}
                  renderOption={renderPoOption}
                  maxVisible={40}
                  placeholder="Type a PO id, supplier or category"
                  emptyText="No purchase orders match these filters"
                />
                <p className="text-[11px] text-muted-foreground">
                  {visiblePos.length} of {pos.length} orders selectable.
                  {failingCount > 0 &&
                    ` ${failingCount} fail the three-way match — the usual reason to post a correction.`}
                </p>
              </div>
            </div>

            {/* Chosen order — context the collapsed combobox field cannot show */}
            {selectedPo && (
              <div className="rounded-lg border bg-muted/30 p-3">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm">
                  <span className="font-mono text-xs">{selectedPo.id}</span>
                  <span className="font-medium">{selectedPo.supplierName}</span>
                  <span className="text-muted-foreground">{selectedPo.category}</span>
                  <span className="text-muted-foreground">{selectedPo.period}</span>
                  <span className="text-muted-foreground">
                    {formatCompactCurrency(selectedPo.totalValueUsd)}
                  </span>
                  <span className="text-muted-foreground">
                    {METHOD_LABEL[selectedPo.buyingMethod] ?? selectedPo.buyingMethod}
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

            {/* Line picker */}
            {lines && lines.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-medium">
                  Line to correct{" "}
                  <span className="font-normal text-muted-foreground">
                    · {lines.length} {lines.length === 1 ? "line" : "lines"}
                    {lines.length === 1 ? " (selected)" : ""}
                  </span>
                </p>
                <div className="grid grid-cols-12 gap-2 border-b px-2.5 pb-1.5 text-[11px] font-medium text-muted-foreground">
                  <div className="col-span-3">Item</div>
                  <div className="col-span-2 text-right">Ordered</div>
                  <div className="col-span-2 text-right">Net</div>
                  <div className="col-span-2 text-right">PO price</div>
                  <div className="col-span-2 text-right">Billed</div>
                  <div className="col-span-1 text-right">Defects</div>
                </div>
                <div className="flex flex-col gap-1.5 pt-1.5">
                  {lines.map((l) => {
                    const priceDiffers = l.billedPrice !== null && l.billedPrice !== l.unitPriceUsd;
                    return (
                      <button
                        key={l.id}
                        type="button"
                        role="radio"
                        aria-checked={selected?.id === l.id}
                        onClick={() => setSelected(l)}
                        className={`grid grid-cols-12 items-center gap-2 rounded-lg border p-2.5 text-left text-sm transition-colors ${
                          selected?.id === l.id ? "border-primary bg-muted/50" : "hover:bg-muted/30"
                        }`}
                      >
                        <div className="col-span-3 min-w-0">
                          <div className="truncate font-medium">{l.itemName}</div>
                          <div className="truncate font-mono text-[11px] text-muted-foreground">
                            {l.id}
                            {l.correctionCount > 0 && ` · ${l.correctionCount} correction(s)`}
                          </div>
                        </div>
                        <div className="col-span-2 text-right tabular-nums">
                          {n2(l.orderedQty)}{" "}
                          <span className="text-[11px] text-muted-foreground">{l.unit}</span>
                        </div>
                        <div
                          className={`col-span-2 text-right tabular-nums ${
                            l.netQty !== l.orderedQty ? "text-[var(--warning)]" : ""
                          }`}
                        >
                          {n2(l.netQty)}
                        </div>
                        <div className="col-span-2 text-right tabular-nums">{n2(l.unitPriceUsd)}</div>
                        <div
                          className={`col-span-2 text-right tabular-nums ${
                            priceDiffers ? "text-[var(--warning)]" : ""
                          }`}
                        >
                          {l.billedPrice !== null ? n2(l.billedPrice) : "—"}
                        </div>
                        <div
                          className={`col-span-1 text-right tabular-nums ${
                            l.defects > 0 ? "text-[var(--warning)]" : "text-muted-foreground"
                          }`}
                        >
                          {l.defects}
                        </div>
                      </button>
                    );
                  })}
                </div>
              </div>
            )}

            {/* The correction itself */}
            {selected && (
              <div>
                <p className="mb-2 text-sm font-medium">Correction</p>
                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="corr-kind">Type</Label>
                  <div className="flex flex-wrap gap-1.5" id="corr-kind" role="radiogroup">
                    {CORRECTION_KINDS.map((k) => (
                      <Button
                        key={k}
                        type="button"
                        role="radio"
                        aria-checked={kind === k}
                        variant={kind === k ? "default" : "outline"}
                        size="sm"
                        onClick={() => setKind(k)}
                      >
                        {KIND_SHORT[k]}
                      </Button>
                    ))}
                  </div>
                  <p className="text-[11px] text-muted-foreground">{CORRECTION_KIND_LABELS[kind]}</p>
                </div>

                {/* Current -> Change -> Resulting */}
                <div className="mt-4 grid items-start gap-4 sm:grid-cols-3">
                  <div className="flex flex-col gap-1.5">
                    <Label>Current</Label>
                    <div className="flex h-9 items-center rounded-md border border-input bg-muted/40 px-3 text-sm tabular-nums">
                      {kind === "quantity" && `${n2(selected.netQty)} ${selected.unit}`}
                      {kind === "price" &&
                        (selected.billedPrice !== null ? n2(selected.billedPrice) : "—")}
                      {kind === "defect" && selected.defects}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {kind === "quantity" && "Net ordered quantity today."}
                      {kind === "price" && "Effective billed unit price today."}
                      {kind === "defect" && "Defects recorded on this line."}
                    </p>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="corr-value">
                      {kind === "quantity" && "Change (signed)"}
                      {kind === "price" && "Corrected unit price"}
                      {kind === "defect" && "Change (signed)"}
                    </Label>
                    {kind === "quantity" && (
                      <Input
                        id="corr-value"
                        type="number"
                        value={qtyDelta}
                        onChange={(e) => setQtyDelta(e.target.value)}
                        placeholder="e.g. -100"
                      />
                    )}
                    {kind === "price" && (
                      <Input
                        id="corr-value"
                        type="number"
                        min={0}
                        step="0.01"
                        value={price}
                        onChange={(e) => setPrice(e.target.value)}
                        placeholder={n2(selected.unitPriceUsd)}
                      />
                    )}
                    {kind === "defect" && (
                      <Input
                        id="corr-value"
                        type="number"
                        step={1}
                        value={defectDelta}
                        onChange={(e) => setDefectDelta(e.target.value)}
                        placeholder="e.g. -2"
                      />
                    )}
                    <p className="text-[11px] text-muted-foreground">
                      {kind === "quantity" &&
                        "Enter the CHANGE, not the new total. Negative returns or cancels units; positive adds."}
                      {kind === "price" &&
                        "Enter the price that should have been billed. The original is credited and re-billed at this price."}
                      {kind === "defect" &&
                        "Enter the CHANGE, not the new total. Negative removes defects; positive adds."}
                    </p>
                  </div>

                  <div className="flex flex-col gap-1.5">
                    <Label>Resulting</Label>
                    <div className="flex h-9 items-center rounded-md border border-input bg-muted/40 px-3 text-sm tabular-nums">
                      {!valueValid && <span className="text-muted-foreground">—</span>}
                      {valueValid && kind === "quantity" && qty !== null && (
                        <span className={negativeResult ? "text-destructive" : undefined}>
                          {n2(selected.netQty + qty)} {selected.unit}
                        </span>
                      )}
                      {valueValid && kind === "price" && newPrice !== null && n2(newPrice)}
                      {valueValid && kind === "defect" && def !== null && selected.defects + def}
                    </div>
                    <p className="text-[11px] text-muted-foreground">
                      {valueMoved !== null
                        ? `${valueMoved >= 0 ? "+" : "−"}${formatCompactCurrency(Math.abs(valueMoved))} on this order`
                        : "After the correction is posted."}
                    </p>
                  </div>
                </div>

                {negativeResult && (
                  <p className="mt-1.5 text-[11px] text-destructive">
                    That change takes the net ordered quantity below zero. Check the sign —
                    a negative number returns units.
                  </p>
                )}

                <div className="mt-4 flex flex-col gap-1.5">
                  <Label htmlFor="corr-reason">Reason</Label>
                  <Input
                    id="corr-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why this correction is being posted"
                  />
                  {reasonTooShort && (
                    <p className="text-[11px] text-destructive">
                      A reason must be at least 3 characters.
                    </p>
                  )}
                </div>
              </div>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <footer className="flex items-center justify-between gap-2 border-t bg-muted/50 p-4">
            <div className="min-w-0 text-sm text-muted-foreground">
              {netEffect ? (
                <>
                  <span className="font-medium text-foreground">{netEffect}</span>
                  <span className="block text-[11px]">
                    Posting appends this entry and recomputes every period — a few seconds.
                  </span>
                </>
              ) : (
                <span className="text-[11px]">
                  Posting appends a signed entry and recomputes every period — a few seconds.
                </span>
              )}
            </div>
            <div className="flex shrink-0 gap-2">
              <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
                Cancel
              </Button>
              <Button onClick={submit} disabled={busy || !selected || !valueValid || !reasonValid}>
                {busy ? "Posting…" : "Post correction"}
              </Button>
            </div>
          </footer>
        </DialogContent>
      </Dialog>
    </div>
  );
}
