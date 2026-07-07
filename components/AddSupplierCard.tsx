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

export function AddSupplierCard({
  open,
  onOpenChange,
  nextId,
  categories,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Server-computed preview of the next id (the server re-assigns on save). */
  nextId: string;
  /** Existing category values (for the creatable category combobox). */
  categories: string[];
}) {
  const router = useRouter();
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

  // Reset the form each time the card opens (render-time transition — avoids the
  // lint-banned set-state-in-effect).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setName("");
      setCountry("");
      setCategory("");
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
      const res = await fetch("/api/suppliers", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          supplier_name: name.trim(),
          country: country.trim(),
          category: category.trim(),
        }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        supplier?: { id: string; name: string };
      };
      if (res.ok && data.supplier) {
        toast.success(`Added ${data.supplier.name} (${data.supplier.id}).`);
        onOpenChange(false);
        router.refresh(); // re-derive roster + nextId + categories on the server
      } else {
        setError(data.error || "Could not create the supplier.");
      }
    } catch {
      setError("Could not create the supplier.");
    } finally {
      setSaving(false);
    }
  }

  const selectedCountry = countryOptions.find((c) => c.value === country);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        aria-label="Add a supplier"
        className={`flex max-h-[85vh] w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[460px] ${panelElevation}`}
      >
        <header className="flex items-start justify-between gap-2 border-b p-4">
          <div className="min-w-0">
            <DialogTitle className="truncate font-heading text-base font-medium leading-snug">
              Add a supplier
            </DialogTitle>
            <p className="truncate text-xs text-muted-foreground">
              Create a single supplier record — the ID is assigned automatically.
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
              value={nextId}
              readOnly
              disabled
              tabIndex={-1}
              className="font-mono text-muted-foreground"
            />
            <p className="text-[11px] text-muted-foreground">
              Auto-generated. Confirmed by the server when you save.
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
            {saving ? "Saving…" : "Save supplier"}
          </Button>
        </footer>
      </DialogContent>
    </Dialog>
  );
}
