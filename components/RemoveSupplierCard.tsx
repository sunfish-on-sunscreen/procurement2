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

export type SupplierPick = { id: string; name: string };

/**
 * Remove a single supplier (mirrors AddSupplierCard). Existing-only picker →
 * confirm → DELETE /api/suppliers/[id]. The server blocks (409) if the supplier
 * has purchases; that message is surfaced inline. On success the roster refreshes
 * and all periods recompute server-side.
 */
export function RemoveSupplierCard({
  open,
  onOpenChange,
  suppliers,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  suppliers: SupplierPick[];
}) {
  const router = useRouter();
  const options = useMemo<ComboOption[]>(
    () => suppliers.map((s) => ({ value: s.id, label: `${s.name} (${s.id})`, keywords: s.id })),
    [suppliers],
  );

  const [supplierId, setSupplierId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [removing, setRemoving] = useState(false);

  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setSupplierId("");
      setError(null);
      setRemoving(false);
    }
  }

  const picked = suppliers.find((s) => s.id === supplierId);

  async function handleRemove() {
    setError(null);
    if (!supplierId) {
      setError("Pick a supplier to remove.");
      return;
    }
    setRemoving(true);
    try {
      const res = await fetch(`/api/suppliers/${supplierId}`, { method: "DELETE" });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        deleted?: string;
        recomputeWarning?: string | null;
      };
      if (res.ok && data.deleted) {
        toast.success(`Removed ${picked?.name ?? data.deleted} (${data.deleted}).`);
        if (data.recomputeWarning) toast.warning(data.recomputeWarning);
        onOpenChange(false);
        router.refresh();
      } else {
        setError(data.error || "Could not remove the supplier.");
      }
    } catch {
      setError("Could not remove the supplier.");
    } finally {
      setRemoving(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-label="Remove a supplier"
        className={`flex max-h-[85vh] w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[460px] ${panelElevation}`}
      >
        <header className="flex items-start justify-between gap-2 border-b p-4">
          <div className="min-w-0">
            <DialogTitle className="truncate font-heading text-base font-medium leading-snug">
              Remove a supplier
            </DialogTitle>
            <p className="truncate text-xs text-muted-foreground">
              A supplier with any purchases can&rsquo;t be removed.
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
            <Label htmlFor="remove-supplier-picker">Supplier</Label>
            <TypeableCombobox
              id="remove-supplier-picker"
              aria-label="Supplier to remove"
              value={supplierId}
              onChange={setSupplierId}
              options={options}
              placeholder="Search by name or id"
              emptyText="No matching supplier"
            />
          </div>

          {picked && (
            <p className="text-sm text-muted-foreground">
              This permanently removes{" "}
              <span className="font-medium text-foreground">{picked.name}</span> ({picked.id}).
              This can&rsquo;t be undone.
            </p>
          )}

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t bg-muted/50 p-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={removing}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleRemove} disabled={removing || !supplierId}>
            {removing ? "Removing…" : "Remove supplier"}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
