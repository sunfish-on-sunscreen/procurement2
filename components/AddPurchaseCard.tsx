"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TypeableCombobox, type ComboOption } from "@/components/ui/typeable-combobox";
import { panelElevation } from "@/lib/utils";

export type SupplierPick = { id: string; name: string };

const DATES = [
  ["pr", "PR date"],
  ["po", "PO date"],
  ["delivery", "Delivery date"],
  ["invoice", "Invoice date"],
  ["payment", "Payment date"],
] as const;
type DateKey = (typeof DATES)[number][0];

export function AddPurchaseCard({
  open,
  onOpenChange,
  nextId,
  suppliers,
  units,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Server-computed preview of the next PO id (the server re-assigns on save). */
  nextId: string;
  /** Existing suppliers for the existing-only picker (orphan-proof). */
  suppliers: SupplierPick[];
  /** Existing units for the creatable unit combobox. */
  units: string[];
}) {
  const router = useRouter();
  const supplierOptions = useMemo<ComboOption[]>(
    () => suppliers.map((s) => ({ value: s.id, label: s.name, keywords: s.id })),
    [suppliers],
  );
  const unitOptions = useMemo<ComboOption[]>(
    () => units.map((u) => ({ value: u, label: u })),
    [units],
  );

  const [supplierId, setSupplierId] = useState("");
  const [itemName, setItemName] = useState("");
  const [unit, setUnit] = useState("");
  const [quantity, setQuantity] = useState("");
  const [unitPrice, setUnitPrice] = useState("");
  const [defectCount, setDefectCount] = useState("0");
  const [complaintCount, setComplaintCount] = useState("0");
  const [onTime, setOnTime] = useState(true);
  const [threeWay, setThreeWay] = useState(true);
  const [dates, setDates] = useState<Record<DateKey, string>>({
    pr: "", po: "", delivery: "", invoice: "", payment: "",
  });
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset the form each time the card opens (render-time transition — avoids the
  // lint-banned set-state-in-effect).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setSupplierId("");
      setItemName("");
      setUnit("");
      setQuantity("");
      setUnitPrice("");
      setDefectCount("0");
      setComplaintCount("0");
      setOnTime(true);
      setThreeWay(true);
      setDates({ pr: "", po: "", delivery: "", invoice: "", payment: "" });
      setError(null);
      setSaving(false);
    }
  }

  async function handleSave() {
    setError(null);
    const qty = Number(quantity);
    const price = Number(unitPrice);
    const defect = Number(defectCount);
    const complaint = Number(complaintCount);
    if (!supplierId) return setError("Pick an existing supplier.");
    if (!itemName.trim()) return setError("Item name is required.");
    if (!unit.trim()) return setError("Unit is required.");
    if (!Number.isFinite(qty) || qty <= 0) return setError("Quantity must be greater than 0.");
    if (!Number.isFinite(price) || price < 0) return setError("Unit price must be 0 or more.");
    if (!Number.isInteger(defect) || defect < 0) return setError("Defect count must be a whole number ≥ 0.");
    if (!Number.isInteger(complaint) || complaint < 0) return setError("Complaint count must be a whole number ≥ 0.");
    if (DATES.some(([k]) => !dates[k])) return setError("All five dates are required.");

    setSaving(true);
    try {
      const res = await fetch("/api/purchases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier_id: supplierId,
          item_name: itemName.trim(),
          unit: unit.trim(),
          quantity: qty,
          unit_price_usd: price,
          defect_count: defect,
          complaint_count: complaint,
          on_time_delivery: onTime,
          three_way_match_pass: threeWay,
          pr_date: dates.pr,
          po_date: dates.po,
          delivery_date: dates.delivery,
          invoice_date: dates.invoice,
          payment_date: dates.payment,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        purchase?: { poId: string; totalValueUsd: number };
      };
      if (res.ok && body.purchase) {
        toast.success(
          `Added ${body.purchase.poId} · $${body.purchase.totalValueUsd.toLocaleString()}.`,
        );
        onOpenChange(false);
        router.refresh();
      } else {
        setError(body.error || "Could not create the purchase.");
      }
    } catch {
      setError("Could not create the purchase.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-label="Add a purchase"
        className={`flex max-h-[85vh] w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[520px] ${panelElevation}`}
      >
        <header className="flex items-start justify-between gap-2 border-b p-4">
          <div className="min-w-0">
            <DialogTitle className="truncate font-heading text-base font-medium leading-snug">
              Add a purchase
            </DialogTitle>
            <p className="truncate text-xs text-muted-foreground">
              Create a single purchase order — the ID is assigned automatically.
            </p>
          </div>
          <Button
            variant="ghost"
            size="icon"
            className="h-7 w-7 shrink-0"
            aria-label="Close"
            onClick={() => onOpenChange(false)}
          >
            <X className="h-4 w-4" />
          </Button>
        </header>

        <div className="flex flex-col gap-4 p-4">
          {/* PO ID — greyed, read-only preview. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-po-id">PO ID</Label>
            <Input
              id="add-po-id"
              value={nextId}
              readOnly
              disabled
              tabIndex={-1}
              className="font-mono text-muted-foreground"
            />
          </div>

          {/* Supplier — existing-only picker. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-po-supplier">Supplier</Label>
            <TypeableCombobox
              id="add-po-supplier"
              aria-label="Supplier"
              value={supplierId}
              onChange={setSupplierId}
              options={supplierOptions}
              placeholder="Search suppliers by name or ID"
              emptyText="No matching supplier"
              renderOption={(o) => (
                <span className="flex w-full items-center justify-between gap-2">
                  <span className="truncate">{o.label}</span>
                  <span className="shrink-0 font-mono text-xs text-muted-foreground">{o.value}</span>
                </span>
              )}
            />
          </div>

          {/* Item + unit. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-po-item">Item name</Label>
            <Input
              id="add-po-item"
              value={itemName}
              onChange={(e) => setItemName(e.target.value)}
              placeholder="e.g. Caterpillar D11T bulldozer"
              autoComplete="off"
            />
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="add-po-unit">Unit</Label>
              <TypeableCombobox
                id="add-po-unit"
                aria-label="Unit"
                value={unit}
                onChange={setUnit}
                options={unitOptions}
                creatable
                placeholder="unit"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="add-po-qty">Quantity</Label>
              <Input
                id="add-po-qty"
                type="number"
                min="0"
                step="any"
                value={quantity}
                onChange={(e) => setQuantity(e.target.value)}
                placeholder="0"
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <Label htmlFor="add-po-price">Unit price (USD)</Label>
              <Input
                id="add-po-price"
                type="number"
                min="0"
                step="any"
                value={unitPrice}
                onChange={(e) => setUnitPrice(e.target.value)}
                placeholder="0.00"
              />
            </div>
          </div>

          {/* Quality section. */}
          <div className="flex flex-col gap-3 border-t pt-4">
            <h4 className="text-sm font-medium text-muted-foreground">Quality</h4>
            <div className="grid grid-cols-2 gap-3">
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="add-po-defect">Defect count</Label>
                <Input
                  id="add-po-defect"
                  type="number"
                  min="0"
                  step="1"
                  value={defectCount}
                  onChange={(e) => setDefectCount(e.target.value)}
                />
              </div>
              <div className="flex flex-col gap-1.5">
                <Label htmlFor="add-po-complaint">Complaint count</Label>
                <Input
                  id="add-po-complaint"
                  type="number"
                  min="0"
                  step="1"
                  value={complaintCount}
                  onChange={(e) => setComplaintCount(e.target.value)}
                />
              </div>
            </div>
            <div className="flex flex-wrap gap-4">
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input accent-primary"
                  checked={onTime}
                  onChange={(e) => setOnTime(e.target.checked)}
                />
                On-time delivery
              </label>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  className="h-4 w-4 rounded border-input accent-primary"
                  checked={threeWay}
                  onChange={(e) => setThreeWay(e.target.checked)}
                />
                Three-way match passed
              </label>
            </div>
          </div>

          {/* Timeline section — 5 dates. */}
          <div className="flex flex-col gap-3 border-t pt-4">
            <h4 className="text-sm font-medium text-muted-foreground">Timeline</h4>
            <div className="grid grid-cols-2 gap-3">
              {DATES.map(([key, label]) => (
                <div key={key} className="flex flex-col gap-1.5">
                  <Label htmlFor={`add-po-${key}`}>{label}</Label>
                  <Input
                    id={`add-po-${key}`}
                    type="date"
                    value={dates[key]}
                    onChange={(e) => setDates((d) => ({ ...d, [key]: e.target.value }))}
                  />
                </div>
              ))}
            </div>
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <footer className="flex items-center justify-between gap-2 border-t bg-muted/50 p-4">
          <span className="text-xs text-muted-foreground">
            Total &amp; cycle days computed on save.
          </span>
          <div className="flex gap-2">
            <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={handleSave} disabled={saving}>
              {saving ? "Saving…" : "Save purchase"}
            </Button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
