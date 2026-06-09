"use client";

import { useRouter } from "next/navigation";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { PERIOD_COOKIE } from "@/lib/period-constants";

export type PeriodOption = { id: string; name: string };

export function PeriodSelector({
  periods,
  currentPeriodId,
}: {
  periods: PeriodOption[];
  currentPeriodId: string | null;
}) {
  const router = useRouter();

  function handleChange(value: string | null) {
    if (!value) return;
    // Non-httpOnly cookie so it is readable by server components on the next
    // request; one-year max-age. router.refresh() re-runs server components.
    document.cookie = `${PERIOD_COOKIE}=${value}; path=/; max-age=${60 * 60 * 24 * 365}; samesite=lax`;
    router.refresh();
  }

  return (
    <Select
      items={periods.map((period) => ({
        value: period.id,
        label: period.name,
      }))}
      value={currentPeriodId ?? undefined}
      onValueChange={handleChange}
    >
      <SelectTrigger className="w-[220px]">
        <SelectValue placeholder="Select period" />
      </SelectTrigger>
      <SelectContent>
        {periods.map((period) => (
          <SelectItem key={period.id} value={period.id}>
            {period.name}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
