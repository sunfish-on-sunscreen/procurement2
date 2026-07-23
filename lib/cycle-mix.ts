import type { CycleTimeResult } from "@/lib/analysis-types";

/**
 * Shared derivation for the MIX-ADJUSTED reading of the cycle-time trend.
 *
 * Pooled cycle time is a WEIGHTED MIXTURE of the buying methods (spot_buy ~44d ->
 * direct ~130d), so a shift in method composition can move the pooled number while
 * the methods themselves move the other way. Measured on this data in BOTH period
 * transitions, so a naive pooled reading is not safe.
 *
 * ⚠️ This is THE single definition of "does the decomposition contradict the pooled
 * trend, and which transition do we report". The Process Health glance and the report
 * generator both consume it, so they can never disagree about whether a trend is
 * misleading — only about how they word it. Do NOT re-inline this decision.
 *
 * Returns null when there is nothing to correct: a single-period window (no
 * transition computable), or a transition whose decomposition agrees with the pooled
 * reading — in which case the existing trend prose is already honest and a second
 * sentence would merely restate it.
 */
export type MixNoteFacts = {
  from: string;
  to: string;
  /** Pooled change in days (signed). */
  pooled: number;
  /** Sum of the within-method changes, weighted to the later period (signed). */
  within: number;
  /** The composition effect (signed). */
  mix: number;
  /** "magnitude_masked" = pooled looks flat while methods moved materially;
   *  "sign_reversal"    = pooled points the opposite way to the methods. */
  reason: "sign_reversal" | "magnitude_masked";
  /** "all 5" when every method moved with the within effect, else "most". */
  quantifier: string;
  /** What the methods did: "slowed" | "improved". */
  withinWord: "slowed" | "improved";
  /** What the pooled number appeared to do. */
  pooledWord: "was nearly flat" | "rose" | "fell";
};

export function buildMixNoteFacts(cycleTime: CycleTimeResult | null | undefined): MixNoteFacts | null {
  const mt = cycleTime?.mix_adjusted_trend;
  if (!mt || mt.insufficient_data) return null;
  const trs = mt.metrics.total?.transitions;
  // The most recent transition in the window is the one the headline trend refers to.
  const t = trs && trs.length ? trs[trs.length - 1] : null;
  if (!t || !t.pooled_misleading || !t.reason) return null;

  const pooled = t.pooled_change ?? 0;
  const within = t.within_effect ?? 0;
  const mix = t.mix_effect ?? 0;
  const movers = t.per_method.filter((m) => m.within_change != null);
  const sameDir = movers.filter((m) => (m.within_change as number) * within > 0).length;
  return {
    from: t.from,
    to: t.to,
    pooled,
    within,
    mix,
    reason: t.reason,
    quantifier: movers.length > 0 && sameDir === movers.length ? `all ${movers.length}` : "most",
    withinWord: within > 0 ? "slowed" : "improved",
    pooledWord:
      t.reason === "magnitude_masked" ? "was nearly flat" : pooled > 0 ? "rose" : "fell",
  };
}

/** Signed day delta, e.g. "+2.0d" / "−3.6d". `unit` lets prose use " days". */
export function mixDays(v: number, unit = "d"): string {
  return `${v >= 0 ? "+" : "−"}${Math.abs(v).toFixed(1)}${unit}`;
}

/** Why the pooled number moved — the clause that names the cause. */
export function mixBecause(f: MixNoteFacts, longForm = false): string {
  const tail = longForm ? " buying methods, not from the process itself" : " methods";
  if (f.reason === "magnitude_masked") {
    return longForm
      ? "the difference is a shift in buying-method mix, not a change in process speed"
      : "the difference is a shift in method mix";
  }
  return `the ${f.pooled > 0 ? "rise" : "fall"} comes from a shift toward ${
    f.mix > 0 ? "slower" : "faster"
  }${tail}`;
}
