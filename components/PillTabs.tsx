"use client";

import { cn } from "@/lib/utils";

/**
 * Pill-style tab switcher (decision S): a `bg-muted` (surface-1) bar with 4px
 * padding and rounded corners; the active pill gets `bg-card` (surface-2) +
 * subtle shadow + primary text. Theme-token only.
 */
export function PillTabs<T extends string>({
  tabs,
  active,
  onChange,
  className,
}: {
  tabs: readonly (readonly [T, string])[];
  active: T;
  onChange: (t: T) => void;
  className?: string;
}) {
  return (
    <div className={cn("inline-flex gap-1 rounded-[10px] bg-muted p-1", className)}>
      {tabs.map(([key, label]) => (
        <button
          key={key}
          type="button"
          onClick={() => onChange(key)}
          aria-pressed={active === key}
          className={cn(
            "rounded-lg px-3 py-1.5 text-sm transition-colors",
            active === key
              ? "bg-card font-medium text-foreground shadow-sm"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
