"use client";

import { ArrowUp, ArrowDown, Minus, ChevronDown } from "lucide-react";
import type { SpendDetail } from "@/lib/spend-overview-types";
import { StatBlock } from "@/components/ui/stat-block";

// Signed performance delta vs the previous period (A5): green ↑, red ↓, muted →;
// always 2 decimals. Rendered INLINE inside the sublabel ("↑ +9.69").
function PerfDelta({ delta }: { delta: number }) {
  const r = Math.round(delta * 100) / 100;
  const cls =
    r > 0
      ? "text-green-600 dark:text-green-500"
      : r < 0
        ? "text-red-600 dark:text-red-500"
        : "text-muted-foreground";
  const Icon = r > 0 ? ArrowUp : r < 0 ? ArrowDown : Minus;
  return (
    <span className={`inline-flex items-center gap-0.5 font-medium ${cls}`}>
      <Icon className="h-3 w-3" />
      {r > 0 ? "+" : ""}
      {r.toFixed(2)}
    </span>
  );
}

/**
 * Clickable performance-score StatBlock shared by both detail panels. Renders
 * the P2 layout (value `/ out of 100` + period/context sublabel) and a chevron
 * toggle; the EXPANDED content (raw inputs) is rendered by the parent below the
 * surrounding grid so it can span full width. `open`/`onToggle` are controlled
 * by the parent so it owns reset-on-supplier-change.
 */
export function PerformanceScoreCard({
  perf,
  open,
  onToggle,
  showHint = false,
}: {
  perf: SpendDetail["supplier"]["performance"];
  open: boolean;
  onToggle: () => void;
  /** "Click for breakdown" hint — shown only while collapsed and never-expanded. */
  showHint?: boolean;
}) {
  const hasScore = perf.score != null;
  const delta =
    perf.mode === "single" && perf.score != null && perf.previousScore != null
      ? perf.score - perf.previousScore
      : null;

  let sublabel: React.ReactNode;
  if (!hasScore) {
    sublabel = `No score in ${perf.periodLabel ?? "this period"}`;
  } else if (perf.mode === "single") {
    sublabel =
      perf.previousScore != null && perf.previousLabel ? (
        <>
          {perf.periodLabel} · <PerfDelta delta={delta!} /> vs {perf.previousLabel} (
          {perf.previousScore.toFixed(2)})
        </>
      ) : (
        <>{perf.periodLabel ?? "this period"} · first year on record</>
      );
  } else if (perf.mode === "range") {
    sublabel =
      perf.latestScore != null && perf.latestLabel ? (
        <>
          {perf.periodLabel} · Latest active ({perf.latestLabel}):{" "}
          {perf.latestScore.toFixed(2)}
        </>
      ) : (
        <>{perf.periodLabel}</>
      );
  } else {
    sublabel = "latest snapshot";
  }

  return (
    <button
      type="button"
      onClick={onToggle}
      aria-expanded={open}
      className="relative block w-full cursor-pointer text-left"
      title={open ? "Hide score inputs" : "Show score inputs"}
    >
      <StatBlock
        label="Performance score"
        value={
          hasScore ? (
            <span>
              {perf.score!.toFixed(2)}{" "}
              <span className="whitespace-nowrap text-sm font-normal text-muted-foreground">
                / out of 100
              </span>
            </span>
          ) : (
            "—"
          )
        }
        sublabel={sublabel}
      />
      {showHint && (
        <p className="mt-1 px-1 text-[11px] italic text-muted-foreground">
          Click for breakdown
        </p>
      )}
      <ChevronDown
        className={`pointer-events-none absolute right-3 top-3 h-4 w-4 text-muted-foreground transition-transform ${
          open ? "rotate-180" : ""
        }`}
      />
    </button>
  );
}
