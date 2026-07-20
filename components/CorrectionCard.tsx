"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Scale, X } from "lucide-react";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { panelElevation } from "@/lib/utils";
import { CORRECTION_KINDS, CORRECTION_KIND_LABELS, type CorrectionKind } from "@/lib/corrections";

type Line = {
  id: string;
  itemName: string;
  unit: string;
  orderedQty: number;
  netQty: number;
  unitPriceUsd: number;
  billedPrice: number | null;
  defects: number;
  correctionCount: number;
};

const n2 = (v: number) => v.toLocaleString(undefined, { maximumFractionDigits: 2 });

/**
 * Post a correction against a posted transactional record.
 *
 * The original is never edited — the UI deliberately offers no "edit" affordance.
 * A correction is an appended signed entry, so the form asks for a CHANGE (a signed
 * delta or a corrected price) plus a reason, never a replacement value.
 */
export function CorrectionCard() {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [poId, setPoId] = useState("");
  const [lines, setLines] = useState<Line[] | null>(null);
  const [poLabel, setPoLabel] = useState("");
  const [selected, setSelected] = useState<Line | null>(null);
  const [kind, setKind] = useState<CorrectionKind>("quantity");
  const [qtyDelta, setQtyDelta] = useState("");
  const [price, setPrice] = useState("");
  const [defectDelta, setDefectDelta] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setPoId("");
      setLines(null);
      setPoLabel("");
      setSelected(null);
      setKind("quantity");
      setQtyDelta("");
      setPrice("");
      setDefectDelta("");
      setReason("");
      setError(null);
      setBusy(false);
    }
  }

  async function lookup() {
    setError(null);
    setLines(null);
    setSelected(null);
    if (!poId.trim()) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/corrections/lines?poId=${encodeURIComponent(poId.trim())}`);
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        po?: { id: string; supplierName: string };
        lines?: Line[];
      };
      if (res.ok && data.lines) {
        setLines(data.lines);
        setPoLabel(`${data.po?.id} · ${data.po?.supplierName}`);
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

  async function submit() {
    if (!selected) return;
    setBusy(true);
    setError(null);
    try {
      const payload: Record<string, unknown> = {
        po_line_id: selected.id,
        kind,
        reason,
      };
      if (kind === "quantity") payload.quantity_delta = Number(qtyDelta);
      if (kind === "price") payload.corrected_unit_price = Number(price);
      if (kind === "defect") payload.defect_delta = Number(defectDelta);

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
      </p>

      <Dialog open={open} onOpenChange={(o) => !busy && setOpen(o)}>
        <DialogContent
          showCloseButton={false}
          aria-label="Post a correction"
          className={`flex max-h-[85vh] w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[640px] ${panelElevation}`}
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

          <div className="flex flex-col gap-4 p-4">
            {/* Find the PO */}
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="corr-po">Purchase order</Label>
              <div className="flex gap-2">
                <Input
                  id="corr-po"
                  value={poId}
                  onChange={(e) => setPoId(e.target.value)}
                  placeholder="e.g. PO-2024-00001"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") lookup();
                  }}
                />
                <Button type="button" variant="outline" onClick={lookup} disabled={busy}>
                  Find
                </Button>
              </div>
              {poLabel && <p className="text-xs text-muted-foreground">{poLabel}</p>}
            </div>

            {/* Pick the line */}
            {lines && lines.length > 0 && (
              <div className="flex flex-col gap-1.5">
                <Label>Line to correct</Label>
                <div className="flex flex-col gap-1.5">
                  {lines.map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => setSelected(l)}
                      className={`rounded-lg border p-2.5 text-left text-sm transition-colors ${
                        selected?.id === l.id ? "border-primary bg-muted/50" : "hover:bg-muted/30"
                      }`}
                    >
                      <div className="font-medium">{l.itemName}</div>
                      <div className="text-xs text-muted-foreground">
                        {l.id} · net {n2(l.netQty)} {l.unit}
                        {l.netQty !== l.orderedQty && ` (ordered ${n2(l.orderedQty)})`} · PO price{" "}
                        {n2(l.unitPriceUsd)}
                        {l.billedPrice !== null && l.billedPrice !== l.unitPriceUsd && (
                          <span className="text-[var(--warning)]"> · billed {n2(l.billedPrice)}</span>
                        )}
                        {l.defects > 0 && ` · ${l.defects} defects`}
                        {l.correctionCount > 0 && ` · ${l.correctionCount} correction(s)`}
                      </div>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {selected && (
              <>
                <div className="flex flex-col gap-1.5">
                  <Label>Correction type</Label>
                  <div className="flex flex-col gap-1.5">
                    {CORRECTION_KINDS.map((k) => (
                      <Button
                        key={k}
                        type="button"
                        role="radio"
                        aria-checked={kind === k}
                        variant={kind === k ? "default" : "outline"}
                        size="sm"
                        className="justify-start"
                        onClick={() => setKind(k)}
                      >
                        {CORRECTION_KIND_LABELS[k]}
                      </Button>
                    ))}
                  </div>
                </div>

                {kind === "quantity" && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="corr-qty">Quantity change (signed)</Label>
                    <Input
                      id="corr-qty"
                      type="number"
                      value={qtyDelta}
                      onChange={(e) => setQtyDelta(e.target.value)}
                      placeholder="e.g. -100 to return 100 units"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Negative returns or cancels units. Current net: {n2(selected.netQty)}{" "}
                      {selected.unit}.
                    </p>
                  </div>
                )}
                {kind === "price" && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="corr-price">Corrected unit price (USD)</Label>
                    <Input
                      id="corr-price"
                      type="number"
                      step="0.01"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      placeholder={`PO price ${n2(selected.unitPriceUsd)}`}
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Credits the original invoice line and re-bills at this price. Currently
                      billed at {selected.billedPrice !== null ? n2(selected.billedPrice) : "—"}.
                    </p>
                  </div>
                )}
                {kind === "defect" && (
                  <div className="flex flex-col gap-1.5">
                    <Label htmlFor="corr-def">Defect change (signed)</Label>
                    <Input
                      id="corr-def"
                      type="number"
                      value={defectDelta}
                      onChange={(e) => setDefectDelta(e.target.value)}
                      placeholder="e.g. +3 or -2"
                    />
                    <p className="text-[11px] text-muted-foreground">
                      Currently {selected.defects} defect(s) recorded on this line.
                    </p>
                  </div>
                )}

                <div className="flex flex-col gap-1.5">
                  <Label htmlFor="corr-reason">Reason</Label>
                  <Input
                    id="corr-reason"
                    value={reason}
                    onChange={(e) => setReason(e.target.value)}
                    placeholder="Why this correction is being posted"
                  />
                </div>
              </>
            )}

            {error && <p className="text-sm text-destructive">{error}</p>}
          </div>

          <footer className="flex items-center justify-end gap-2 border-t bg-muted/50 p-4">
            <Button variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
            <Button onClick={submit} disabled={busy || !selected || !reason.trim()}>
              {busy ? "Posting…" : "Post correction"}
            </Button>
          </footer>
        </DialogContent>
      </Dialog>
    </div>
  );
}
