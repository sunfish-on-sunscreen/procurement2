"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { TypeableCombobox, type ComboOption } from "@/components/ui/typeable-combobox";
import { panelElevation } from "@/lib/utils";

export type PurchasePick = {
  poId: string;
  supplierExternalId: string;
  supplierName: string;
  itemName: string;
};

/**
 * Remove a single purchase (mirrors RemoveSupplierCard). Picker searches by
 * po_id / supplier / item (capped list — 647 rows). Confirm → DELETE
 * /api/purchases/[id]. No block rule (a purchase can't orphan anything); the
 * affected supplier's scores recompute server-side.
 */
export function RemovePurchaseCard({
  open,
  onOpenChange,
  purchases,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  purchases: PurchasePick[];
}) {
  const router = useRouter();
  const options = useMemo<ComboOption[]>(
    () =>
      purchases.map((p) => ({
        value: p.poId,
        label: `${p.poId} · ${p.supplierName} · ${p.itemName}`,
        keywords: `${p.supplierExternalId} ${p.itemName}`,
      })),
    [purchases],
  );

  const [poId, setPoId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setPoId("");
      setError(null);
      setRemoving(false);
    }
  }

  const picked = purchases.find((p) => p.poId === poId);

  async function handleRemove() {
    setError(null);
    if (!poId) {
      setError("Pick a purchase to remove.");
      return;
    }
    setRemoving(true);
    try {
      const res = await fetch(`/api/purchases/${poId}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        deleted?: string;
        recomputeWarning?: string | null;
      };
      if (res.ok && data.deleted) {
        toast.success(`Removed ${data.deleted}.`);
        if (data.recomputeWarning) toast.warning(data.recomputeWarning);
        onOpenChange(false);
        router.refresh();
      } else {
        setError(data.error || "Could not remove the purchase.");
      }
    } catch {
      setError("Could not remove the purchase.");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-label="Remove a purchase"
        className={`flex max-h-[85vh] w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[520px] ${panelElevation}`}
      >
        <header className="flex items-start justify-between gap-2 border-b p-4">
          <div className="min-w-0">
            <DialogTitle className="truncate font-heading text-base font-medium leading-snug">
              Remove a purchase
            </DialogTitle>
            <p className="truncate text-xs text-muted-foreground">
              The affected supplier&rsquo;s scores recompute on remove.
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
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="remove-purchase-picker">Purchase</Label>
            <TypeableCombobox
              id="remove-purchase-picker"
              aria-label="Purchase to remove"
              value={poId}
              onChange={setPoId}
              options={options}
              maxVisible={50}
              placeholder="Search by PO id, supplier, or item"
              emptyText="No matching purchase"
            />
          </div>

          {picked && (
            <p className="text-sm text-muted-foreground">
              This permanently removes{" "}
              <span className="font-mono text-foreground">{picked.poId}</span> —{" "}
              {picked.supplierName} · {picked.itemName}. This can&rsquo;t be undone.
            </p>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t bg-muted/50 p-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={removing}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleRemove} disabled={removing || !poId}>
            {removing ? "Removing…" : "Remove purchase"}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
