"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { CountryFlag } from "@/components/CountryFlag";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { AddSupplierCard, type EditSupplier } from "@/components/AddSupplierCard";
import { panelElevation } from "@/lib/utils";

type Row = {
  externalId: string;
  supplierName: string;
  country: string;
  category: string;
};

type Filters = { id: string; name: string; country: string; category: string };
const EMPTY_FILTERS: Filters = { id: "", name: "", country: "", category: "" };

export function SupplierRosterTable({
  suppliers,
  categories,
}: {
  suppliers: Row[];
  categories: string[];
}) {
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [editTarget, setEditTarget] = useState<EditSupplier | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    const has = (v: string, q: string) => v.toLowerCase().includes(q.trim().toLowerCase());
    return suppliers.filter(
      (s) =>
        has(s.externalId, filters.id) &&
        has(s.supplierName, filters.name) &&
        has(s.country, filters.country) &&
        has(s.category, filters.category),
    );
  }, [suppliers, filters]);

  const filteredIds = useMemo(() => filtered.map((s) => s.externalId), [filtered]);
  const selectedInView = filteredIds.filter((id) => selected.has(id));
  const allFilteredSelected = filteredIds.length > 0 && selectedInView.length === filteredIds.length;
  const someFilteredSelected = selectedInView.length > 0 && !allFilteredSelected;

  function toggleOne(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }
  function toggleAllFiltered(on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const id of filteredIds) {
        if (on) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }

  function openEdit(s: Row) {
    setEditTarget({
      id: s.externalId,
      name: s.supplierName,
      country: s.country,
      category: s.category,
    });
    setEditOpen(true);
  }

  async function handleBatchDelete() {
    const ids = [...selected];
    setDeleting(true);
    try {
      const res = await fetch("/api/suppliers/batch-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        deleted?: number;
        recomputeWarning?: string | null;
      };
      if (res.ok && typeof data.deleted === "number") {
        toast.success(`Removed ${data.deleted} supplier${data.deleted === 1 ? "" : "s"}.`);
        if (data.recomputeWarning) toast.warning(data.recomputeWarning);
        setSelected(new Set());
        setConfirmOpen(false);
        router.refresh();
      } else {
        // All-or-nothing block (e.g. some have purchases) — keep the dialog open.
        toast.error(data.error || "Could not remove the selected suppliers.");
        setConfirmOpen(false);
      }
    } catch {
      toast.error("Could not remove the selected suppliers.");
      setConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  const selectedCount = selected.size;

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center justify-between gap-3">
        <h2 className="text-lg font-semibold">
          Suppliers{" "}
          <span className="text-sm font-normal text-muted-foreground">
            ({filtered.length}
            {filtered.length !== suppliers.length ? ` of ${suppliers.length}` : ""})
          </span>
        </h2>
        {selectedCount > 0 && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setSelected(new Set())}
              className="text-sm text-muted-foreground underline-offset-4 hover:underline"
            >
              Clear
            </button>
            <Button
              variant="destructive"
              size="sm"
              onClick={() => setConfirmOpen(true)}
            >
              Delete selected ({selectedCount})
            </Button>
          </div>
        )}
      </div>

      {suppliers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No suppliers yet. Import data or add one above.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead className="w-9">
                <input
                  type="checkbox"
                  aria-label="Select all filtered suppliers"
                  className="cursor-pointer"
                  checked={allFilteredSelected}
                  ref={(el) => {
                    if (el) el.indeterminate = someFilteredSelected;
                  }}
                  onChange={(e) => toggleAllFiltered(e.target.checked)}
                />
              </TableHead>
              <TableHead>ID</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Category</TableHead>
              <TableHead className="w-16 text-right">Edit</TableHead>
            </TableRow>
            <TableRow className="hover:bg-transparent">
              <TableHead className="w-9" />
              <TableHead>
                <Input
                  value={filters.id}
                  onChange={(e) => setFilters((f) => ({ ...f, id: e.target.value }))}
                  placeholder="Filter id"
                  className="h-7 text-xs"
                  aria-label="Filter by id"
                />
              </TableHead>
              <TableHead>
                <Input
                  value={filters.name}
                  onChange={(e) => setFilters((f) => ({ ...f, name: e.target.value }))}
                  placeholder="Filter name"
                  className="h-7 text-xs"
                  aria-label="Filter by name"
                />
              </TableHead>
              <TableHead>
                <Input
                  value={filters.country}
                  onChange={(e) => setFilters((f) => ({ ...f, country: e.target.value }))}
                  placeholder="Filter country"
                  className="h-7 text-xs"
                  aria-label="Filter by country"
                />
              </TableHead>
              <TableHead>
                <Input
                  value={filters.category}
                  onChange={(e) => setFilters((f) => ({ ...f, category: e.target.value }))}
                  placeholder="Filter category"
                  className="h-7 text-xs"
                  aria-label="Filter by category"
                />
              </TableHead>
              <TableHead className="w-16" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {filtered.length === 0 ? (
              <TableRow>
                <TableCell colSpan={6} className="text-center text-muted-foreground">
                  No suppliers match the filters.
                </TableCell>
              </TableRow>
            ) : (
              filtered.map((s) => {
                const isSel = selected.has(s.externalId);
                return (
                  <TableRow
                    key={s.externalId}
                    className={`group ${isSel ? "bg-muted/40" : ""}`}
                  >
                    <TableCell>
                      <input
                        type="checkbox"
                        aria-label={`Select ${s.externalId}`}
                        className="cursor-pointer"
                        checked={isSel}
                        onChange={(e) => toggleOne(s.externalId, e.target.checked)}
                      />
                    </TableCell>
                    <TableCell className="font-mono text-muted-foreground">
                      {s.externalId}
                    </TableCell>
                    <TableCell className="font-medium">{s.supplierName}</TableCell>
                    <TableCell>
                      {s.country}
                      <CountryFlag code={s.country} />
                    </TableCell>
                    <TableCell>{s.category}</TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="ghost"
                        size="icon"
                        className="h-7 w-7 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                        aria-label={`Edit ${s.externalId}`}
                        onClick={() => openEdit(s)}
                      >
                        <Pencil className="h-3.5 w-3.5" />
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      )}

      {/* Edit card (reuses AddSupplierCard in edit mode). */}
      <AddSupplierCard
        open={editOpen}
        onOpenChange={setEditOpen}
        nextId=""
        categories={categories}
        editSupplier={editTarget}
      />

      {/* Batch-delete confirmation. */}
      <Dialog open={confirmOpen} onOpenChange={(o) => !deleting && setConfirmOpen(o)}>
        <DialogContent
          showCloseButton={false}
          aria-label="Confirm delete"
          className={`flex w-full flex-col gap-0 p-0 sm:max-w-[420px] ${panelElevation}`}
        >
          <div className="border-b p-4">
            <DialogTitle className="font-heading text-base font-medium leading-snug">
              Delete {selectedCount} supplier{selectedCount === 1 ? "" : "s"}?
            </DialogTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              This can&rsquo;t be undone. Any supplier with purchases will block the
              whole batch.
            </p>
          </div>
          <footer className="flex items-center justify-end gap-2 border-t bg-muted/50 p-4">
            <Button variant="outline" onClick={() => setConfirmOpen(false)} disabled={deleting}>
              Cancel
            </Button>
            <Button variant="destructive" onClick={handleBatchDelete} disabled={deleting}>
              {deleting ? "Deleting…" : `Delete ${selectedCount}`}
            </Button>
          </footer>
        </DialogContent>
      </Dialog>
    </div>
  );
}
