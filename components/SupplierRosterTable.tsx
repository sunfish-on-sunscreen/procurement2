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
import { CountryFlag } from "@/components/CountryFlag";
import { countryName } from "@/lib/countries";
import { usePagination, PaginationFooter, ROSTER_PAGE_SIZE } from "@/components/ui/roster-table";

/**
 * Supplier master roster.
 *
 * ⚠️ There is no delete. Every supplier is referenced by posted documents
 * (Framework / Response / PurchaseOrder / Invoice / SourcingEvent), all RESTRICT
 * FKs, so retirement is a STATUS FLIP — the row stays and its history stays
 * readable. The old batch-delete UI was removed with the flat model.
 */
type Row = {
  id: string;
  supplierName: string;
  country: string;
  category: string;
  status: string;
};

type Filters = { id: string; name: string; country: string; category: string };
const EMPTY_FILTERS: Filters = { id: "", name: "", country: "", category: "" };

export function SupplierRosterTable({ suppliers }: { suppliers: Row[] }) {
  const router = useRouter();
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [busyId, setBusyId] = useState<string | null>(null);

  const filtered = useMemo(() => {
    const has = (v: string, q: string) => v.toLowerCase().includes(q.trim().toLowerCase());
    return suppliers.filter(
      (s) =>
        has(s.id, filters.id) &&
        has(s.supplierName, filters.name) &&
        // country filter matches the name OR the code
        (has(s.country, filters.country) || has(countryName(s.country), filters.country)) &&
        has(s.category, filters.category),
    );
  }, [suppliers, filters]);

  const { page, setPage, pageCount, start, pageItems } = usePagination(
    filtered,
    ROSTER_PAGE_SIZE,
    JSON.stringify(filters),
  );

  async function toggleStatus(row: Row) {
    const reactivate = row.status !== "active";
    setBusyId(row.id);
    try {
      const res = await fetch(`/api/suppliers/${row.id}/deactivate`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reactivate }),
      });
      const data = (await res.json().catch(() => ({}))) as {
        error?: string;
        detail?: string;
        status?: string;
      };
      if (res.ok && data.status) {
        toast.success(`${row.supplierName} is now ${data.status}.`);
        router.refresh();
      } else {
        // The generic string is now only a last resort — for a response that carried
        // no JSON at all (a crash, or a 404 from a torn build). Anything the server
        // could explain, it explains, and `detail` carries the underlying cause.
        toast.error(data.error || "Could not change the supplier status.", {
          description: data.detail,
        });
      }
    } catch {
      toast.error("Could not change the supplier status.");
    } finally {
      setBusyId(null);
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <h2 className="text-lg font-semibold">
        Suppliers{" "}
        <span className="text-sm font-normal text-muted-foreground">
          ({filtered.length}
          {filtered.length !== suppliers.length ? ` of ${suppliers.length}` : ""})
        </span>
      </h2>

      {suppliers.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          No suppliers yet. Import data or add one above.
        </p>
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>ID</TableHead>
              <TableHead>Supplier</TableHead>
              <TableHead>Country</TableHead>
              <TableHead>Category</TableHead>
              <TableHead>Status</TableHead>
              <TableHead className="text-right">Actions</TableHead>
            </TableRow>
            <TableRow className="hover:bg-transparent">
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
              <TableHead />
              <TableHead />
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
              pageItems.map((s) => {
                const inactive = s.status !== "active";
                return (
                  <TableRow key={s.id} className={`group ${inactive ? "opacity-60" : ""}`}>
                    <TableCell className="font-mono text-muted-foreground">{s.id}</TableCell>
                    <TableCell className="font-medium">{s.supplierName}</TableCell>
                    <TableCell>
                      {(() => {
                        const name = countryName(s.country);
                        return name && name !== s.country ? (
                          <>
                            {name}
                            <span className="text-muted-foreground"> · {s.country}</span>
                          </>
                        ) : (
                          s.country
                        );
                      })()}
                      <CountryFlag code={s.country} />
                    </TableCell>
                    <TableCell>{s.category}</TableCell>
                    <TableCell>
                      <span
                        className="rounded-md px-2 py-0.5 text-xs capitalize"
                        style={{
                          backgroundColor: `color-mix(in srgb, var(${
                            inactive ? "--muted-foreground" : "--zone-stars"
                          }) 14%, transparent)`,
                          color: `var(${inactive ? "--muted-foreground" : "--zone-stars"})`,
                        }}
                      >
                        {s.status}
                      </span>
                    </TableCell>
                    <TableCell className="text-right">
                      <Button
                        variant="outline"
                        size="sm"
                        disabled={busyId === s.id}
                        onClick={() => toggleStatus(s)}
                      >
                        {busyId === s.id ? "Saving…" : inactive ? "Reactivate" : "Deactivate"}
                      </Button>
                    </TableCell>
                  </TableRow>
                );
              })
            )}
          </TableBody>
        </Table>
      )}

      {suppliers.length > 0 && (
        <PaginationFooter
          page={page}
          pageCount={pageCount}
          start={start}
          pageSize={ROSTER_PAGE_SIZE}
          total={filtered.length}
          setPage={setPage}
        />
      )}
    </div>
  );
}
