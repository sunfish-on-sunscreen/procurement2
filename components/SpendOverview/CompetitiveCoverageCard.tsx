"use client";

import { useState } from "react";
import type { SourcingCoverageResult, CoverageBucket } from "@/lib/analysis-types";
import {
  visibleCoverageMoves,
  pts,
  type CoverageMoveVerdict,
} from "@/lib/coverage-copy";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cardElevation, formatCompactCurrency } from "@/lib/utils";

const num0 = new Intl.NumberFormat("en-US");
const pct2 = (v: number | null) => (v == null ? "—" : `${v.toFixed(2)}%`);

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
 * Renders one move verdict in the dashboard's register.
 *
 * ⚠️ The behaviour-vs-mix CLASSIFICATION is not made here — it comes from
 * `classifyCoverageMove` in lib/coverage-copy, shared with the report appendix, so
 * a generated report can never contradict the page it came from. This function only
 * chooses words for a verdict already reached.
 */
function moveCopy(v: CoverageMoveVerdict): { headline: string; detail: string } {
  const headline =
    `Competitive coverage ${v.direction} ${pts(v.changePts)} between ${v.from} and ` +
    `${v.to} — ${pct2(v.fromPct)} to ${pct2(v.toPct)}.`;

  if (v.mixDominated) {
    return {
      headline,
      detail:
        "Almost all of that is a change in what was bought, not how. The categories " +
        "that grew are ones this organisation does not compete, so the move reflects " +
        "the purchasing mix rather than a change in sourcing behaviour.",
    };
  }

  const lessMore = v.withinPts < 0 ? "less" : "more";
  const remainder =
    v.shape === "negligible"
      ? "Almost none of it came from a change in what was bought."
      : v.shape === "aligned"
        ? `The remaining ${pts(v.mixPts)} is a shift in what was bought.`
        : `A shift in what was bought pulled ${pts(v.mixPts)} the other way.`;

  if (v.behavioural) {
    return {
      headline,
      detail:
        `${pts(v.withinPts)} of that is the same categories bought ${lessMore} ` +
        `competitively — a change in how buying was done. ${remainder}`,
    };
  }
  return {
    headline,
    detail:
      `Most of the move is a shift in what was bought; ${pts(v.withinPts)} of it is ` +
      `the same categories bought ${lessMore} competitively.`,
  };
}

export function CompetitiveCoverageCard({ data }: { data: SourcingCoverageResult }) {
  const [view, setView] = useState<"category" | "supplier">("category");

  const fw = data.by_bucket.framework;
  const bidding = data.bidding;
  const leak = data.framework_leakage;

  // Shared with the report appendix — see lib/coverage-copy. Returns every
  // in-window transition (not just the latest) so a multi-step window cannot
  // silently drop its largest finding.
  const moves = visibleCoverageMoves(data).map((v) => ({
    key: `${v.from}-${v.to}`,
    behavioural: v.behavioural,
    ...moveCopy(v),
  }));

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
