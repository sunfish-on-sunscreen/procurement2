"use client";

import * as React from "react";
import { cn } from "@/lib/utils";
import { panelElevation } from "@/lib/utils";

export type ComboOption = {
  value: string;
  label: string;
  /** extra searchable text (e.g. a country code) beyond the label. */
  keywords?: string;
};

/**
 * A small filter-as-you-type combobox (the repo has no Command/Popover
 * primitive). Renders an Input-styled field + a floating filtered list;
 * keyboard-navigable (↑/↓/Enter/Esc). When `creatable`, a "+ Add '<query>'" row
 * lets the user commit a value that isn't in `options`. Stores `option.value`.
 */
export function TypeableCombobox({
  value,
  onChange,
  options,
  placeholder,
  creatable = false,
  renderOption,
  leading,
  emptyText = "No matches",
  id,
  "aria-label": ariaLabel,
}: {
  value: string;
  onChange: (value: string) => void;
  options: ComboOption[];
  placeholder?: string;
  creatable?: boolean;
  renderOption?: (o: ComboOption) => React.ReactNode;
  /** adornment shown left of the field when a value is selected (e.g. a flag). */
  leading?: React.ReactNode;
  emptyText?: string;
  id?: string;
  "aria-label"?: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const [highlight, setHighlight] = React.useState(0);
  const rootRef = React.useRef<HTMLDivElement>(null);
  const listboxId = React.useId();

  const selected = options.find((o) => o.value === value);
  // With `creatable`, value == label, so a freshly-created value still displays.
  const selectedLabel = selected?.label ?? (creatable ? value : "");

  const q = query.trim().toLowerCase();
  const filtered = q
    ? options.filter(
        (o) =>
          o.label.toLowerCase().includes(q) ||
          o.value.toLowerCase().includes(q) ||
          (o.keywords?.toLowerCase().includes(q) ?? false),
      )
    : options;
  const showCreate =
    creatable &&
    query.trim().length > 0 &&
    !options.some((o) => o.label.toLowerCase() === query.trim().toLowerCase());
  const itemCount = filtered.length + (showCreate ? 1 : 0);

  // Close on outside click.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  function commit(o: ComboOption) {
    onChange(o.value);
    setOpen(false);
    setQuery("");
  }
  function commitCreate() {
    onChange(query.trim());
    setOpen(false);
    setQuery("");
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (!open && (e.key === "ArrowDown" || e.key === "Enter")) {
      setOpen(true);
      return;
    }
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setHighlight((h) => Math.min(h + 1, itemCount - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setHighlight((h) => Math.max(h - 1, 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (highlight < filtered.length) commit(filtered[highlight]);
      else if (showCreate) commitCreate();
    } else if (e.key === "Escape") {
      setOpen(false);
    }
  }

  return (
    <div ref={rootRef} className="relative">
      <div className="relative flex items-center">
        {leading && !open && (
          <span className="pointer-events-none absolute left-2.5 flex items-center">{leading}</span>
        )}
        <input
          id={id}
          aria-label={ariaLabel}
          role="combobox"
          aria-expanded={open}
          aria-controls={listboxId}
          autoComplete="off"
          className={cn(
            "flex h-9 w-full rounded-md border border-input bg-transparent px-3 py-1 text-sm shadow-sm transition-colors placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50",
            leading && !open && "pl-8",
          )}
          placeholder={placeholder}
          value={open ? query : selectedLabel}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => {
            setOpen(true);
            setQuery("");
            setHighlight(0);
          }}
          onKeyDown={onKeyDown}
        />
      </div>

      {open && (
        <ul
          id={listboxId}
          role="listbox"
          className={cn(
            "absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-md border bg-popover p-1 text-sm text-popover-foreground ring-1 ring-foreground/10",
            panelElevation,
          )}
        >
          {filtered.map((o, i) => (
            <li
              key={o.value}
              role="option"
              aria-selected={i === highlight}
              // preventDefault so the field doesn't blur before the click lands.
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHighlight(i)}
              onClick={() => commit(o)}
              className={cn(
                "flex cursor-pointer items-center gap-2 rounded-sm px-2 py-1.5",
                i === highlight ? "bg-accent text-accent-foreground" : "",
              )}
            >
              {renderOption ? renderOption(o) : o.label}
            </li>
          ))}
          {showCreate && (
            <li
              role="option"
              aria-selected={highlight === filtered.length}
              onMouseDown={(e) => e.preventDefault()}
              onMouseEnter={() => setHighlight(filtered.length)}
              onClick={commitCreate}
              className={cn(
                "flex cursor-pointer items-center gap-1 rounded-sm px-2 py-1.5",
                highlight === filtered.length ? "bg-accent text-accent-foreground" : "",
              )}
            >
              <span className="text-muted-foreground">+ Add</span>
              <span className="font-medium">&ldquo;{query.trim()}&rdquo;</span>
            </li>
          )}
          {itemCount === 0 && (
            <li className="px-2 py-1.5 text-muted-foreground">{emptyText}</li>
          )}
        </ul>
      )}
    </div>
  );
}
