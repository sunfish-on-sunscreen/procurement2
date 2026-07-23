import type { SourcingCoverageResult, CoverageBucket } from "@/lib/analysis-types";
import type { ReportTone } from "@/lib/report-config";
import { visibleCoverageMoves, pts } from "@/lib/coverage-copy";

/**
 * Tone-aware prose for the competitive-coverage APPENDIX block. Mirrors
 * lib/report-narrative's shape: build a tone-agnostic fact model, then choose a
 * register. Appendix EVIDENCE only — coverage deliberately contributes no ranked
 * finding to the report's argument, because the data that would justify one (a
 * defensible price penalty for not competing) does not exist here.
 *
 * ⚠️ THE COPY DISCIPLINE HOLDS IN ALL THREE TONES, and three registers means three
 * chances to blur it. Every tone must:
 *   1. render the split as THREE buckets — never a single "competitive %";
 *   2. carry the framework explanation wherever the framework share appears;
 *   3. state the year-over-year move as BEHAVIOUR only when the shift-share says so;
 *   4. state order-size-by-route as STRUCTURAL, with the OEM reason attached;
 *   5. attach no cut to the bidding descriptives.
 */

const usdM = (n: number) => `$${(n / 1_000_000).toFixed(1)}M`;
const pct1 = (n: number | null) => (n == null ? "—" : `${n.toFixed(1)}%`);
const pct2 = (n: number | null) => (n == null ? "—" : `${n.toFixed(2)}%`);
const int = new Intl.NumberFormat("en-US");

export const COVERAGE_BUCKET_LABEL: Record<CoverageBucket, string> = {
  competed: "Competed",
  framework: "Under framework",
  uncompeted: "Uncompeted",
};

export const COVERAGE_METHOD_LABEL: Record<string, string> = {
  spot_buy: "Spot buy",
  rfq: "RFQ",
  tender: "Tender",
  direct: "Direct award",
  call_off: "Framework call-off",
};

/** Route ordering: smallest typical order first, so the size gradient reads down. */
export const COVERAGE_METHOD_ORDER = ["spot_buy", "rfq", "tender", "direct", "call_off"];

export type CoverageAppendix = {
  /** Opening paragraph. Always names all three shares. */
  split: string;
  /** The framework bucket's explanation + the data gap, stated as a finding. */
  dataGap: string;
  /** One paragraph per in-window transition. Empty when the window has no prior. */
  moves: string[];
  /** Order-size-by-route framing. STRUCTURAL — must precede the table. */
  structure: string;
  /** Bidding descriptives + the no-cuts caveat, as one paragraph. */
  bidding: string;
  /** Framework validity-window check. */
  leakage: string;
  /**
   * What is deliberately NOT measured, with the numbers that rule each one out.
   *
   * ⚠️ CARRIED HERE because the standalone /methodology page — which holds the full
   * version of this list — is gated behind SHOW_METHODOLOGY and is currently off.
   * The report appendix is a separate surface that the flag does not affect, so
   * without this paragraph the exclusions would be documented nowhere a reader can
   * actually reach. Keep the two in sync if either changes.
   */
  exclusions: string;
};

export function renderCoverageAppendix(
  c: SourcingCoverageResult,
  tone: ReportTone,
): CoverageAppendix {
  const comp = c.by_bucket.competed;
  const fw = c.by_bucket.framework;
  const unc = c.by_bucket.uncompeted;
  const b = c.bidding;
  const leak = c.framework_leakage;
  const moves = visibleCoverageMoves(c);

  // ---- 1. the three-way split ------------------------------------------- #
  const split =
    tone === "executive"
      ? `Of ${usdM(c.total_spend)} in the period, ${pct1(comp.spend_pct)} was competitively ` +
        `sourced, ${pct1(fw.spend_pct)} drew on framework agreements and ` +
        `${pct1(unc.spend_pct)} was awarded without a sourcing event. The three are ` +
        `reported separately; they do not reduce to a single coverage figure.`
      : tone === "analytical"
        ? `Coverage is measured over ${int.format(c.total_pos)} orders totalling ` +
          `${usdM(c.total_spend)}, partitioned by buying method into three mutually ` +
          `exclusive buckets: competed (RFQ, tender) ${pct2(comp.spend_pct)} — ` +
          `${usdM(comp.spend)} across ${int.format(comp.pos)} orders; under framework ` +
          `(call-off) ${pct2(fw.spend_pct)} — ${usdM(fw.spend)} across ` +
          `${int.format(fw.pos)}; uncompeted (direct award, spot buy) ` +
          `${pct2(unc.spend_pct)} — ${usdM(unc.spend)} across ${int.format(unc.pos)}. ` +
          `Shares are spend-weighted; the order-count split differs because order size ` +
          `varies sharply by route.`
        : `${pct1(comp.spend_pct)} of spend (${usdM(comp.spend)}, ` +
          `${int.format(comp.pos)} orders) was competitively sourced through an RFQ or ` +
          `tender. ${pct1(fw.spend_pct)} (${usdM(fw.spend)}) drew on framework ` +
          `agreements, and ${pct1(unc.spend_pct)} (${usdM(unc.spend)}) was awarded ` +
          `directly or bought on the spot without a sourcing event.`;

  // ---- 2. the framework bucket + the data gap ---------------------------- #
  // ⚠️ REQUIRED IN EVERY TONE. Without it a reader files call-offs under
  // "uncompeted" and reads a 30% uncompeted portfolio as a 75% one.
  const dataGap =
    tone === "executive"
      ? `The framework share is reported on its own because its competitive basis ` +
        `cannot be verified. Framework records carry no link to the sourcing event ` +
        `that awarded them, leaving ${usdM(fw.spend)} — ${pct1(fw.spend_pct)} of ` +
        `spend — that cannot be confirmed either way. Adding that link is the single ` +
        `largest measurement improvement available.`
      : tone === "analytical"
        ? `The framework bucket is not folded into either side because the schema ` +
          `cannot support the assignment. A call-off draws on an agreement normally ` +
          `awarded competitively once, but the Framework record holds no reference to ` +
          `an awarding sourcing event, so competitive status is unobservable for ` +
          `${usdM(fw.spend)} (${pct2(fw.spend_pct)} of spend, ${int.format(fw.pos)} ` +
          `orders). Collapsing to a competed/uncompeted binary would introduce a ` +
          `${pct2(fw.spend_pct)} error in whichever direction it were resolved. ` +
          `Recommended schema change: a nullable awarding-event reference on Framework, ` +
          `which would make the bucket resolvable without altering any existing measure.`
        : `The framework share is reported separately because its competitive basis ` +
          `cannot be verified: a call-off draws on an agreement normally competed once ` +
          `at award, but framework records carry no link to the sourcing event that ` +
          `awarded them. That leaves ${usdM(fw.spend)} — ${pct1(fw.spend_pct)} of all ` +
          `spend — that can be neither confirmed nor denied as competed. Linking a ` +
          `framework to its awarding event would close the largest measurement gap here.`;

  // ---- 3. the year-over-year move — the one BEHAVIOURAL reading ---------- #
  // ⚠️ Behaviour vs mix is NEVER asserted; it comes from the shared classifier, so
  // this appendix cannot contradict the dashboard the report was generated from.
  const moveParas = moves.map((v) => {
    const dirWord = v.direction;
    const lessMore = v.withinPts < 0 ? "less" : "more";
    if (v.mixDominated) {
      return (
        `Competitive coverage ${dirWord} ${pts(v.changePts)} between ${v.from} and ` +
        `${v.to} (${pct2(v.fromPct)} to ${pct2(v.toPct)}), but almost all of that is a ` +
        `change in what was bought rather than how. The categories that grew are ones ` +
        `this organisation does not compete, so the movement reflects purchasing mix, ` +
        `not sourcing behaviour, and should not be read as one.`
      );
    }
    const remainder =
      v.shape === "negligible"
        ? "Almost none of it came from a change in what was bought."
        : v.shape === "aligned"
          ? `The remaining ${pts(v.mixPts)} is a shift in what was bought.`
          : `A shift in what was bought pulled ${pts(v.mixPts)} the other way.`;

    if (!v.behavioural) {
      return (
        `Competitive coverage ${dirWord} ${pts(v.changePts)} between ${v.from} and ` +
        `${v.to} (${pct2(v.fromPct)} to ${pct2(v.toPct)}). Most of that is a shift in ` +
        `what was bought; ${pts(v.withinPts)} of it is the same categories bought ` +
        `${lessMore} competitively.`
      );
    }
    if (tone === "analytical") {
      return (
        `Competitive coverage ${dirWord} ${pts(v.changePts)} between ${v.from} and ` +
        `${v.to} (${pct2(v.fromPct)} to ${pct2(v.toPct)}). A shift-share decomposition ` +
        `over category — weight = category share of period spend, rate = the bucket's ` +
        `share of that category's spend — attributes ${pts(v.withinPts)} to the WITHIN ` +
        `effect and the balance to MIX. ${remainder} The within component is the ` +
        `behavioural one: the same categories bought ${lessMore} competitively. The ` +
        `decomposition is an exact arithmetic identity and carries no significance test.`
      );
    }
    if (tone === "executive") {
      return (
        `Competitive coverage ${dirWord} ${pts(v.changePts)} between ${v.from} and ` +
        `${v.to}. ${pts(v.withinPts)} of that is the same categories bought ` +
        `${lessMore} competitively — a change in how buying was done, not in what was ` +
        `bought. ${remainder}`
      );
    }
    return (
      `Competitive coverage ${dirWord} ${pts(v.changePts)} between ${v.from} and ` +
      `${v.to} (${pct2(v.fromPct)} to ${pct2(v.toPct)}). ${pts(v.withinPts)} of that ` +
      `is the same categories bought ${lessMore} competitively — a change in how ` +
      `buying was done. ${remainder}`
    );
  });

  // ---- 4. order size by route — STRUCTURAL, with the OEM reason ---------- #
  // ⚠️ The OEM explanation is part of THIS string in every tone, so it can never be
  // separated from the figures it explains by a layout change.
  const structure =
    tone === "executive"
      ? `Order size tracks the route to market: the largest orders are sole-source ` +
        `equipment and framework call-offs, the smallest are spot buys. This describes ` +
        `what is bought, not how well it is bought — every direct award in this data ` +
        `carries a proprietary or OEM sole-source justification, and an OEM part cannot ` +
        `be competed.`
      : tone === "analytical"
        ? `Median order value increases monotonically across routes, from spot buy to ` +
          `framework call-off. The association is structural rather than behavioural: ` +
          `buying method is near-deterministic in category on this data, and every ` +
          `direct award carries a proprietary/OEM sole-source justification. An OEM ` +
          `component has no substitutable competing supply, so the absence of ` +
          `competition on those orders is a property of the item, not an outcome of ` +
          `the sourcing process. No inference about buyer discipline is available here.`
        : `Order size tracks the route to market — the largest orders are sole-source ` +
          `equipment and framework call-offs, the smallest are spot buys. This ` +
          `describes what is bought, not how well it is bought: every direct award in ` +
          `this data carries a proprietary or OEM sole-source justification, and an OEM ` +
          `part cannot be competed by definition.`;

  // ---- 5. bidding descriptives — NO CUTS, in any tone -------------------- #
  const depth =
    b.min_bids != null && b.max_bids != null ? ` (range ${b.min_bids}–${b.max_bids})` : "";
  const bidding =
    b.events === 0
      ? "No competitive sourcing events fall in this period."
      : tone === "analytical"
        ? `${int.format(b.events)} sourcing events drew ${int.format(b.responses)} bids, ` +
          `averaging ${b.avg_bids?.toFixed(1) ?? "—"}${depth}. Mean intra-event quote ` +
          `spread is ${pct2(b.avg_quote_spread_pct)} (median ` +
          `${pct2(b.median_quote_spread_pct)}). Reported at portfolio level only and ` +
          `deliberately not broken down: spread is an order statistic of the bid count, ` +
          `so it rises mechanically with the number of bidders and is flat across ` +
          `category, supplier and period once bid count is held constant. Any ` +
          `breakdown would report the bid-count mix under another label.`
        : `${int.format(b.events)} sourcing events drew ${int.format(b.responses)} bids ` +
          `— an average of ${b.avg_bids?.toFixed(1) ?? "—"}${depth}. Quotes within an ` +
          `event spread ${pct2(b.avg_quote_spread_pct)} on average. These are ` +
          `descriptive only: spread widens with the number of bidders, so it is not ` +
          `comparable between categories or suppliers and is not broken down by either.`;

  // ---- 6. framework validity check --------------------------------------- #
  const leakage =
    leak.calloffs === 0
      ? "No framework call-offs fall in this period."
      : `${int.format(leak.outside_window)} of ${int.format(leak.calloffs)} call-offs ` +
        `(${usdM(leak.outside_window_spend)}) were placed outside their framework's ` +
        `validity window. The window is not enforced when an order is written, so this ` +
        `reports a known property of the current data rather than a newly detected ` +
        `breach.`;

  // ---- 7. what is deliberately NOT measured ------------------------------ #
  // Every figure below was measured before the metric was rejected, not assumed.
  const exclusions =
    tone === "executive"
      ? `Several standard coverage metrics are deliberately not reported because they ` +
        `are degenerate on this data: every award went to the lowest quote (226 of ` +
        `226), no event drew fewer than two bids, and every invited supplier responded. ` +
        `Quote spread is not broken down because it scales with the number of bidders ` +
        `rather than with the category or supplier. A price penalty for not competing ` +
        `is not reported either — measured across the items bought both ways it is ` +
        `noise, with more than half of them cheaper when uncompeted.`
      : tone === "analytical"
        ? `Excluded measures, each tested rather than assumed. Award-to-cheapest: 226 of ` +
          `226 awards at price rank 1, a universal pass. Single-bid exposure: minimum ` +
          `bid count is 2 (31 events at 2, 165 at 3, 30 at 4), permanently zero. Bid ` +
          `response rate: invited equals responded in every event, a constant 100%. ` +
          `Quote-spread breakdowns: spread is an order statistic of bid count (9.22% at ` +
          `2 bids, 12.80% at 3, 13.06% at 4); holding bid count at 3 the between-category ` +
          `range (11.15–13.44) is under half a within-category standard deviation ` +
          `(3.2–4.4) and the period cut is flat (12.85 / 12.71 / 12.84). Savings versus ` +
          `the field: deterministic given the award rule, and scoped to one line ` +
          `averaging 64.66% of order value, so the $7.36M advantage sits against $113.3M ` +
          `of awarded-line value and must never be scaled onto competed spend. ` +
          `Competed-vs-uncompeted price premium: mean +4.58%, median −6.98%, sd 61.96%, ` +
          `with 14 of 26 items CHEAPER uncompeted against 12 dearer — scatter roughly ` +
          `13× the effect. Sole-source challengeability: the category roster is too ` +
          `coarse a proxy for item substitutability. Pre-close order dates: 51 of 226 ` +
          `events, but close-to-order spans −8 to +15 days, i.e. independent draws.`
        : `Several standard coverage metrics were tested and deliberately excluded ` +
          `because they are degenerate here. Every award went to the lowest quote (226 ` +
          `of 226); no event drew fewer than two bids, so single-bid exposure is always ` +
          `zero; and every invited supplier responded, so the response rate is always ` +
          `100%. Quote spread is reported only at portfolio level because it scales with ` +
          `the number of bidders (9.22% at 2 bids, 12.80% at 3, 13.06% at 4) and is flat ` +
          `across categories and periods once bid count is held constant. A price ` +
          `penalty for not competing is not reported: across the 26 items bought both ` +
          `ways the mean is +4.58% but the median is −6.98% with a standard deviation of ` +
          `61.96%, and 14 of the 26 are actually CHEAPER uncompeted — the scatter is ` +
          `about thirteen times the effect, so the sign depends on which items are picked.`;

  return { split, dataGap, moves: moveParas, structure, bidding, leakage, exclusions };
}
