"use client";

import { X } from "lucide-react";

/**
 * Prominent filter banner shown above a filtered Cycle Time table (mirrors the
 * Supplier Classification ranking banner). Destructive tint, count, clear ×.
 */
export function CycleFilterBanner({
  label,
  count,
  onClear,
}: {
  label: string;
  count: number;
  onClear: () => void;
}) {
  return (
    <div
      className="mb-3 flex items-center justify-between gap-2 rounded-lg border px-3 py-2.5 text-sm"
      style={{
        backgroundColor: "color-mix(in srgb, var(--destructive) 8%, transparent)",
        borderColor: "color-mix(in srgb, var(--destructive) 35%, transparent)",
      }}
    >
      <span>
        Filtered to <span className="font-medium">{label}</span> · {count} item
        {count === 1 ? "" : "s"}
      </span>
      <button
        type="button"
        onClick={onClear}
        className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium hover:bg-foreground/5"
      >
        Clear <X className="h-3.5 w-3.5" />
      </button>
    </div>
  );
}
