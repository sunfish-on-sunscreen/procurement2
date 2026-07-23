"use client";

import { useState } from "react";
import type {
  SourcingCoverageResult,
  CoverageBucket,
  CoverageMixTransition,
} from "@/lib/analysis-types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cardElevation, formatCompactCurrency } from "@/lib/utils";

const num0 = new Intl.NumberFormat("en-US");
const pct2 = (v: number | null) => (v == null ? "—" : `${v.toFixed(2)}%`);
const pts = (v: number) => `${Math.abs(v).toFixed(2)} point${Math.abs(v) === 1 ? "" : "s"}`;

/**
 * ⚠️ DELIBERATELY NEUTRAL HUES — blue / cyan / violet, NOT green-amber-red.
 *
 * A traffic-light palette would encode "competed = good, uncompeted = bad", which is
 * a claim this data does not support: every uncompeted order here is a proprietary
 * OEM item that genuinely cannot be competed. Colour is the loudest thing on a card
 * and it editorialises before a word is read, so these three read as CATEGORIES, not
 * as a score. Do not "improve" them to a red/green scale.
 */
const BUCKET_COLOR: Record<CoverageBucket, string> = {
  competed: "var(--chart-1)",
  framework: "var(--chart-6)",
  uncompeted: "var(--chart-5)",
};

const BUCKET_LABEL: Record<CoverageBucket, string> = {
  competed: "Competed",
  framework: "Under framework",
  uncompeted: "Uncompeted",
};

const BUCKET_SUB: Record<CoverageBucket, string> = {
  competed: "RFQ or tender — own sourcing event, bids, award",
  framework: "Call-off against a standing agreement",
  uncompeted: "Direct award or spot buy — no sourcing event",
};

const BUCKETS: CoverageBucket[] = ["competed", "framework", "uncompeted"];

/** Route-to-market ordering for the method table: cheapest/quickest first, so the
 *  order-size gradient reads top to bottom. */
const METHOD_ORDER = ["spot_buy", "rfq", "tender", "direct", "call_off"];
const METHOD_LABEL: Record<string, string> = {
  spot_buy: "Spot buy",
  rfq: "RFQ",
  tender: "Tender",
  direct: "Direct award",
  call_off: "Framework call-off",
};

/** Three-segment share bar. Never collapses to a single "competitive %". */
function SplitBar({ data }: { data: SourcingCoverageResult }) {
  return (
    <div className="flex h-3 w-full overflow-hidden rounded-full bg-muted">
      {BUCKETS.map((b) => {
        const pct = data.by_bucket[b].spend_pct;
        if (pct <= 0) return null;
        return (
          <div
            key={b}
            style={{ width: `${pct}%`, backgroundColor: BUCKET_COLOR[b] }}
            title={`${BUCKET_LABEL[b]} — ${pct2(pct)}`}
          />
        );
      })}
    </div>
  );
}

/** Mini share bar reused per category / supplier row. */
function MiniBar({ c, f, u }: { c: number; f: number; u: number }) {
  return (
    <div className="flex h-1.5 w-full overflow-hidden rounded-full bg-muted">
      {([["competed", c], ["framework", f], ["uncompeted", u]] as const).map(
        ([b, pct]) =>
          pct > 0 ? (
            <div
              key={b}
              style={{ width: `${pct}%`, backgroundColor: BUCKET_COLOR[b as CoverageBucket] }}
            />
          ) : null,
      )}
    </div>
  );
}

/**
 * Builds the year-over-year coverage sentence.
 *
 * ⚠️ THE FRAMING IS DERIVED, NEVER HARDCODED. Whether a coverage move is a change in
 * BEHAVIOUR (the same categories bought differently) or a change in MIX (different
 * categories bought) is exactly what the shift-share decomposition answers, and the
 * answer moves with the data. On the current dataset the 2025 fall is roughly
 * two-thirds within-category, so it reads as behaviour — but a window whose move is
 * mostly composition carries `pooled_misleading` with reason `mix_dominated`, and
 * this must then say so instead. An earlier draft of the emitter's own docstring
 * asserted mix dominance and was wrong; do not re-introduce a fixed claim here.
 *
 * ⚠️ Prints `pooled_change` and `within_effect` as emitted and calls mix "the rest",
 * rather than printing all three. The three fields are each rounded to 2dp
 * independently, so a rendered triple can be a cent off adding up; describing the
 * remainder in words is additive by construction.
 */
function coverageMove(t: CoverageMixTransition): {
  headline: string;
  detail: string;
  behavioural: boolean;
} | null {
  const change = t.pooled_change_pct;
  const within = t.within_effect_pct;
  const from = t.from_pooled_pct;
  const to = t.to_pooled_pct;
  if (change == null || within == null || from == null || to == null) return null;
  if (Math.abs(change) < 0.01) return null;

  const dir = change < 0 ? "fell" : "rose";
  const headline =
    `Competitive coverage ${dir} ${pts(change)} between ${t.from} and ${t.to} — ` +
    `${pct2(from)} to ${pct2(to)}.`;

  const mixDominated = t.pooled_misleading && t.reason === "mix_dominated";
  if (mixDominated) {
    return {
      headline,
      behavioural: false,
      detail:
        "Almost all of that is a change in WHAT was bought, not how. The categories " +
        "that grew are ones this organisation does not compete, so the move reflects " +
        "the purchasing mix rather than a change in sourcing behaviour.",
    };
  }

  // mix is DERIVED so the two printed figures always reconcile with the headline —
  // the three emitted effects are each rounded to 2dp independently, so rendering
  // them raw can show a triple that does not add up.
  const mix = change - within;
  const behavioural = Math.abs(within) >= Math.abs(mix);
  const lessMore = within < 0 ? "less" : "more";

  // ⚠️ The remainder clause is SHAPE-DETECTED, not fixed. When the within effect
  // exceeds the whole move (2025→2026: +7.45 against +7.43) the remainder is
  // NEGATIVE — mix pulled the other way — and a flat "the rest is a shift in what
  // was bought" would assert a contribution that ran backwards. Three shapes:
  // negligible, same-direction, opposing.
  const NEGLIGIBLE = 0.5; // percentage points
  const remainder =
    Math.abs(mix) < NEGLIGIBLE
      ? "Almost none of it came from a change in what was bought."
      : mix * change > 0
        ? `The remaining ${pts(mix)} is a shift in what was bought.`
        : `A shift in what was bought pulled ${pts(mix)} the other way.`;

  if (behavioural) {
    return {
      headline,
      behavioural: true,
      detail:
        `${pts(within)} of that is the same categories bought ${lessMore} competitively — ` +
        `a change in how buying was done. ${remainder}`,
    };
  }
  return {
    headline,
    behavioural: false,
    detail:
      `Most of the move is a shift in what was bought; ${pts(within)} of it is the ` +
      `same categories bought ${lessMore} competitively.`,
  };
}

export function CompetitiveCoverageCard({ data }: { data: SourcingCoverageResult }) {
  const [view, setView] = useState<"category" | "supplier">("category");

  const fw = data.by_bucket.framework;
  const bidding = data.bidding;
  const leak = data.framework_leakage;

  // Transitions ENDING inside the selected window. The decomposition itself is
  // window-independent (identical numbers on every selection); `window_periods` is
  // the display hint for which of them the reader is actually looking at.
  // ⚠️ EVERY in-window transition, not just the most recent one. Keeping only the
  // latest would silently discard the largest finding on this card whenever the
  // window spans more than one step — on the current data the full range would
  // show the 2026 recovery and drop the 2025 fall entirely.
  const competedMetric = data.mix_adjusted_coverage.metrics.competed;
  const visible = (competedMetric?.transitions ?? []).filter((t) =>
    data.mix_adjusted_coverage.window_periods.includes(t.to),
  );
  const moves = visible
    .map((t) => ({ key: `${t.from}-${t.to}`, ...(coverageMove(t) ?? {}) }))
    .filter((m): m is { key: string; headline: string; detail: string; behavioural: boolean } =>
      "headline" in m,
    );

  const methods = [...Object.entries(data.by_method)].sort(
    (a, b) => METHOD_ORDER.indexOf(a[0]) - METHOD_ORDER.indexOf(b[0]),
  );

  const ROWS = 10;
  const rows =
    view === "category"
      ? data.by_category.slice(0, ROWS).map((r) => ({
          key: r.category,
          name: r.category,
          spend: r.spend,
          pos: r.pos,
          c: r.competed_pct,
          f: r.framework_pct,
          u: r.uncompeted_pct,
        }))
      : data.by_supplier.slice(0, ROWS).map((r) => ({
          key: r.supplier_id,
          name: r.supplier_name,
          spend: r.spend,
          pos: r.pos,
          c: r.competed_pct,
          f: r.framework_pct,
          u: r.uncompeted_pct,
        }));
  // ⚠️ "N of M" — M comes from the COMPLETE emitted array, never from the slice.
  // Deriving a count from a truncated list is the documented cap trap.
  const total = view === "category" ? data.by_category.length : data.by_supplier.length;

  return (
    <Card className={cardElevation}>
      <CardHeader>
        <CardTitle>Competitive coverage</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6 text-sm">
        {/* ---- 1. The three-way split. Never one number. ---------------- */}
        <div className="space-y-3">
          <SplitBar data={data} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {BUCKETS.map((b) => (
              <div key={b} className="space-y-1">
                <div className="flex items-center gap-2">
                  <span
                    className="h-2.5 w-2.5 shrink-0 rounded-sm"
                    style={{ backgroundColor: BUCKET_COLOR[b] }}
                  />
                  <span className="font-medium">{BUCKET_LABEL[b]}</span>
                </div>
                <div className="text-lg font-semibold">{pct2(data.by_bucket[b].spend_pct)}</div>
                <div className="text-xs text-muted-foreground">
                  {formatCompactCurrency(data.by_bucket[b].spend)} ·{" "}
                  {num0.format(data.by_bucket[b].pos)} orders
                </div>
                <div className="text-xs text-muted-foreground">{BUCKET_SUB[b]}</div>
              </div>
            ))}
          </div>
        </div>

        {/* ---- 2. The framework bucket ALWAYS carries its explanation ----
            Without this a reader files call-offs under "uncompeted" and the card
            silently reports a 30% uncompeted portfolio as a 75% one. */}
        <div
          className="rounded-lg border p-3 text-xs leading-relaxed text-muted-foreground"
          style={{ backgroundColor: "color-mix(in srgb, var(--chart-6) 6%, transparent)" }}
        >
          <span className="font-medium text-foreground">
            The competitive basis of {pct2(fw.spend_pct)} of spend cannot be verified.
          </span>{" "}
          Framework call-offs draw on standing agreements that are normally competed once,
          at framework award — but framework records carry no link to the sourcing event
          that awarded them, so this dashboard cannot confirm whether they were. That is
          why the figure sits in its own bucket rather than being counted as competed or
          uncompeted: folding{" "}
          <strong className="text-foreground">{formatCompactCurrency(fw.spend)}</strong>{" "}
          either way would misstate coverage by {pct2(fw.spend_pct)}. Linking a framework
          to its awarding event would close the gap.
        </div>

        {/* ---- 3. The year-over-year move. The one behavioural reading. --- */}
        {moves.length > 0 && (
          <div className="space-y-3">
            {moves.map((m) => (
              <div
                key={m.key}
                className="rounded-lg border-l-2 py-1 pl-4"
                style={{ borderColor: BUCKET_COLOR.competed }}
              >
                <h3 className="font-medium">{m.headline}</h3>
                <p className="mt-1 text-muted-foreground">{m.detail}</p>
              </div>
            ))}
            {moves.some((m) => m.behavioural) && (
              <p className="pl-4 text-xs italic text-muted-foreground">
                Separating the two matters: a coverage move caused by buying more
                proprietary equipment says nothing about how buying was done, whereas the
                same categories bought less competitively does.
              </p>
            )}
          </div>
        )}

        {/* ---- 4. Order size by route. STRUCTURAL — the OEM note sits
                   ADJACENT (above the table), never as a footnote below it. --- */}
        <div className="space-y-2">
          <h3 className="font-medium">Order size by route to market</h3>
          <p className="text-xs leading-relaxed text-muted-foreground">
            Order size tracks the route to market — the largest orders are sole-source
            equipment and framework call-offs, the smallest are spot buys. This describes{" "}
            <em>what</em> is bought, not how well it is bought: every direct award in this
            data carries a proprietary or OEM sole-source justification, and an OEM part
            cannot be competed by definition.
          </p>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium">Route</th>
                  <th className="py-2 pr-3 font-medium">Bucket</th>
                  <th className="py-2 pr-3 text-right font-medium">Orders</th>
                  <th className="py-2 pr-3 text-right font-medium">Spend</th>
                  <th className="py-2 pr-3 text-right font-medium">Share</th>
                  <th className="py-2 text-right font-medium">Median order</th>
                </tr>
              </thead>
              <tbody>
                {methods.map(([m, v]) => (
                  <tr key={m} className="border-b last:border-0">
                    <td className="py-2 pr-3 font-medium">{METHOD_LABEL[m] ?? m}</td>
                    <td className="py-2 pr-3">
                      {v.bucket ? (
                        <span
                          className="rounded-md px-1.5 py-0.5"
                          style={{
                            color: BUCKET_COLOR[v.bucket],
                            backgroundColor: `color-mix(in srgb, ${BUCKET_COLOR[v.bucket]} 12%, transparent)`,
                          }}
                        >
                          {BUCKET_LABEL[v.bucket]}
                        </span>
                      ) : (
                        <span className="text-muted-foreground">—</span>
                      )}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{num0.format(v.pos)}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatCompactCurrency(v.spend)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{pct2(v.spend_pct)}</td>
                    <td className="py-2 text-right tabular-nums">
                      {v.median_po_value == null ? "—" : formatCompactCurrency(v.median_po_value)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>

        {/* ---- 5. Category / supplier toggle ---------------------------- */}
        <div className="space-y-2">
          <div className="flex items-center justify-between gap-3">
            <h3 className="font-medium">Coverage by {view}</h3>
            <div className="flex gap-1 rounded-md bg-muted p-0.5 text-xs">
              {(["category", "supplier"] as const).map((v) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setView(v)}
                  aria-pressed={view === v}
                  className={`rounded px-2 py-1 capitalize transition-colors ${
                    view === v
                      ? "bg-card font-medium text-foreground shadow-sm"
                      : "text-muted-foreground hover:text-foreground"
                  }`}
                >
                  By {v}
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-xs">
              <thead>
                <tr className="border-b text-left text-muted-foreground">
                  <th className="py-2 pr-3 font-medium capitalize">{view}</th>
                  <th className="py-2 pr-3 text-right font-medium">Spend</th>
                  <th className="py-2 pr-3 text-right font-medium">Orders</th>
                  <th className="w-[34%] py-2 pr-3 font-medium">Split</th>
                  <th className="py-2 text-right font-medium">Competed</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => (
                  <tr key={r.key} className="border-b last:border-0">
                    <td className="py-2 pr-3">{r.name}</td>
                    <td className="py-2 pr-3 text-right tabular-nums">
                      {formatCompactCurrency(r.spend)}
                    </td>
                    <td className="py-2 pr-3 text-right tabular-nums">{num0.format(r.pos)}</td>
                    <td className="py-2 pr-3">
                      <MiniBar c={r.c} f={r.f} u={r.u} />
                    </td>
                    <td className="py-2 text-right tabular-nums">{pct2(r.c)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-muted-foreground">
            Showing the {rows.length} largest of {total} by spend. Coverage varies mostly
            with what each {view} buys, not with how carefully it is bought.
          </p>
        </div>

        {/* ---- 6. Descriptives + the live framework check ---------------- */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div className="space-y-1 rounded-lg border p-3">
            <h3 className="text-xs font-medium">How the competitive processes ran</h3>
            <p className="text-xs text-muted-foreground">
              {num0.format(bidding.events)} sourcing events drew{" "}
              {num0.format(bidding.responses)} bids — an average of{" "}
              {bidding.avg_bids?.toFixed(1) ?? "—"}
              {bidding.min_bids != null && bidding.max_bids != null
                ? ` (range ${bidding.min_bids}–${bidding.max_bids})`
                : ""}
              . Quotes within an event spread {pct2(bidding.avg_quote_spread_pct)} on average.
            </p>
            {/* ⚠️ NO CUT OF THIS NUMBER EXISTS, and none may be added. Spread is an
                order statistic of the BID COUNT, so any category/supplier breakdown
                would report the bid-count mix wearing another label. */}
            <p className="text-xs italic text-muted-foreground">
              Descriptive only. Spread widens with the number of bidders, so it is not
              comparable between categories or suppliers.
            </p>
          </div>
          <div className="space-y-1 rounded-lg border p-3">
            <h3 className="text-xs font-medium">Framework discipline</h3>
            <p className="text-xs text-muted-foreground">
              {num0.format(leak.outside_window)} of {num0.format(leak.calloffs)} call-offs (
              {formatCompactCurrency(leak.outside_window_spend)}) were placed outside their
              framework&rsquo;s validity window.
            </p>
            <p className="text-xs italic text-muted-foreground">
              A live check. The validity window is not enforced when an order is written,
              so this reports a known property of the current data rather than a newly
              detected breach.
            </p>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}
