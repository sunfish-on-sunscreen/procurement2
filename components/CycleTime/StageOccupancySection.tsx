"use client";

import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";
import type { StageOccupancy } from "@/lib/cycle-time-types";
import { cardElevation } from "@/lib/utils";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { StageOccupancyChart } from "@/components/charts/StageOccupancyChart";

/**
 * Self-fetching wrapper for the fractional per-stage monthly occupancy chart.
 * Keyed state (no synchronous setState in the effect — matches the codebase's
 * eslint rule); "current" only when the result's key matches the active span, so
 * a span change shows loading immediately. Non-fatal: a failure degrades to an
 * inline message without affecting the rest of the page.
 */
export function StageOccupancySection({
  startDate,
  endDate,
}: {
  startDate: string;
  endDate: string;
}) {
  const key = `${startDate}_${endDate}`;
  const [state, setState] = useState<{ key: string; data?: StageOccupancy; err?: string } | null>(null);
  const current = state?.key === key ? state : null;

  useEffect(() => {
    let cancelled = false;
    const k = `${startDate}_${endDate}`;
    fetch(`/api/cycle-time/stage-occupancy?start=${startDate}&end=${endDate}`)
      .then(async (res) => {
        if (!res.ok) {
          throw new Error(
            ((await res.json().catch(() => ({}))) as { error?: string }).error || "Failed to load",
          );
        }
        return res.json() as Promise<StageOccupancy>;
      })
      .then((d) => {
        if (!cancelled) setState({ key: k, data: d });
      })
      .catch((e: unknown) => {
        if (!cancelled) setState({ key: k, err: e instanceof Error ? e.message : String(e) });
      });
    return () => {
      cancelled = true;
    };
  }, [startDate, endDate]);

  return (
    <Card className={cardElevation}>
      <CardHeader>
        <CardTitle>POs Active per Stage, by Month</CardTitle>
        <CardDescription>
          Time-weighted count of POs active in each procure-to-pay stage per month
          (fractional occupancy: a PO live all month counts as 1.0, split across
          its stages). &ldquo;[X] active&rdquo; means that milestone has occurred
          and the PO is in the phase after it; payment is the exit, so it is not a
          stage.
        </CardDescription>
      </CardHeader>
      <CardContent>
        {current?.err ? (
          <p className="py-6 text-center text-sm text-destructive">{current.err}</p>
        ) : !current?.data ? (
          <div className="flex items-center gap-2 py-6 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" /> Loading stage occupancy…
          </div>
        ) : current.data.months.length === 0 ? (
          <p className="py-6 text-center text-sm text-muted-foreground">
            No PO activity in this period.
          </p>
        ) : (
          <StageOccupancyChart data={current.data.months} />
        )}
      </CardContent>
    </Card>
  );
}
