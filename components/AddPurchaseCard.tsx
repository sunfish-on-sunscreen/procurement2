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

/** A purchase's editable fields (dates as YYYY-MM-DD) — pre-fills the card in
 *  edit mode. */
export type EditPurchase = {
  poId: string;
  supplierId: string;
  itemName: string;
  unit: string;
  quantity: number;
  unitPriceUsd: number;
  defectCount: number;
  complaintCount: number;
  onTimeDelivery: boolean;
  threeWayMatchPass: boolean;
  prDate: string;
  poDate: string;
  deliveryDate: string;
  invoiceDate: string;
  paymentDate: string;
};

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
  supplierItems,
  editPurchase = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Server-computed preview of the next PO id (the server re-assigns on save). */
  nextId: string;
  /** Existing suppliers for the existing-only picker (orphan-proof). */
  suppliers: SupplierPick[];
  /** Existing units for the creatable unit combobox. */
  units: string[];
  /** supplierExternalId -> that supplier's distinct existing item names (scopes
   *  the Item combobox suggestions). */
  supplierItems: Record<string, string[]>;
  /** When set, the card is in EDIT mode (pre-filled; PO id locked; PATCH on save). */
  editPurchase?: EditPurchase | null;
}) {
  const router = useRouter();
  const isEdit = editPurchase != null;
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

  // Item suggestions scoped to the currently-selected supplier's existing items.
  const itemOptions = useMemo<ComboOption[]>(
    () => (supplierItems[supplierId] ?? []).map((i) => ({ value: i, label: i })),
    [supplierItems, supplierId],
  );

  // Reset/prefill the form when the card opens OR the edit target changes
  // (render-time transition — avoids the lint-banned set-state-in-effect).
  const editId = editPurchase?.poId ?? null;
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevEditId, setPrevEditId] = useState(editId);
  if (open !== prevOpen || editId !== prevEditId) {
    setPrevOpen(open);
    setPrevEditId(editId);
    if (open) {
      setSupplierId(editPurchase?.supplierId ?? "");
      setItemName(editPurchase?.itemName ?? "");
      setUnit(editPurchase?.unit ?? "");
      setQuantity(editPurchase ? String(editPurchase.quantity) : "");
      setUnitPrice(editPurchase ? String(editPurchase.unitPriceUsd) : "");
      setDefectCount(editPurchase ? String(editPurchase.defectCount) : "0");
      setComplaintCount(editPurchase ? String(editPurchase.complaintCount) : "0");
      setOnTime(editPurchase?.onTimeDelivery ?? true);
      setThreeWay(editPurchase?.threeWayMatchPass ?? true);
      setDates(
        editPurchase
          ? {
              pr: editPurchase.prDate,
              po: editPurchase.poDate,
              delivery: editPurchase.deliveryDate,
              invoice: editPurchase.invoiceDate,
              payment: editPurchase.paymentDate,
            }
          : { pr: "", po: "", delivery: "", invoice: "", payment: "" },
      );
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
      const res = await fetch(
        isEdit ? `/api/purchases/${editPurchase!.poId}` : "/api/purchases",
        {
          method: isEdit ? "PATCH" : "POST",
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
        },
      );
      const body = (await res.json().catch(() => ({}))) as {
        error?: string;
        purchase?: { poId: string; totalValueUsd: number };
        recomputeWarning?: string | null;
      };
      if (res.ok && body.purchase) {
        const usd = `$${body.purchase.totalValueUsd.toLocaleString("en-US")}`;
        toast.success(`${isEdit ? "Updated" : "Added"} ${body.purchase.poId} · ${usd}.`);
        if (body.recomputeWarning) toast.warning(body.recomputeWarning);
        onOpenChange(false);
        router.refresh();
      } else {
        setError(body.error || `Could not ${isEdit ? "update" : "create"} the purchase.`);
      }
    } catch {
      setError(`Could not ${isEdit ? "update" : "create"} the purchase.`);
    } finally {
      setSaving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-label={isEdit ? "Edit purchase" : "Add a purchase"}
        className={`flex max-h-[85vh] w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[520px] ${panelElevation}`}
      >
        <header className="flex items-start justify-between gap-2 border-b p-4">
          <div className="min-w-0">
            <DialogTitle className="truncate font-heading text-base font-medium leading-snug">
              {isEdit ? "Edit purchase" : "Add a purchase"}
            </DialogTitle>
            <p className="truncate text-xs text-muted-foreground">
              {isEdit
                ? "Update this purchase — total & cycle days are recomputed on save."
                : "Create a single purchase order — the ID is assigned automatically."}
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
              value={isEdit ? editPurchase!.poId : nextId}
              readOnly
              disabled
              tabIndex={-1}
              className="font-mono text-muted-foreground"
            />
            {isEdit && (
              <p className="text-[11px] text-muted-foreground">
                Locked — the PO id is its identity.
              </p>
            )}
          </div>

          {/* Supplier — existing-only picker. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-po-supplier">Supplier</Label>
            <TypeableCombobox
              id="add-po-supplier"
              aria-label="Supplier"
              value={supplierId}
              onChange={(v) => {
                // Re-point: reset the item so its suggestions re-scope to the new
                // supplier. (Prefill sets supplierId directly, so it's unaffected.)
                setSupplierId(v);
                setItemName("");
              }}
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

          {/* Item — supplier-scoped, creatable. Disabled until a supplier is
              picked; suggestions are that supplier's existing items; a new value
              can always be typed + added. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-po-item">Item name</Label>
            <TypeableCombobox
              id="add-po-item"
              aria-label="Item name"
              value={itemName}
              onChange={setItemName}
              options={itemOptions}
              creatable
              disabled={!supplierId}
              placeholder={
                !supplierId
                  ? "Pick a supplier first"
                  : itemOptions.length > 0
                    ? "Select or type an item"
                    : "Type to add the first item"
              }
              emptyText="Type to add a new item"
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
              {saving ? "Saving…" : isEdit ? "Save changes" : "Save purchase"}
            </Button>
          </div>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
