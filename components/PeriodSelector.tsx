"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  PERIOD_COOKIE,
  type PeriodMode,
  type PeriodSelection,
} from "@/lib/period-constants";

export type PeriodOption = { id: string; name: string };

function YearSelect({
  value,
  onChange,
  periods,
  placeholder,
}: {
  value: string | null;
  onChange: (value: string | null) => void;
  periods: PeriodOption[];
  placeholder: string;
}) {
  return (
    <Select
      items={periods.map((p) => ({ value: p.id, label: p.name }))}
      value={value ?? undefined}
      onValueChange={onChange}
    >
      <SelectTrigger className="w-[120px]">
        <SelectValue placeholder={placeholder} />
      </SelectTrigger>
      <SelectContent>
        {periods.map((p) => (
          <SelectItem key={p.id} value={p.id}>
            {p.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}

export function PeriodSelector({
  periods,
  selection,
}: {
  periods: PeriodOption[];
  selection: PeriodSelection;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<PeriodMode>(selection.mode);
  const [singleId, setSingleId] = useState<string | null>(selection.singleId);
  const [fromId, setFromId] = useState<string | null>(selection.fromId);
  const [toId, setToId] = useState<string | null>(selection.toId);

  const yearById = new Map(periods.map((p) => [p.id, Number(p.name)]));
  const rangeInvalid =
    mode === "range" &&
    fromId != null &&
    toId != null &&
    (yearById.get(fromId) ?? 0) > (yearById.get(toId) ?? 0);

  function commit(next: PeriodSelection) {
    // Block persisting an invalid range (from > to); the UI shows the error.
    if (
      next.mode === "range" &&
      next.fromId != null &&
      next.toId != null &&
      (yearById.get(next.fromId) ?? 0) > (yearById.get(next.toId) ?? 0)
    ) {
      return;
    }
    document.cookie = `${PERIOD_COOKIE}=${encodeURIComponent(
      JSON.stringify(next),
    )}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    router.refresh();
  }

  return (
    <div className="flex items-center gap-2">
      <div className="flex gap-0.5 rounded-md border p-0.5">
        <Button
          type="button"
          size="sm"
          variant={mode === "single" ? "default" : "ghost"}
          onClick={() => {
            setMode("single");
            commit({ mode: "single", singleId, fromId, toId });
          }}
        >
          Single Year
        </Button>
        <Button
          type="button"
          size="sm"
          variant={mode === "range" ? "default" : "ghost"}
          onClick={() => {
            setMode("range");
            commit({ mode: "range", singleId, fromId, toId });
          }}
        >
          Range
        </Button>
      </div>

      {mode === "single" ? (
        <YearSelect
          value={singleId}
          placeholder="Year"
          periods={periods}
          onChange={(v) => {
            setSingleId(v);
            commit({ mode: "single", singleId: v, fromId, toId });
          }}
        />
      ) : (
        <div className="flex items-center gap-1">
          <YearSelect
            value={fromId}
            placeholder="From"
            periods={periods}
            onChange={(v) => {
              setFromId(v);
              commit({ mode: "range", singleId, fromId: v, toId });
            }}
          />
          <span className="text-sm text-muted-foreground">to</span>
          <YearSelect
            value={toId}
            placeholder="To"
            periods={periods}
            onChange={(v) => {
              setToId(v);
              commit({ mode: "range", singleId, fromId, toId: v });
            }}
          />
        </div>
      )}

      {rangeInvalid && (
        <span className="text-xs text-destructive">From must be ≤ To</span>
      )}
    </div>
  );
}
