"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
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
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import {
  RowCheckbox,
  usePagination,
  PaginationFooter,
  SelectionBar,
  ROSTER_PAGE_SIZE,
} from "@/components/ui/roster-table";
import { formatCompactCurrency, panelElevation } from "@/lib/utils";

/** One purchase row — the full raw field set (the roster displays a subset).
 *  Dates are YYYY-MM-DD strings. */
export type PurchaseRow = {
  poId: string;
  supplierExternalId: string;
  supplierName: string;
  category: string;
  itemName: string;
  unit: string;
  quantity: number;
  unitPriceUsd: number;
  totalValueUsd: number;
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

type Filters = { poId: string; supplier: string; item: string; unit: string };
const EMPTY_FILTERS: Filters = { poId: "", supplier: "", item: "", unit: "" };

export function PurchaseRosterTable({ purchases }: { purchases: PurchaseRow[] }) {
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [deleting, setDeleting] = useState(false);

  const filtered = useMemo(() => {
    const has = (v: string, q: string) => v.toLowerCase().includes(q.trim().toLowerCase());
    return purchases.filter(
      (p) =>
        has(p.poId, filters.poId) &&
        // supplier filter matches name OR id
        (has(p.supplierName, filters.supplier) || has(p.supplierExternalId, filters.supplier)) &&
        has(p.itemName, filters.item) &&
        has(p.unit, filters.unit),
    );
  }, [purchases, filters]);

  const { page, setPage, pageCount, start, pageItems } = usePagination(
    filtered,
    ROSTER_PAGE_SIZE,
    JSON.stringify(filters),
  );

  function toggleOne(id: string, on: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (on) next.add(id);
      else next.delete(id);
      return next;
    });
  }

  async function handleBatchDelete() {
    const ids = [...selected];
    setDeleting(true);
    try {
      const res = await fetch("/api/purchases/batch-delete", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ids }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        deleted?: number;
      };
      // A recompute failure returns a non-2xx error, so success means the analyses
      // have actually refreshed.
      if (res.ok && typeof data.deleted === "number") {
        toast.success(`Removed ${data.deleted} purchase${data.deleted === 1 ? "" : "s"}.`);
        setSelected(new Set());
        setConfirmOpen(false);
        router.refresh();
      } else {
        toast.error(data.error || "Could not remove the selected purchases.");
        setConfirmOpen(false);
      }
    } catch {
      toast.error("Could not remove the selected purchases.");
      setConfirmOpen(false);
    } finally {
      setDeleting(false);
    }
  }

  const selectedCount = selected.size;

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">
        Purchases{" "}
        <span className="text-sm font-normal text-muted-foreground">
          ({filtered.length}
          {filtered.length !== purchases.length ? ` of ${purchases.length}` : ""})
        </span>
      </h2>

      {selectedCount > 0 && (
        <SelectionBar
          count={selectedCount}
          onClear={() => setSelected(new Set())}
          onDelete={() => setConfirmOpen(true)}
        />
      )}

      {purchases.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No purchases yet. Import data or add one above.
        </p>
      ) : (
        <>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-9" />
                <TableHead>PO ID</TableHead>
                <TableHead>Supplier</TableHead>
                <TableHead>Item</TableHead>
                <TableHead>Unit</TableHead>
                <TableHead className="text-right">Qty</TableHead>
                <TableHead className="text-right">Unit price</TableHead>
                <TableHead className="text-right">Total</TableHead>
                <TableHead>Payment date</TableHead>
              </TableRow>
              <TableRow className="hover:bg-transparent">
                <TableHead className="w-9" />
                <TableHead>
                  <Input
                    value={filters.poId}
                    onChange={(e) => setFilters((f) => ({ ...f, poId: e.target.value }))}
                    placeholder="Filter PO"
                    className="h-7 text-xs"
                    aria-label="Filter by PO ID"
                  />
                </TableHead>
                <TableHead>
                  <Input
                    value={filters.supplier}
                    onChange={(e) => setFilters((f) => ({ ...f, supplier: e.target.value }))}
                    placeholder="Filter supplier"
                    className="h-7 text-xs"
                    aria-label="Filter by supplier"
                  />
                </TableHead>
                <TableHead>
                  <Input
                    value={filters.item}
                    onChange={(e) => setFilters((f) => ({ ...f, item: e.target.value }))}
                    placeholder="Filter item"
                    className="h-7 text-xs"
                    aria-label="Filter by item"
                  />
                </TableHead>
                <TableHead>
                  <Input
                    value={filters.unit}
                    onChange={(e) => setFilters((f) => ({ ...f, unit: e.target.value }))}
                    placeholder="Unit"
                    className="h-7 text-xs"
                    aria-label="Filter by unit"
                  />
                </TableHead>
                <TableHead colSpan={4} />
              </TableRow>
            </TableHeader>
            <TableBody>
              {pageItems.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground">
                    No purchases match the filters.
                  </TableCell>
                </TableRow>
              ) : (
                pageItems.map((p) => {
                  const isSel = selected.has(p.poId);
                  return (
                    <TableRow key={p.poId} className={`group ${isSel ? "bg-muted/40" : ""}`}>
                      <TableCell>
                        <RowCheckbox
                          ariaLabel={`Select ${p.poId}`}
                          checked={isSel}
                          onChange={(on) => toggleOne(p.poId, on)}
                        />
                      </TableCell>
                      <TableCell className="font-mono text-muted-foreground">{p.poId}</TableCell>
                      <TableCell>
                        <span className="font-medium">{p.supplierName}</span>{" "}
                        <span className="font-mono text-xs text-muted-foreground">
                          {p.supplierExternalId}
                        </span>
                      </TableCell>
                      <TableCell>{p.itemName}</TableCell>
                      <TableCell>{p.unit}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {p.quantity.toLocaleString("en-US")}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCompactCurrency(p.unitPriceUsd)}
                      </TableCell>
                      <TableCell className="text-right tabular-nums">
                        {formatCompactCurrency(p.totalValueUsd)}
                      </TableCell>
                      <TableCell className="tabular-nums text-muted-foreground">
                        {p.paymentDate}
                      </TableCell>
                    </TableRow>
                  );
                })
              )}
            </TableBody>
          </Table>

          <PaginationFooter
            page={page}
            pageCount={pageCount}
            start={start}
            pageSize={ROSTER_PAGE_SIZE}
            total={filtered.length}
            setPage={setPage}
          />
        </>
      )}

      {/* Batch-delete confirmation. */}
      <Dialog open={confirmOpen} onOpenChange={(o) => !deleting && setConfirmOpen(o)}>
        <DialogContent
          showCloseButton={false}
          aria-label="Confirm delete"
          className={`flex w-full flex-col gap-0 p-0 sm:max-w-[420px] ${panelElevation}`}
        >
          <div className="border-b p-4">
            <DialogTitle className="font-heading text-base font-medium leading-snug">
              Delete {selectedCount} purchase{selectedCount === 1 ? "" : "s"}?
            </DialogTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              This can&rsquo;t be undone. The affected suppliers&rsquo; scores will
              recompute.
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
