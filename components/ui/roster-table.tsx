"use client";

import * as React from "react";
import { Check } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

/** Shared chrome for the import-page roster tables (Suppliers + Purchases) —
 *  one source of truth so both look + behave identically. */

export const ROSTER_PAGE_SIZE = 25;

/**
 * Row checkbox: a styled `appearance-none` box (rounded, slate border) that shows
 * a white check on `primary` when checked. Hidden at rest, revealed on row hover
 * (needs a `group` ancestor row) or keyboard focus, and always visible once
 * checked. Pure — no locale/Date formatting (hydration-safe).
 */
export function RowCheckbox({
  checked,
  onChange,
  ariaLabel,
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  ariaLabel: string;
}) {
  return (
    <span className="relative inline-flex size-4 items-center justify-center">
      <input
        type="checkbox"
        aria-label={ariaLabel}
        checked={checked}
        onChange={(e) => onChange(e.target.checked)}
        className={cn(
          "size-4 cursor-pointer appearance-none rounded-[4px] border border-input bg-background shadow-sm transition-opacity",
          "checked:border-primary checked:bg-primary",
          "focus-visible:opacity-100 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring",
          checked ? "opacity-100" : "opacity-0 group-hover:opacity-100",
        )}
      />
      {checked && (
        <Check
          className="pointer-events-none absolute size-3 text-primary-foreground"
          strokeWidth={3}
        />
      )}
    </span>
  );
}

/**
 * Client-side pagination over an already-filtered list. Resets to page 1 when
 * `resetKey` changes (e.g. the filters), clamps the page when the list shrinks,
 * and slices out the current page. Selection lives outside this hook, so it
 * persists across pages + filters.
 */
export function usePagination<T>(items: T[], pageSize: number, resetKey: string) {
  const [page, setPage] = React.useState(0);
  const [prevKey, setPrevKey] = React.useState(resetKey);
  if (resetKey !== prevKey) {
    setPrevKey(resetKey);
    setPage(0);
  }
  const pageCount = Math.max(1, Math.ceil(items.length / pageSize));
  const safePage = Math.min(page, pageCount - 1);
  const start = safePage * pageSize;
  const pageItems = items.slice(start, start + pageSize);
  return { page: safePage, setPage, pageCount, start, pageItems };
}

/** Prev/Next + "Showing X–Y of N" + "Page P of T" footer. */
export function PaginationFooter({
  page,
  pageCount,
  start,
  pageSize,
  total,
  setPage,
}: {
  page: number;
  pageCount: number;
  start: number;
  pageSize: number;
  total: number;
  setPage: (page: number) => void;
}) {
  return (
    <div className="flex items-center justify-between gap-3 text-sm text-muted-foreground">
      <span>
        {total === 0
          ? "0 results"
          : `Showing ${start + 1}–${Math.min(start + pageSize, total)} of ${total}`}
      </span>
      <div className="flex items-center gap-2">
        <Button
          variant="outline"
          size="sm"
          disabled={page === 0}
          onClick={() => setPage(Math.max(0, page - 1))}
        >
          Prev
        </Button>
        <span className="tabular-nums">
          Page {page + 1} of {pageCount}
        </span>
        <Button
          variant="outline"
          size="sm"
          disabled={page >= pageCount - 1}
          onClick={() => setPage(Math.min(pageCount - 1, page + 1))}
        >
          Next
        </Button>
      </div>
    </div>
  );
}

/** The bar above a roster table when ≥1 row is selected: "N selected", Clear,
 *  and Delete selected (opens the table's confirm dialog). */
export function SelectionBar({
  count,
  onClear,
  onDelete,
}: {
  count: number;
  onClear: () => void;
  onDelete: () => void;
}) {
  return (
    <div className="flex items-center gap-3 rounded-lg border bg-muted/40 px-3 py-2">
      <span className="text-sm font-medium">{count} selected</span>
      <button
        type="button"
        onClick={onClear}
        className="text-sm text-muted-foreground underline-offset-4 hover:underline"
      >
        Clear
      </button>
      <div className="flex-1" />
      <Button variant="destructive" size="sm" onClick={onDelete}>
        Delete selected
      </Button>
    </div>
  );
}
