import { requireAuth } from "@/lib/auth";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

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
      <Card>
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
      <Card>
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
            The data generator uses a fixed random seed of{" "}
            <strong>42</strong> for reproducibility — anyone can regenerate the
            exact same dataset.
          </p>
        </CardContent>
      </Card>

      {/* 3. The Four Analyses */}
      <Card>
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
              ABC class, and a crosstab of legacy tier vs. ABC class.
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
                <strong>Profit Impact</strong> (X-axis) — the supplier&apos;s spend
                volume, measured as <code>log_spend</code>.
              </li>
              <li>
                <strong>Supply Risk</strong> (Y-axis) — a composite of
                single-source status, category competition, country distance, and
                switching cost (lead-time proxy).
              </li>
            </ul>
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
              via the color coding on the scatter, surfacing tier mismatches and
              engagement priorities. Performance score uses the existing
              CIPS-aligned composite score (quality 25%, delivery 25%, process
              20%, service 15%, risk 15%).
            </p>
            <p className="text-xs">
              Reference: CIPS supplier scorecard methodology; cross-tabulation
              diagnostic pattern from strategic sourcing practice.
            </p>
          </section>

          <section className="space-y-2">
            <h3 className="text-base font-semibold text-foreground">
              3.4 Mann-Whitney U Hypothesis Test
            </h3>
            <p>
              A non-parametric, two-sample test of whether automation (introduced
              on <strong>2025-01-01</strong>) significantly reduced the
              invoice-to-payment cycle time. It compares the pre-automation (2024)
              and post-automation (2025) groups.
            </p>
            <p>
              A non-parametric test is used because cycle-time distributions are
              right-skewed rather than normal, which violates the assumptions of a
              t-test. The test uses a fixed significance level of{" "}
              <strong>α = 0.05</strong>. Effect size is reported as the{" "}
              <strong>rank-biserial correlation</strong>, and a{" "}
              <strong>95% confidence interval</strong> on the mean difference is
              estimated via bootstrap resampling (1000 iterations).
            </p>
            <p>
              In addition to the overall test, the analysis now includes:
            </p>
            <ul className="list-disc space-y-1 pl-5">
              <li>
                <strong>Stage decomposition</strong>: per-stage mean times
                (PR→PO, PO→delivery, delivery→invoice, invoice→payment) showing
                where automation impact landed.
              </li>
              <li>
                <strong>Quadrant breakdown</strong>: pre/post invoice-to-payment
                comparison for each Kraljic quadrant.
              </li>
              <li>
                <strong>3-way match compliance</strong> by quadrant, surfacing
                process-control gaps among the most important suppliers.
              </li>
            </ul>
            <p className="text-xs">
              Reference: Mann &amp; Whitney (1947).
            </p>
          </section>
        </CardContent>
      </Card>

      {/* 4. Action Recommendations Synthesis */}
      <Card>
        <CardHeader>
          <CardTitle>4. Action Recommendations Synthesis</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3 text-sm leading-relaxed text-muted-foreground">
          <p>
            The Action Dashboard synthesizes findings from the 4 analyses into
            ranked, specific actions. The recommendations engine evaluates:
          </p>
          <ul className="list-disc space-y-1 pl-5">
            <li>
              Tier mismatches across ABC, Kraljic, and Performance vs Spend.
            </li>
            <li>High-spend underperformers (Critical Issues).</li>
            <li>Low-spend high performers (Hidden Gems).</li>
            <li>High-risk low-impact suppliers (Bottleneck Risk).</li>
            <li>Process compliance issues by stage and quadrant.</li>
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
              the same 0–100 scale so a tier change and a process fix are
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
                <strong>Tier Reclassification</strong> —{" "}
                <code>spend_normalized × severity</code>, where severity is{" "}
                <strong>1.0</strong> (promote), <strong>0.9</strong> (review),
                or <strong>0.6</strong> (demote). Higher-spend mismatches rank
                first.
              </li>
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
                <code>mean_days ÷ 18 × 100</code>, calibrated against the
                pre-automation baseline (~18 days).
              </li>
            </ul>
          </section>
        </CardContent>
      </Card>

      {/* 5. Reporting Periods */}
      <Card>
        <CardHeader>
          <CardTitle>5. Reporting Periods</CardTitle>
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

      {/* 5. Assumptions and Limitations */}
      <Card>
        <CardHeader>
          <CardTitle>6. Assumptions and Limitations</CardTitle>
        </CardHeader>
        <CardContent className="text-sm leading-relaxed text-muted-foreground">
          <ul className="list-disc space-y-2 pl-5">
            <li>
              The data is synthetic and does not represent actual Adaro
              operations — it is calibrated to benchmarks, but not real.
            </li>
            <li>
              Supplier quality metrics (defect rate, complaints, RFx
              responsiveness) are annual aggregates from the scorecard system, not
              per-transaction values.
            </li>
            <li>
              Currency is normalized to USD using period averages; real systems
              would apply daily FX rates.
            </li>
            <li>
              Scope is a single organization — there are no cross-entity
              comparisons.
            </li>
            <li>
              The analytical methodology is fixed: users cannot adjust thresholds
              or parameters (ABC 80/95, k = 4, Mann-Whitney U, α = 0.05).
            </li>
            <li>
              The process structure is influenced by Indonesian government
              procurement regulations (Perpres 12/2021).
            </li>
          </ul>
        </CardContent>
      </Card>

      {/* 6. References */}
      <Card>
        <CardHeader>
          <CardTitle>7. References</CardTitle>
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
