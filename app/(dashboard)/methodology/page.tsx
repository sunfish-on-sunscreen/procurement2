import { requireAuth } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { cardElevation } from "@/lib/utils";

export default async function MethodologyPage() {
  await requireAuth();

  return (
    <div className="flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="text-2xl font-semibold">Methodology</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          How this dashboard analyzes mining procurement data, and the sources
          behind it.
        </p>
      </div>

      {/* 1. Project Background */}
      <Card className={cardElevation}>
        <CardHeader>
          <CardTitle>1. Project Background</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            This dashboard analyzes procurement activity for a mid-sized
            Indonesian coal-mining operation — the suppliers it buys from, the
            purchase orders it raises, and how those orders move through the
            procure-to-pay (P2P) lifecycle.
          </p>
          <p>
            Procurement in heavy industry is high-stakes and high-volume: a small
            number of strategic suppliers account for the bulk of spend, late
            deliveries can halt production, and manual processes create payment
            delays and exception rework. The dashboard addresses three blind
            spots that procurement teams typically struggle with — visibility
            into <strong>spend concentration</strong>, into{" "}
            <strong>supplier quality and risk</strong>, and into{" "}
            <strong>process efficiency</strong> — by turning raw transaction data
            into three fixed, defensible analyses.
          </p>
          <p>
            The underlying data is synthetic, but it is calibrated against
            published industry benchmarks so that the patterns (spend skew, cycle
            times, quality distributions) are realistic and the analytical methods
            can be demonstrated meaningfully.
          </p>
        </CardContent>
      </Card>

      {/* 2. Data Sources */}
      <Card className={cardElevation}>
        <CardHeader>
          <CardTitle>2. Data Sources</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <div className="rounded-md border-l-4 border-primary bg-muted/50 p-3 font-medium text-foreground">
            This dashboard uses synthetic data generated for demonstration
            purposes. The data has been calibrated against industry benchmarks for
            realism.
          </div>
          <p>The calibration sources are:</p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>APQC Open Standards Benchmarking</strong> — procure-to-pay
              cycle times.
            </li>
            <li>
              <strong>Hackett Group P2P automation case studies</strong> —
              automation impact metrics.
            </li>
            <li>
              <strong>CIPS Knowledge Hub supplier scorecard methodology</strong> —
              quality and risk weighting.
            </li>
            <li>
              <strong>MOPS Singapore</strong> (Mean of Platts Singapore) — fuel
              pricing benchmarks.
            </li>
            <li>
              <strong>AME mining cost reports</strong> — commodity pricing
              reference.
            </li>
          </ul>
          <p>
            The dataset was originally generated externally (the generator is
            not in this repository). The import path takes{" "}
            <strong>raw operational measurements only</strong>; every scorecard
            value is then <strong>computed server-side at import</strong> by{" "}
            <code>python/scores.py</code>, deterministically, so each stored score
            is reproducible from the underlying records. A full from-scratch
            generator is planned for a future phase.
          </p>
        </CardContent>
      </Card>

      {/* 3. The Four Analyses */}
      <Card className={cardElevation}>
        <CardHeader>
          <CardTitle>3. The Four Analyses</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 text-sm leading-relaxed text-muted-foreground">
          <section className="space-y-2">
            <h3 className="text-base font-semibold text-foreground">
              3.1 ABC / Pareto Analysis
            </h3>
            <p>
              Classifies suppliers by their cumulative contribution to total
              spend. Suppliers are ranked from highest to lowest spend, and the
              running cumulative percentage determines each supplier&apos;s class
              using <strong>fixed thresholds</strong>:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>Class A</strong> — the suppliers making up the top 80% of
                spend (strategic, high-touch).
              </li>
              <li>
                <strong>Class B</strong> — the next 15% of spend (preferred,
                periodic review).
              </li>
              <li>
                <strong>Class C</strong> — the bottom 5% of spend (tail,
                consolidation candidates).
              </li>
            </ul>
            <p>
              Output includes each supplier&apos;s rank, % of spend, cumulative %,
              ABC class.
            </p>
            <p className="text-xs">
              Reference: Juran&apos;s Pareto principle (1951); CIPS spend-analysis
              methodology.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-base font-semibold text-foreground">
              3.2 Kraljic Matrix Segmentation
            </h3>
            <p>
              A deterministic, two-axis segmentation that maps each supplier onto
              the classic Kraljic purchasing portfolio matrix:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>Profit Impact</strong> (X-axis) — supplier share of total
                spend (%), shown on a log scale so suppliers spread readably;
                high/low split at the median.
              </li>
              <li>
                <strong>Supply Risk</strong> (Y-axis) — a 0–100 composite of three
                capped components (defined below), summed and clipped to 100.
              </li>
            </ul>
            <p className="font-medium text-foreground">Supply-risk components</p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>Supply concentration</strong> (≤50) — a step curve on the
                number of <em>other</em> suppliers in the same category across the
                full supplier roster (all known suppliers, active or not):{" "}
                <code>0 → 50</code> (true single source), <code>1 → 35</code>,{" "}
                <code>2 → 22</code>, <code>3 → 12</code>, <code>4 → 5</code>,{" "}
                <code>≥5 → 0</code>. This <em>merges</em> the former single-source and
                category-competition components into one measure derived purely from
                the live roster — so it can never contradict the actual supplier set
                (the prior stored single-source flag disagreed with the roster for
                ~91% of flagged suppliers and double-counted with competition).
              </li>
              <li>
                <strong>Cost premium</strong> (≤25) — <em>period-scoped</em>, from
                purchase prices. For each item the benchmark is the spend-weighted
                average unit price across <em>all</em>{" "}
                suppliers selling it in the period. A supplier&apos;s item premium ={" "}
                <code>supplier_avg_unit_price / item_avg − 1</code>, counted only
                when that supplier×item has <strong>≥2 POs</strong>{" "}
                (n=1 excluded as noise) and the item has ≥2 suppliers (single-source items have no
                benchmark → neutral). The supplier&apos;s overall premium is the
                spend-weighted average of its qualifying item premiums; points ={" "}
                <code>clip(premium × 62.5, 0, 25)</code> — so +8% → 5, +20% → 12.5,
                +40%+ → 25; at or below market → <code>0</code> (never negative).
                Suppliers with no qualifying items score <code>0</code>.
              </li>
              <li>
                <strong>Import friction</strong> (≤25) — reflects Indonesia&apos;s{" "}
                <em>trade-agreement coverage</em> (AFTA, RCEP), i.e. how easy/cheap
                an origin is to import from — <em>not</em> geographic distance:{" "}
                <code>ID → 0</code> (domestic), <code>AFTA/ASEAN → 8</code>,{" "}
                <code>RCEP non-ASEAN (JP, KR, CN, AU, NZ) → 16</code>, everything
                else / unknown → <code>25</code> (explicit safe default).
              </li>
            </ul>
            <p className="text-xs">
              The dataset is synthetic but realistic — prices, origins, and
              category structure mirror Indonesian mining-procurement patterns.
            </p>
            <p>
              A <strong>median split</strong> on each axis divides the supplier
              set into four quadrants, each mapping to a distinct management
              approach:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>Strategic</strong> (high spend, high risk) — partnership
                and joint planning.
              </li>
              <li>
                <strong>Leverage</strong> (high spend, low risk) — competitive
                negotiation and volume consolidation.
              </li>
              <li>
                <strong>Bottleneck</strong> (low spend, high risk) — secure
                supply, develop alternatives, buffer stock.
              </li>
              <li>
                <strong>Routine</strong> (low spend, low risk) — automate and
                simplify.
              </li>
            </ul>
            <p>
              Unlike clustering, the assignment is fully deterministic — the same
              data always produces the same quadrants — and the axes are directly
              interpretable in procurement terms.
            </p>
            <p className="text-xs">
              Reference: Kraljic, P. (1983). &ldquo;Purchasing must become supply
              management.&rdquo; Harvard Business Review.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-base font-semibold text-foreground">
              3.3 Performance vs Spend Diagnostic
            </h3>
            <p>
              A two-axis diagnostic crossing spend volume with supplier
              performance score. Suppliers are split into 4 zones via median
              lines:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>Stars</strong> (high spend + high performance): preserve
                and partner.
              </li>
              <li>
                <strong>Critical Issues</strong> (high spend + low performance):
                top priority for engagement.
              </li>
              <li>
                <strong>Hidden Gems</strong> (low spend + high performance):
                promotion candidates.
              </li>
              <li>
                <strong>Long Tail</strong> (low spend + low performance):
                simplify or rationalize.
              </li>
            </ul>
            <p>
              The diagnostic cross-references with the Kraljic quadrant analysis
              via the color coding on the scatter, surfacing engagement
              priorities. Performance score uses the CIPS-aligned composite score
              (quality 30%, delivery 30%, process 22%, risk 18% — see Section 4).
            </p>
            <p className="text-xs">
              Reference: CIPS supplier scorecard methodology; cross-tabulation
              diagnostic pattern from strategic sourcing practice.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-base font-semibold text-foreground">
              3.4 Cycle Time — Process Health Monitoring + Period Comparison
            </h3>
            <p>
              The Cycle Time page monitors total procure-to-pay duration as an
              ongoing process-health signal rather than a one-time before/after
              event. It applies six statistical methods:
            </p>
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                <strong>Time-series descriptive statistics</strong>: monthly
                average cycle time with a 3-month rolling average for trend
                smoothing.
              </li>
              <li>
                <strong>Distribution analysis</strong>: median and the{" "}
                <strong>typical range</strong> (interquartile range, IQR) — the
                P25–P75 band covering the middle 50% of POs, computed via
                linear-interpolation quantiles — plus a percentile summary of the
                cycle-time distribution.
              </li>
              <li>
                <strong>Stage-level descriptive statistics</strong>: PR to PO,
                PO to delivery, delivery to invoice, and invoice to payment
                subprocess durations.
              </li>
              <li>
                <strong>Z-score anomaly detection</strong>: POs with cycle time
                more than 2 standard deviations above the mean are flagged as
                outliers warranting investigation.
              </li>
              <li>
                <strong>Mann-Whitney U non-parametric hypothesis test</strong>:
                an optional period-vs-period comparison via a two-sample
                non-parametric test. Chosen over Student&apos;s t-test because
                cycle times are right-skewed and violate normality assumptions.
              </li>
              <li>
                <strong>Rank-biserial correlation effect size</strong>:
                complementary to the U statistic; interpreted via Cohen&apos;s
                conventions (small ≈ 0.1, medium ≈ 0.3, large ≈ 0.5).
              </li>
            </ol>
            <p>
              The supplier roster surfaces three per-supplier flags:{" "}
              <strong>Has outlier POs</strong> (at least one PO beyond the 2σ
              threshold above); <strong>Inconsistent</strong> — a supplier whose
              typical range (IQR) exceeds 1.5× the median of all suppliers&apos;
              IQRs, the Tukey convention for unusually wide spread; and{" "}
              <strong>Stage-dominated POs</strong>{" "}
              (at least one PO where a single procure-to-pay stage exceeds 60% of
              that PO&apos;s total cycle).
            </p>
            <p>
              Period comparison is a <strong>midpoint split of the currently
              selected period</strong> — its first half against its second — so it
              measures drift <em>within</em> the period, not year over year. The
              analysis also reports cycle-time descriptives and 3-way match pass
              rates per Kraljic quadrant.
            </p>
            <p className="text-xs">
              Reference: Mann &amp; Whitney (1947); Cohen (1988).
            </p>
          </section>
        </CardContent>
      </Card>

      {/* 4. Supplier Scorecard Methodology */}
      <Card className={cardElevation}>
        <CardHeader>
          <CardTitle>4. Supplier Scorecard Methodology</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 text-sm leading-relaxed text-muted-foreground">
          <p>
            Each supplier carries a 0–100 <strong>composite performance score</strong>,
            built from four sub-scores that are <strong>derived in code from raw
            operational data</strong> (deliveries, three-way-match results, and per-PO
            quality records — defect and complaint counts). Every sub-score is normalized
            to 0–100 against <strong>fixed industry bounds</strong>, so a supplier is
            measured against absolute standards — not against whoever else happens to be
            in the dataset. The source data contains <strong>operational measurements
            only</strong>; all scorecard values are computed in code (
            <code>python/scores.py</code>) at import, so every stored score is
            reproducible from the underlying records.
          </p>

          <section className="space-y-2">
            <h3 className="text-base font-semibold text-foreground">4.1 Sub-scores</h3>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <strong>Quality</strong> — average of defect rate (bound 0–10%) and
                complaint rate — the share of orders with a complaint (0–100%) — both
                lower-is-better, derived <strong>per purchase order</strong> from defect
                and complaint counts.
              </li>
              <li>
                <strong>Delivery</strong> — average of on-time-delivery % (0–100,
                higher-better) and average lead time (0–60 days, lower-better).
              </li>
              <li>
                <strong>Process</strong> — three-way-match pass rate (0–100).
              </li>
              <li>
                <strong>Risk</strong> — a purely structural index: geography + roster
                concentration (see 4.3).
              </li>
            </ul>
            <p className="rounded-md bg-muted/50 p-2 text-xs">
              <code>
                norm_high(v, lo, hi) = clamp((v−lo)/(hi−lo), 0, 1) × 100 · norm_low(v,
                lo, hi) = clamp((hi−v)/(hi−lo), 0, 1) × 100
              </code>
            </p>
            <p className="text-xs">
              Bounds reflect procurement conventions: near-zero-defect quality and a
              60-day lead-time ceiling; percentages are 0–100 by definition. Clamping
              means values outside a bound score 0 or 100, never negative or &gt;100.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-base font-semibold text-foreground">
              4.2 Performance score
            </h3>
            <p>
              The <strong>Performance score</strong> shown across the dashboard is a{" "}
              <strong>composite</strong> of the four weighted sub-scores (quality 30%,
              delivery 30%, process 22%, risk 18%).
            </p>
            <p className="rounded-md bg-muted/50 p-2 text-xs">
              <code>
                composite = 0.30·quality + 0.30·delivery + 0.22·process + 0.18·risk
              </code>
            </p>
            <p>
              Quality and delivery carry the most weight — in mining, defective or late
              equipment and consumables halt production. Process reflects documentation
              discipline; the structural Risk sub-score acts as a modifier. A former{" "}
              <strong>Service</strong> dimension (RFx response rate + average response
              time) was <strong>removed</strong> — it relied on manual survey estimates
              the transaction data doesn&apos;t measure — and its 15% weight was
              redistributed across the remaining four dimensions in proportion to their
              prior weights (the clean 30/30/22/18 above), leaving the relative
              priorities unchanged: Quality and Delivery co-dominant, Process above Risk.
              Weights align with CIPS and APQC supplier-scorecard guidance for heavy
              industry.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-base font-semibold text-foreground">4.3 Risk score</h3>
            <p className="rounded-md bg-muted/50 p-2 text-xs">
              <code>
                risk = 100 − (0.6·country_distance + 0.4·roster_concentration)
              </code>
            </p>
            <p>
              Higher = safer. The sub-score is <strong>purely structural</strong> —
              geography plus supplier availability, with no performance or complaint
              term. Geographic distance tiers: Indonesia 0 · ASEAN 30 · Asia-Pacific 60 ·
              other 100. <strong>Roster concentration</strong> is a continuous 0–100
              measure of how few alternatives exist in the same category across the full
              roster (true single source → 100, ≥5 alternatives → 0) — the same roster
              signal the Kraljic supply-risk axis uses. The score is fully deterministic,
              with no random component.
            </p>
            <p className="text-xs">
              Note: this composite <strong>Risk sub-score</strong> is distinct from the{" "}
              <strong>Kraljic supply-risk score</strong> (Section 3.2) — same word,
              different metric, opposite polarity by design (here higher = safer; on the
              Kraljic axis higher = riskier). The old complaint and binary single-source
              terms were dropped: complaints now live only in Quality (avoiding
              double-counting), and the single-source flag was replaced by the continuous
              roster-concentration measure the two scores share.
            </p>
          </section>

        </CardContent>
      </Card>

      {/* 5. Supplier Classification (Combined View) */}
      <Card className={cardElevation}>
        <CardHeader>
          <CardTitle>5. Supplier Classification Methodology</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 text-sm leading-relaxed text-muted-foreground">
          <p>
            The <strong>Supplier Classification</strong> page brings the Kraljic
            matrix (3.2) and the Performance-vs-Spend diagnostic (3.3) together on
            one screen, because they answer complementary questions:{" "}
            <strong>Kraljic</strong> describes how much leverage and supply risk a
            relationship carries, while <strong>Performance vs Spend</strong>{" "}
            describes how well the supplier actually performs for the money spent.
            Reading them side by side turns two separate portfolios into a single
            prioritised view. The performance axis uses the same 0–100 composite
            score defined in <strong>Section 4</strong>.
          </p>

          <section className="space-y-2">
            <h3 className="text-base font-semibold text-foreground">
              5.1 Cross-classification synthesis
            </h3>
            <p>
              Four synthesis buckets combine each supplier&apos;s Kraljic quadrant
              with the <strong>period performance median</strong> — the same median
              line the Performance-vs-Spend scatter uses, so the cards and the chart
              are always internally consistent. &ldquo;Below&rdquo; means a composite
              below the period median; &ldquo;above&rdquo; means at or over it:
            </p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <strong>Strategic underperformers</strong> — Strategic quadrant{" "}
                <em>and</em> below the median: high-spend, hard-to-replace suppliers
                that are not performing — the highest-priority engagement targets.
              </li>
              <li>
                <strong>Bottleneck critical issues</strong> — Bottleneck quadrant{" "}
                <em>and</em> below the median: small dollars but real supply risk if
                they fail.
              </li>
              <li>
                <strong>Workhorse leverage</strong> — Leverage quadrant <em>and</em>{" "}
                above the median: dependable, competitive-category volume to
                consolidate around.
              </li>
              <li>
                <strong>Routine quality risks</strong> — Routine quadrant{" "}
                <em>and</em> below the median: candidates to rationalize or move to
                catalog buys.
              </li>
            </ul>
            <p>
              The buckets are presented as clickable cards that filter the combined
              supplier table. Everything on the page is{" "}
              <strong>period-scoped</strong> — single-year or range — consistent with
              the rest of the dashboard.
            </p>
          </section>
        </CardContent>
      </Card>

      {/* 6. Action Recommendations Synthesis */}
      <Card className={cardElevation}>
        <CardHeader>
          <CardTitle>6. Action Recommendations Synthesis</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            <strong>Action Priorities</strong> synthesizes findings from the four
            analyses into ranked, specific actions, organized into three groups
            that mirror the diagnostic analyses:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              <strong>Spend</strong> — Concentration, Critical Spend, and Tail
              Spend.
            </li>
            <li>
              <strong>Suppliers</strong> — Critical Issues Engagement, Hidden Gems
              Promotion, and Bottleneck Risk Mitigation.
            </li>
            <li>
              <strong>Process</strong> — Process Improvement and Slowest Stage.
            </li>
          </ul>
          <p>
            Each recommendation is ranked by an impact score (normalized to
            0–100) combining spend exposure, risk magnitude, or process
            severity. Recommendations include specific data backing and
            suggested action language.
          </p>

          <section className="space-y-2">
            <h4 className="text-sm font-semibold text-foreground">
              Impact Score Calculation
            </h4>
            <p>
              Every recommendation carries an impact score (0–100) used to rank
              actions globally across categories. Each category is normalized to
              the same 0–100 scale so an engagement and a process fix are
              comparable. All categories share a spend term:
            </p>
            <p className="rounded-md bg-muted/50 p-2 text-xs">
              <code>
                spend_normalized = log(1 + total_spend) ÷ max(log(1 +
                total_spend)) × 100
              </code>
            </p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <strong>Critical Issues Engagement</strong> —{" "}
                <code>0.7 × spend_normalized + 0.3 × performance_gap</code>{" "}
                (gap below the performance median, scaled to 0–100). High-spend
                underperformers rank highest.
              </li>
              <li>
                <strong>Hidden Gems Promotion</strong> —{" "}
                <code>(performance − median) ÷ (100 − median) × 100</code>.
                Performance above the median, scaled to 0–100.
              </li>
              <li>
                <strong>Bottleneck Risk Mitigation</strong> — the supplier&apos;s{" "}
                <code>supply_risk_score</code> (already 0–100). Direct
                risk-based ranking.
              </li>
              <li>
                <strong>Process Improvement</strong> — 3-way-match issues use{" "}
                <code>fail_rate_pct</code>; stage-time issues use{" "}
                <code>mean_days ÷ 18 × 100</code>, normalized against a ~18-day
                reference for a slow internal process stage.
              </li>
            </ul>
          </section>
        </CardContent>
      </Card>

      {/* 7. Reporting Periods */}
      <Card className={cardElevation}>
        <CardHeader>
          <CardTitle>7. Reporting Periods</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Periods are <strong>auto-detected</strong> from the data — one period
              per distinct year found in the <code>pr_date</code> values.
            </li>
            <li>
              <strong>Single Year</strong> mode shows the analyses for one year,
              read from a pre-computed cache (instant).
            </li>
            <li>
              <strong>Range</strong> mode shows the analyses across multiple years,
              computed on-the-fly over the combined date span.
            </li>
            <li>
              Range computes take roughly <strong>5 seconds</strong> because they
              invoke the Python analysis script live rather than reading the cache.
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* 8. Assumptions and Limitations */}
      <Card className={cardElevation}>
        <CardHeader>
          <CardTitle>8. Assumptions and Limitations</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6 text-sm leading-relaxed text-muted-foreground">
          <p>
            The methodology is fixed, deterministic, and reproducible. This section
            names what it can and cannot see. A page that lists only its formulas is
            a spec; one that names its own blind spots is a defence — so the
            limitations below are stated plainly, as properties we own rather than
            flaws we hide.
          </p>

          <section className="space-y-2">
            <h3 className="text-base font-semibold text-foreground">
              8.1 Two departures from the Kraljic textbook
            </h3>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <strong>Our profit-impact axis is spend, not profit impact.</strong>{" "}
                Kraljic&apos;s X-axis is meant to be profit impact — margin,
                criticality to production, substitutability. None of that lives in a
                purchase order, so we use annual spend, the standard practical proxy.
                It is directionally sound, but it will misplace a cheap,
                production-critical component that a plant cannot run without.
              </li>
              <li>
                <strong>
                  Supply risk is three measurable proxies for a qualitative
                  judgment.
                </strong>{" "}
                Kraljic&apos;s supply-risk axis is a qualitative assessment across
                roughly eight factors. We operationalise it with three we can measure
                from transaction data — competitor count (supply concentration),
                pricing power (cost premium), and import friction. We deliberately
                omit substitutability, storage and perishability risk, make-or-buy
                potential, and competing demand from other buyers: those need domain
                knowledge and market intelligence, not purchase orders. What we
                compute is reproducible; what we omit is real.
              </li>
            </ul>
          </section>

          <section className="space-y-2">
            <h3 className="text-base font-semibold text-foreground">
              8.2 Two opposite &ldquo;risks&rdquo;
            </h3>
            <p>
              The word <em>risk</em> means two opposite things in this dashboard, and
              it is the single most likely thing to trip a reader. The{" "}
              <strong>Kraljic supply-risk score</strong> (Section 3.2) runs{" "}
              <strong>higher = riskier</strong>{" "}
              — it is the exposure axis of the matrix. The composite&apos;s <strong>Risk sub-score</strong> (Section
              4.3) runs <strong>higher = safer</strong> — it is a structural safety
              modifier on the performance score. Same word, opposite polarity, by
              design. They also share an input — the roster-concentration term — as
              the same step curve scaled: the composite carries exactly{" "}
              <strong>twice</strong> the Kraljic points (0 alternatives → 50 on the
              Kraljic axis, 100 on the composite; ≥5 → 0 on both). Read the axis
              label, not just the word.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-base font-semibold text-foreground">
              8.3 What the model can&apos;t see on this dataset
            </h3>
            <p>
              Several branches of the scoring machinery never engage on the current
              data. We surface them so nobody mistakes an unused rung for a validated
              one.
            </p>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <strong>Two country tiers never fire.</strong> The composite&apos;s{" "}
                <code>country_distance</code> has an ASEAN tier (30) and{" "}
                <code>import_friction</code> an ASEAN tier (8), both meant for
                regional-but-foreign origins. This roster has none — every supplier
                is Indonesian or far-international — so those tiers never engage.
                Because <code>country_distance</code>{" "}
                drives 60% of the structural Risk sub-score, on this data that
                sub-score is effectively
                &ldquo;Indonesia vs the rest of the world&rdquo;.
              </li>
              <li>
                <strong>Two concentration rungs are unreachable.</strong> Both
                supply-concentration curves reserve their top rung for a true
                single-source category (one supplier, no alternatives). On this
                roster the smallest category has two suppliers, so that rung never
                fires — the advertised ceilings (50 on the Kraljic axis, 100 on the
                composite) cannot be reached. The real maxima on this data are{" "}
                <strong>35 and 70</strong>. (A finding from the current roster; it
                would change if a sole-source category appeared.)
              </li>
              <li>
                <strong>
                  Cost premium is a light tie-breaker, not a co-equal third.
                </strong>{" "}
                It is capped at 25 of the 100-point Kraljic axis, but on this roster
                it registers for only 24 of 55 suppliers, and in a data audit every
                quadrant boundary it moved was a low-spend Bottleneck↔Routine flip —
                on this dataset it has never moved a high-spend Strategic↔Leverage
                supplier. Read it as a nudge, not a driver.
              </li>
              <li>
                <strong>The &ldquo;Inconsistent&rdquo; flag is rare.</strong> The
                cycle-consistency flag (Section 3.4) is a genuine outlier detector,
                not a common state — on this data it fires for 2 of 55 suppliers.
              </li>
              <li>
                <strong>
                  The &ldquo;Slowest stage&rdquo; recommendation is often silent.
                </strong>{" "}
                It fires only when an internal process stage averages over 8 days. On
                this data it fires in 2024 but not in 2025 or 2026 — no internal stage
                clears the threshold in those years.
              </li>
              <li>
                <strong>Three recommendations always fire.</strong>{" "}
                Concentration, Process Improvement, and Tail Spend always produce
                output — they are
                structural summaries of the portfolio, not conditional detections.
                Read them as &ldquo;here is the shape of your spend and process&rdquo;,
                not as &ldquo;a problem was found&rdquo;.
              </li>
            </ul>
            <div>
              <h4 className="text-sm font-semibold text-foreground">
                Two country scales, by design
              </h4>
              <p className="mt-1">
                The two country-based scores measure different things, so a country
                can sit in a different tier on each — this is deliberate, not an
                inconsistency. <code>country_distance</code>{" "}
                (the composite&apos;s Risk sub-score) is <em>geographic proximity</em>:
                Indonesia 0 / ASEAN 30 /
                Asia-Pacific 60 / other 100. <code>import_friction</code> (the Kraljic
                supply-risk axis) is <em>trade-agreement coverage</em> — how cheaply an
                origin can be imported from: Indonesia 0 / AFTA 8 / RCEP-non-ASEAN 16 /
                other 25. India, for instance, is geographically Asia-Pacific (60 on
                distance) yet sits outside the RCEP trade bloc it left in 2019 (25 on
                friction) — correctly different on the two scales. Both scales now
                cover every ASEAN and Asia-Pacific origin.
              </p>
            </div>
          </section>

          <section className="space-y-2">
            <h3 className="text-base font-semibold text-foreground">
              8.4 Statistical and scoring caveats
            </h3>
            <ul className="list-disc space-y-1.5 pl-5">
              <li>
                <strong>No significance threshold gates any decision.</strong> The
                Mann-Whitney U test reports a p-value and an effect size, but nothing
                in the dashboard acts on a fixed α, and the comparison is{" "}
                <em>intra-period</em> — the selected period split at its midpoint, not
                year over year. Choosing an α would be inventing a decision rule
                nobody agreed to; we show the evidence and leave the judgment to a
                human.
              </li>
              <li>
                <strong>Most of the composite is period-sensitive.</strong> Quality,
                Delivery and Process — 82% of the composite — re-aggregate over
                whatever POs fall in the selected window. Only the structural Risk
                sub-score (18%) is period-independent. A performance number is a
                statement about a window, not a fixed rating; compare like windows.
              </li>
              <li>
                <strong>Cost premium measures overpricing, not cheapness.</strong> It
                penalises measured overpricing only — below-market, at-market, and
                un-benchmarked suppliers all score 0, so it never rewards a cheap
                supplier. And the benchmark is <em>our own</em> spend-weighted average
                price per item, not an external market rate: it catches a supplier out
                of line with our roster, not with the world.
              </li>
              <li>
                <strong>Two sub-score halves are throttled by their bounds.</strong>{" "}
                Complaint rate is scored 0–100% but real rates top out near 33%, so
                that half only occupies 66.7–100 — the defect half does roughly 2.3×
                the work inside Quality. Lead time is scored 0–60 days but real leads
                run 8–26.5 days, so that half only occupies 55.8–86.7 — on-time
                delivery carries most of Delivery. The bounds are honest industry
                ceilings; they simply leave headroom this dataset never reaches.
              </li>
            </ul>
          </section>

          <section className="space-y-2">
            <h3 className="text-base font-semibold text-foreground">
              8.5 Baseline assumptions
            </h3>
            <ul className="list-disc space-y-2 pl-5">
              <li>
                The data is <strong>synthetic</strong> — calibrated to industry
                benchmarks for realism, but not a record of real operations.
              </li>
              <li>
                Scope is a <strong>single organization</strong>; there are no
                cross-entity comparisons.
              </li>
              <li>
                Currency is normalized to USD using <strong>period averages</strong>;
                a real system would apply daily FX rates.
              </li>
              <li>
                The methodology is <strong>fixed and not user-adjustable</strong> —
                ABC at 80% / 95%, median splits on both classification matrices, the
                2σ outlier rule, the 8-day slow-stage flag, and the Mann-Whitney U
                comparison are all constants. There are no parameter sliders.
              </li>
              <li>
                The process structure reflects Indonesian government procurement
                regulation (<strong>Perpres 12/2021</strong>).
              </li>
            </ul>
          </section>
        </CardContent>
      </Card>

      {/* 9. References */}
      <Card className={cardElevation}>
        <CardHeader>
          <CardTitle>9. References</CardTitle>
        </CardHeader>
        <CardContent className="text-sm leading-relaxed text-muted-foreground">
          <ul className="list-disc space-y-1 pl-5">
            <li>CIPS Knowledge Hub — Chartered Institute of Procurement &amp; Supply.</li>
            <li>APQC Open Standards Benchmarking — P2P process metrics.</li>
            <li>Hackett Group — P2P Automation Benefits Research.</li>
            <li>MOPS Singapore — Mean of Platts Singapore (fuel benchmarks).</li>
            <li>AME Group — Mining cost reports.</li>
            <li>Juran, J. M. (1951) — Quality Control Handbook (Pareto principle).</li>
            <li>Mann, H. B. &amp; Whitney, D. R. (1947) — Mann-Whitney U test.</li>
            <li>Perpres 12/2021 — Indonesian government procurement regulation.</li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}
