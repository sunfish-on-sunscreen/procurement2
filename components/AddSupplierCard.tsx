"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { X } from "lucide-react";
import { toast } from "sonner";
import * as Flags from "country-flag-icons/react/3x2";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { TypeableCombobox, type ComboOption } from "@/components/ui/typeable-combobox";
import { CountryFlag } from "@/components/CountryFlag";
import { panelElevation } from "@/lib/utils";

/** All ISO alpha-2 countries that country-flag-icons ships a flag for, named via
 *  Intl.DisplayNames (no extra dependency). Built once. */
function useCountryOptions(): ComboOption[] {
  return useMemo(() => {
    const names = new Intl.DisplayNames(["en"], { type: "region" });
    const out: ComboOption[] = [];
    for (const code of Object.keys(Flags)) {
      if (!/^[A-Z]{2}$/.test(code)) continue;
      let label: string | undefined;
      try {
        label = names.of(code);
      } catch {
        label = undefined;
      }
      if (!label || label === code) continue;
      out.push({ value: code, label, keywords: code });
    }
    out.sort((a, b) => a.label.localeCompare(b.label));
    return out;
  }, []);
}

export type EditSupplier = {
  id: string;
  name: string;
  country: string;
  category: string;
};

export function AddSupplierCard({
  open,
  onOpenChange,
  nextId,
  categories,
  editSupplier = null,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Server-computed preview of the next id (the server re-assigns on save). */
  nextId: string;
  /** Existing category values (for the creatable category combobox). */
  categories: string[];
  /** When set, the card is in EDIT mode (pre-filled; id locked; PATCH on save). */
  editSupplier?: EditSupplier | null;
}) {
  const router = useRouter();
  const isEdit = editSupplier != null;
  const countryOptions = useCountryOptions();
  const categoryOptions = useMemo<ComboOption[]>(
    () => categories.map((c) => ({ value: c, label: c })),
    [categories],
  );

  const [name, setName] = useState("");
  const [country, setCountry] = useState("");
  const [category, setCategory] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Reset/prefill the form when the card opens OR the edit target changes
  // (render-time transition — avoids the lint-banned set-state-in-effect).
  const editId = editSupplier?.id ?? null;
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevEditId, setPrevEditId] = useState(editId);
  if (open !== prevOpen || editId !== prevEditId) {
    setPrevOpen(open);
    setPrevEditId(editId);
    if (open) {
      setName(editSupplier?.name ?? "");
      setCountry(editSupplier?.country ?? "");
      setCategory(editSupplier?.category ?? "");
      setError(null);
      setSaving(false);
    }
  }

  async function handleSave() {
    setError(null);
    if (!name.trim() || !country.trim() || !category.trim()) {
      setError("Supplier name, country, and category are all required.");
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(
        isEdit ? `/api/suppliers/${editSupplier!.id}` : "/api/suppliers",
        {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            supplier_name: name.trim(),
            country: country.trim(),
            category: category.trim(),
          }),
        },
      );
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        supplier?: { id: string; name: string };
        recomputeWarning?: string | null;
      };
      if (res.ok && data.supplier) {
        if (isEdit) {
          toast.success(`Updated ${data.supplier.name} (${data.supplier.id}).`);
          if (data.recomputeWarning) toast.warning(data.recomputeWarning);
        } else {
          toast.success(`Added ${data.supplier.name} (${data.supplier.id}).`);
        }
        onOpenChange(false);
        router.refresh(); // re-derive roster + nextId + categories on the server
      } else {
        setError(data.error || `Could not ${isEdit ? "update" : "create"} the supplier.`);
      }
    } catch {
      setError(`Could not ${isEdit ? "update" : "create"} the supplier.`);
    } finally {
      setSaving(false);
    }
  }

  const selectedCountry = countryOptions.find((c) => c.value === country);
  const displayId = isEdit ? editSupplier!.id : nextId;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-label={isEdit ? "Edit supplier" : "Add a supplier"}
        className={`flex max-h-[85vh] w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[460px] ${panelElevation}`}
      >
        <header className="flex items-start justify-between gap-2 border-b p-4">
          <div className="min-w-0">
            <DialogTitle className="truncate font-heading text-base font-medium leading-snug">
              {isEdit ? "Edit supplier" : "Add a supplier"}
            </DialogTitle>
            <p className="truncate text-xs text-muted-foreground">
              {isEdit
                ? "Update this supplier — the ID is locked to keep purchase links intact."
                : "Create a single supplier record — the ID is assigned automatically."}
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
          {/* Supplier ID — greyed, read-only preview. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-supplier-id">Supplier ID</Label>
            <Input
              id="add-supplier-id"
              value={displayId}
              readOnly
              disabled
              tabIndex={-1}
              className="font-mono text-muted-foreground"
            />
            <p className="text-[11px] text-muted-foreground">
              {isEdit
                ? "Locked — changing it would break purchase links."
                : "Auto-generated. Confirmed by the server when you save."}
            </p>
          </div>

          {/* Supplier name. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-supplier-name">Supplier name</Label>
            <Input
              id="add-supplier-name"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. PT Sumber Mineral"
              autoComplete="off"
            />
          </div>

          {/* Country — typeable, flags. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-supplier-country">Country</Label>
            <TypeableCombobox
              id="add-supplier-country"
              aria-label="Country"
              value={country}
              onChange={setCountry}
              options={countryOptions}
              placeholder="Type to search (e.g. Indonesia)"
              leading={selectedCountry ? <CountryFlag code={country} /> : null}
              renderOption={(o) => (
                <>
                  <CountryFlag code={o.value} />
                  <span>{o.label}</span>
                </>
              )}
            />
          </div>

          {/* Category — typeable + creatable. */}
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="add-supplier-category">Category</Label>
            <TypeableCombobox
              id="add-supplier-category"
              aria-label="Category"
              value={category}
              onChange={setCategory}
              options={categoryOptions}
              creatable
              placeholder="Select or type a new category"
            />
          </div>

          {error && <p className="text-sm text-destructive">{error}</p>}
        </div>

        <footer className="flex items-center justify-end gap-2 border-t bg-muted/50 p-4">
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
            Cancel
          </Button>
          <Button onClick={handleSave} disabled={saving}>
            {saving ? "Saving…" : isEdit ? "Save changes" : "Save supplier"}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
