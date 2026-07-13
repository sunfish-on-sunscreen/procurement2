import type {
  SpendOverviewResult,
  AbcResult,
  KraljicResult,
  CycleTimeResult,
  PerformanceSpendResult,
  RecommendationsResult,
  RecommendationAction,
} from "@/lib/analysis-types";
import type { CycleBreakdown } from "@/lib/cycle-time-types";
import type { TemporalLoad, TemporalAnomalies } from "@/lib/temporal-anomalies";
import type { ReportTone } from "@/lib/report-config";
import { deriveCycleFlags } from "@/lib/cycle-flags";
import {
  buildAnomalyCrossref,
  buildClassificationAnomalies,
  type ClassificationAnomalyRow,
  type AnomalyCrossref,
} from "@/lib/anomaly-crossref";
import { buildTemporalAnomalies } from "@/lib/temporal-anomalies";

/**
 * The report ARGUMENT (2026-07-13 rewrite). Turns the same six analyses (+ the
 * anomaly-hub breakdown/temporal) the report already has into a decision-first
 * narrative: a computed HEADLINE (the top finding, not a fact), a SITUATION that
 * surfaces the cross-analysis joins the app computes and the old report threw away
 * (Class-A ∩ Strategic, high-spend ∩ underperforming), the top-3 DERIVED findings
 * (ranked by exposure), a prioritised ACTION table, and plain-language WORTH-WATCHING
 * moves. PURE + tone-aware — no recompute, so the numbers are identical to the
 * analyses; the three tones are prose registers over one shared fact model.
 */

// ---- input (structurally the report's ReportAnalyses) --------------------- #
export type ArgumentInput = {
  spend_overview: SpendOverviewResult | null;
  abc: AbcResult | null;
  kraljic: KraljicResult | null;
  cycle_time: CycleTimeResult | null;
  performance_spend: PerformanceSpendResult | null;
  recommendations: RecommendationsResult | null;
  breakdown?: CycleBreakdown | null;
  temporal?: TemporalLoad | null;
};

export type EvidenceStat = { label: string; value: string };
export type ActionRow = {
  priority: 1 | 2 | 3;
  action: string;
  amount: number | null;
  rationale: string;
};
export type RenderedFinding = {
  key: string;
  headline: string;
  body: string[];
  evidence: EvidenceStat[];
  recommendation: string;
  amount: number | null;
};
export type RenderedArgument = {
  headline: string;
  situation: string[];
  findings: RenderedFinding[];
  actions: ActionRow[];
  watching: { intro: string | null; items: string[] };
  /** Readable lens-disagreement rows for the appendix (no raw S/P/R codes). */
  lensRows: { supplier_name: string; verdict: string; spend: number | null }[];
  hasArgument: boolean;
};

// ---- formatting helpers --------------------------------------------------- #
const usdM = (n: number) => `$${(n / 1_000_000).toFixed(1)}M`;
const pct0 = (n: number) => `${Math.round(n)}%`;
const intl = new Intl.NumberFormat("en-US");
const firstSentence = (s: string) => {
  const i = s.indexOf(". ");
  return i === -1 ? s : s.slice(0, i + 1);
};
const ACTION_VERB: Record<RecommendationAction, string> = {
  promote: "Promote",
  engage: "Engage",
  mitigate: "Mitigate risk for",
  improve: "Improve",
  diversify: "Diversify",
  steward: "Steward",
  consolidate: "Consolidate",
  streamline: "Streamline",
};
const andList = (xs: string[]) =>
  xs.length <= 1
    ? (xs[0] ?? "")
    : xs.length === 2
      ? `${xs[0]} and ${xs[1]}`
      : `${xs.slice(0, -1).join(", ")}, and ${xs[xs.length - 1]}`;
const cap = (s: string) => (s ? s[0].toUpperCase() + s.slice(1) : s);

/** Percentile (0–100) → plain-English bucket for the lens-disagreement prose. */
function pctBucket(p: number): string {
  if (p <= 15) return "bottom-decile";
  if (p <= 35) return "low";
  if (p <= 65) return "mid-range";
  if (p <= 85) return "high";
  return "top-decile";
}

/** "S 0 · P 43 · R 96 · gap 96" → readable prose. */
export function lensVerdict(row: ClassificationAnomalyRow, isTop: boolean): string {
  return `${cap(pctBucket(row.spend_pct))} spend, ${pctBucket(
    row.performance_pct,
  )} performance, ${pctBucket(row.risk_pct)} supply risk — ${
    isTop ? "the widest" : "a wide"
  } lens disagreement in the roster`;
}

// ---- the shared FACT model ------------------------------------------------ #
type Finding =
  | {
      key: "critical_issues";
      score: number;
      n: number;
      spendPct: number;
      spend: number;
      leaders: { name: string; spend: number }[];
      perfMedian: number;
    }
  | {
      key: "concentration";
      score: number;
      category: string;
      pct: number;
      spend: number;
      cat2: string;
      cat2Pct: number;
    }
  | {
      key: "cycle_constraint";
      score: number;
      stage: string;
      mean: number;
      sharePct: number;
      cycleMedian: number;
    }
  | {
      key: "control_weakness";
      score: number;
      failedSpend: number;
      pctAtRisk: number;
      nFailed: number;
      nSuppliers: number;
    }
  | {
      key: "temporal_move";
      score: number;
      supplier: string;
      spendPct: number | null;
      quadFrom: string | null;
      quadTo: string | null;
      spend: number | null;
    }
  | {
      key: "lens_disagreement";
      score: number;
      supplier: string;
      verdict: string;
      spend: number | null;
    };

const STAGE_LABELS: Record<string, string> = {
  pr_to_po: "PR to PO",
  po_to_delivery: "PO to Delivery",
  delivery_to_invoice: "Delivery to Invoice",
  invoice_to_payment: "Invoice to Payment",
};
// Internal P2P stages the org controls (PO→Delivery is physical lead time).
const INTERNAL_STAGES = ["pr_to_po", "delivery_to_invoice", "invoice_to_payment"];
const STAGE_FLAG_DAYS = 8;

type SituationFacts = {
  totalSpend: number;
  totalPos: number;
  activeSuppliers: number;
  cat1: string;
  cat1Pct: number;
  classAN: number;
  classASpendPct: number;
  stratN: number;
  aAndStrategicN: number;
  aAndStrategicSpend: number;
  criticalN: number;
  criticalSpend: number;
  criticalSpendPct: number;
  aAndCriticalN: number;
  aAndCriticalSpend: number;
  criticalLeaders: { name: string; spend: number }[];
  perfMedian: number;
};

function buildFacts(input: ArgumentInput): {
  situation: SituationFacts;
  findings: Finding[];
  temporal: TemporalAnomalies | null;
  proc: AnomalyCrossref | null;
  lensRowsAll: ClassificationAnomalyRow[];
} {
  const so = input.spend_overview;
  const perf = input.performance_spend;
  const abc = input.abc;
  const kr = input.kraljic;
  const ct = input.cycle_time;

  const totalSpend = so?.total_spend ?? 0;
  const cats = [...(so?.by_category ?? [])].sort((a, b) => b.total - a.total);
  const catGrand = cats.reduce((s, c) => s + c.total, 0) || totalSpend || 1;
  const cat1 = cats[0];
  const cat2 = cats[1];

  // ---- per-supplier joins (the cross-analysis the old report discarded) ---- #
  const perfSuppliers = perf?.suppliers ?? [];
  const spendById = new Map(perfSuppliers.map((s) => [s.supplier_id, s.total_spend_usd]));
  const classAIds = new Set(
    (abc?.classifications ?? []).filter((c) => c.abc_class === "A").map((c) => c.supplier_id),
  );
  const strategicIds = new Set(
    (kr?.quadrant_assignments ?? [])
      .filter((q) => q.quadrant === "Strategic")
      .map((q) => q.supplier_id),
  );
  const criticalSuppliers = perfSuppliers.filter((s) => s.zone === "Critical Issues");
  const criticalIds = new Set(criticalSuppliers.map((s) => s.supplier_id));

  const inter = (a: Set<string>, b: Set<string>) => [...a].filter((id) => b.has(id));
  const aAndStrategic = inter(classAIds, strategicIds);
  const aAndCritical = inter(classAIds, criticalIds);
  const sumSpend = (ids: string[]) => ids.reduce((s, id) => s + (spendById.get(id) ?? 0), 0);

  const criticalZone = perf?.zone_profiles.find((z) => z.zone === "Critical Issues");
  const criticalSpend = criticalZone?.total_spend_usd ?? 0;
  const criticalSpendPct = criticalZone?.pct_of_total_spend ?? 0;
  const criticalLeaders = (perf?.top_critical_issues ?? [])
    .slice(0, 2)
    .map((s) => ({ name: s.supplier_name, spend: s.total_spend_usd }));
  const perfMedian = perf?.axis_thresholds.performance_median ?? 0;

  const situation: SituationFacts = {
    totalSpend,
    totalPos: so?.total_pos ?? 0,
    activeSuppliers: so?.active_suppliers ?? 0,
    cat1: cat1?.category ?? "—",
    cat1Pct: cat1 ? (cat1.total / catGrand) * 100 : 0,
    classAN: abc?.summary.A.n ?? 0,
    classASpendPct: (abc?.summary.A.pct_of_spend ?? 0) * 100,
    stratN: strategicIds.size,
    aAndStrategicN: aAndStrategic.length,
    aAndStrategicSpend: sumSpend(aAndStrategic),
    criticalN: criticalSuppliers.length,
    criticalSpend,
    criticalSpendPct,
    aAndCriticalN: aAndCritical.length,
    aAndCriticalSpend: sumSpend(aAndCritical),
    criticalLeaders,
    perfMedian,
  };

  // ---- anomaly families (reuse the pure hub builders) ---------------------- #
  let proc: AnomalyCrossref | null = null;
  if (input.breakdown && perf) {
    proc = buildAnomalyCrossref({
      flagsBySupplier: deriveCycleFlags({
        roster: input.breakdown.bySupplier,
        anomalies: ct?.anomalies ?? [],
        stageAnomalies: input.breakdown.stageAnomalies ?? [],
      }).flagsBySupplier,
      perfSuppliers,
      roster: input.breakdown.bySupplier,
    });
  }
  const lensRowsAll =
    perf && kr && abc
      ? buildClassificationAnomalies({
          perfSuppliers,
          supplyRiskById: new Map(
            kr.quadrant_assignments.map((q) => [q.supplier_id, q.supply_risk_score]),
          ),
          abcById: new Map(abc.classifications.map((c) => [c.supplier_id, c.abc_class])),
        }).rows
      : [];
  const temporal =
    input.temporal?.kind === "ok" ? buildTemporalAnomalies(input.temporal.matrix) : null;

  // ---- candidate findings, each scored to RANK by insight × exposure ------- #
  // The cross-analysis join (critical_issues = high-spend ∩ underperforming) is the
  // higher-order INSIGHT this app exists to surface, so it anchors the lead with a
  // base of 1.0 + its $-exposure. Raw category concentration and the cycle
  // constraint are CONTEXT — capped below 1.0 so they support, not lead. A control
  // failure or a temporal move can still outlead, but only when its exposure is
  // genuinely large (×4 ⇒ it needs ~>33% of spend to beat the cross-analysis) — the
  // "bigger story" override.
  const findings: Finding[] = [];
  const asFraction = (n: number) => (totalSpend ? n / totalSpend : 0);

  if (situation.criticalN > 0) {
    findings.push({
      key: "critical_issues",
      score: 1 + asFraction(criticalSpend),
      n: situation.criticalN,
      spendPct: criticalSpendPct,
      spend: criticalSpend,
      leaders: criticalLeaders,
      perfMedian,
    });
  }
  if (situation.cat1Pct >= 30 && cat1) {
    findings.push({
      key: "concentration",
      score: 0.5 + (situation.cat1Pct / 100) * 0.3,
      category: situation.cat1,
      pct: situation.cat1Pct,
      spend: cat1.total,
      cat2: cat2?.category ?? "—",
      cat2Pct: cat2 ? (cat2.total / catGrand) * 100 : 0,
    });
  }
  const stages = ct?.stage_breakdown;
  if (stages) {
    const means = INTERNAL_STAGES.map((k) => ({
      key: k,
      mean: (stages as Record<string, { mean: number | null }>)[k]?.mean ?? 0,
    }));
    const allMeans = (Object.values(stages) as { mean: number | null }[]).reduce(
      (s, v) => s + (v.mean ?? 0),
      0,
    );
    const slowest = [...means].sort((a, b) => b.mean - a.mean)[0];
    if (slowest && slowest.mean > STAGE_FLAG_DAYS) {
      findings.push({
        key: "cycle_constraint",
        score: 0.4 + (allMeans ? slowest.mean / allMeans : 0) * 0.3,
        stage: STAGE_LABELS[slowest.key] ?? slowest.key,
        mean: slowest.mean,
        sharePct: allMeans ? (slowest.mean / allMeans) * 100 : 0,
        cycleMedian: ct?.distribution.median ?? 0,
      });
    }
  }
  const control = input.breakdown?.controlExposure;
  if (control && control.n_failed > 0 && control.pct_at_risk >= 5) {
    findings.push({
      key: "control_weakness",
      score: asFraction(control.failed_spend) * 4,
      failedSpend: control.failed_spend,
      pctAtRisk: control.pct_at_risk,
      nFailed: control.n_failed,
      nSuppliers: control.n_failing_suppliers,
    });
  }
  if (temporal && temporal.rows.length > 0) {
    const t = temporal.rows[0];
    findings.push({
      key: "temporal_move",
      score: asFraction(t.total_spend_usd ?? 0) * 4,
      supplier: t.supplier_name,
      spendPct: t.spend?.pct ?? null,
      quadFrom: t.quadrant?.from ?? null,
      quadTo: t.quadrant?.to ?? null,
      spend: t.total_spend_usd,
    });
  }
  if (lensRowsAll.length > 0) {
    const l = lensRowsAll[0];
    findings.push({
      key: "lens_disagreement",
      score: asFraction(l.total_spend_usd) * 0.5,
      supplier: l.supplier_name,
      verdict: lensVerdict(l, true),
      spend: l.total_spend_usd,
    });
  }

  findings.sort((a, b) => b.score - a.score);
  return { situation, findings: findings.slice(0, 3), temporal, proc, lensRowsAll };
}

// ---- prose renderers (tone registers over the shared facts) --------------- #
function headlineText(f: Finding | undefined, s: SituationFacts, tone: ReportTone): string {
  if (!f) {
    return `You spent ${usdM(s.totalSpend)} with ${intl.format(
      s.activeSuppliers,
    )} suppliers, with no single exposure standing out — the portfolio is broadly balanced this period.`;
  }
  // Concentration rides as a SUPPORTING clause behind the lead finding.
  const conc =
    s.cat1Pct >= 40
      ? ` And there is little fallback: ${pct0(s.cat1Pct)} of spend sits in ${s.cat1}.`
      : "";
  switch (f.key) {
    case "critical_issues": {
      // executive: terse, no names, decision-only.
      if (tone === "executive") {
        return `The suppliers you depend on most are the ones performing worst — ${f.n} high-spend suppliers, ${pct0(
          f.spendPct,
        )} of spend, below the performance median.${conc}`;
      }
      const led = f.leaders.length
        ? `, led by ${andList(f.leaders.map((l) => `${l.name} (${usdM(l.spend)})`))}`
        : "";
      // analytical: name the quadrant + the method.
      if (tone === "analytical") {
        return `The high-spend / below-median-performance quadrant holds ${f.n} suppliers carrying ${pct0(
          f.spendPct,
        )} of spend (${usdM(
          f.spend,
        )})${led}: the concentration you depend on and the performance problem are the same set.${conc}`;
      }
      // operational: named, tactical.
      return `The suppliers you depend on most are the ones performing worst: ${f.n} high-spend suppliers carrying ${pct0(
        f.spendPct,
      )} of spend sit below the performance median${led}.${conc}`;
    }
    case "concentration":
      return tone === "executive"
        ? `Spend is concentrated in one category — ${f.category} is ${pct0(
            f.pct,
          )} of outlay — leaving the organisation exposed to a single market.`
        : `Your spend is concentrated in one category — ${f.category} is ${pct0(
            f.pct,
          )} of outlay (${usdM(f.spend)}), with ${f.cat2} a distant second at ${pct0(
            f.cat2Pct,
          )}. A shock in that market has no fallback.`;
    case "cycle_constraint":
      return tone === "executive"
        ? `Working capital is trapped in one process stage: ${f.stage} runs ${f.mean.toFixed(
            0,
          )} days, ${pct0(f.sharePct)} of the procure-to-pay cycle.`
        : `Working capital is stuck in ${f.stage}: it averages ${f.mean.toFixed(
            0,
          )} days — ${pct0(
            f.sharePct,
          )} of the cycle and the binding constraint on cash. It is an internal stage, fixable without touching a supplier.`;
    case "control_weakness":
      return `${usdM(f.failedSpend)} of spend (${pct0(
        f.pctAtRisk,
      )}) cleared payment without a complete three-way match${
        tone === "executive" ? "" : ` — a control gap spread across ${f.nSuppliers} suppliers`
      }.`;
    case "temporal_move":
      return `A dependency is forming quietly: ${
        tone === "executive" ? "a fast-growing supplier" : f.supplier
      }${
        f.spendPct != null ? ` grew ${f.spendPct > 0 ? "+" : ""}${f.spendPct}% year-on-year` : ""
      }${f.quadFrom && f.quadTo ? ` and moved ${f.quadFrom}→${f.quadTo}` : ""}.`;
    case "lens_disagreement":
      return `${
        tone === "executive" ? "One supplier" : f.supplier
      } is the roster's sharpest contradiction — ${f.verdict.toLowerCase()}.`;
  }
}

function situationParagraphs(s: SituationFacts, tone: ReportTone): string[] {
  const paras: string[] = [];
  // ¶1 — scale + concentration.
  paras.push(
    `Across ${s.totalPos ? `${intl.format(s.totalPos)} purchase orders ` : ""}${
      tone === "executive" ? "" : "in this period "
    }you spent ${usdM(s.totalSpend)} with ${intl.format(
      s.activeSuppliers,
    )} suppliers. Spend is led by ${s.cat1} at ${pct0(s.cat1Pct)} of outlay${
      s.cat1Pct >= 40 ? " — a pronounced single-category dependency" : ""
    }.`,
  );
  // ¶2 — THE CROSS-ANALYSIS JOIN (the whole point).
  if (s.classAN > 0) {
    const strat =
      s.aAndStrategicN > 0
        ? `${s.aAndStrategicN} of them are also Strategic — high-value and hard to replace`
        : `none of them sit in the Strategic quadrant`;
    if (s.aAndCriticalN > 0) {
      const method =
        tone === "analytical"
          ? ` (below the ${s.perfMedian.toFixed(0)}-point performance median)`
          : "";
      paras.push(
        `The suppliers you depend on most and the suppliers performing worst are largely the same set. Of the ${s.classAN} Class-A suppliers that carry ${pct0(
          s.classASpendPct,
        )} of spend, ${strat}; more pointedly, ${s.aAndCriticalN} are underperforming${method} — ${usdM(
          s.aAndCriticalSpend,
        )} of your most important spend is going to suppliers delivering below the median. Concentration and the performance problem are not two issues; they are one.`,
      );
    } else {
      paras.push(
        `Of the ${s.classAN} Class-A suppliers that carry ${pct0(
          s.classASpendPct,
        )} of spend, ${strat}. Encouragingly, none of your highest-value relationships fall into the underperforming (Critical Issues) zone — the concentration is not compounded by a performance problem.`,
      );
    }
  }
  // ¶3 — where the value-at-risk sits (Critical Issues zone), if any.
  if (s.criticalN > 0) {
    const led =
      tone !== "executive" && s.criticalLeaders.length
        ? ` The largest are ${andList(
            s.criticalLeaders.map((l) => `${l.name} (${usdM(l.spend)})`),
          )}.`
        : "";
    paras.push(
      `In total, ${s.criticalN} high-spend suppliers — ${pct0(
        s.criticalSpendPct,
      )} of spend — are underperforming relative to what they are paid, the portfolio's clearest value-at-risk.${led}`,
    );
  }
  return paras;
}

function findingHeadline(f: Finding, s: SituationFacts, tone: ReportTone): string {
  return headlineText(f, s, tone);
}

function findingBody(f: Finding, tone: ReportTone): string[] {
  const exec = tone === "executive";
  const method = tone === "analytical";
  switch (f.key) {
    case "critical_issues":
      return [
        exec
          ? `Committed spend delivering below par. Because the money is already flowing, a performance conversation with this group moves more than any sourcing exercise.`
          : `These suppliers sit in the high-spend, below-median-performance quadrant: you are paying premium volumes for sub-par delivery, quality, or process compliance. Because the spend is already committed, the exposure is immediate — this is where a performance conversation moves the most money.${
              method
                ? ` The quadrant is the spend-median × performance-median split; membership is data-driven, not a watchlist.`
                : ""
            }`,
      ];
    case "concentration":
      return [
        exec
          ? `A single category at ${pct0(
              f.pct,
            )} of spend concentrates price, continuity, and supply-shock risk with no substitute market.`
          : `A single category at ${pct0(
              f.pct,
            )} of spend means a disruption, price move, or supply shock in ${f.category} flows straight to the bottom line, with limited ability to substitute. ${f.cat2} is the next-largest at ${pct0(
              f.cat2Pct,
            )} — there is no second market absorbing the risk.`,
      ];
    case "cycle_constraint":
      return [
        exec
          ? `${f.stage} is the binding constraint on cash — an internal stage, improvable without touching a supplier.`
          : `At a median cycle of ${f.cycleMedian.toFixed(
              0,
            )} days, ${f.stage} alone consumes ${pct0(
              f.sharePct,
            )} of the elapsed time. It is an internal, controllable stage — improving it shortens the whole cycle and frees working capital without touching a single supplier relationship.${
              method
                ? ` "Internal" excludes PO→Delivery (physical lead time); the flag is a stage mean above ${STAGE_FLAG_DAYS} days.`
                : ""
            }`,
      ];
    case "control_weakness":
      return [
        exec
          ? `${usdM(
              f.failedSpend,
            )} paid without a complete three-way match — a governance gap, not a rounding error.`
          : `A failed three-way match means goods, order, and invoice did not reconcile before payment left — the classic opening for overpayment and duplicate billing. At ${usdM(
              f.failedSpend,
            )} across ${f.nSuppliers} suppliers, this is a governance gap, not a rounding error.`,
      ];
    case "temporal_move":
      return [
        `${exec ? "A supplier" : f.supplier} moved sharply year-on-year${
          f.spendPct != null ? ` on spend (${f.spendPct > 0 ? "+" : ""}${f.spendPct}%)` : ""
        }${
          f.quadFrom && f.quadTo ? ` and changed exposure quadrant (${f.quadFrom}→${f.quadTo})` : ""
        }. Fast movers are where dependencies form before anyone has decided to depend on them — worth a look while the relationship is still small enough to shape.`,
      ];
    case "lens_disagreement":
      return [
        `${exec ? "This supplier" : f.supplier} ranks at opposite ends of the roster depending on the lens — ${f.verdict.toLowerCase()}. A supplier that looks safe on one axis and dangerous on another rewards a closer look than any single score would suggest.`,
      ];
  }
}

function findingEvidence(f: Finding): EvidenceStat[] {
  switch (f.key) {
    case "critical_issues":
      return [
        { label: "Underperforming high-spend suppliers", value: `${f.n}` },
        { label: "Share of spend at risk", value: pct0(f.spendPct) },
        {
          label: "Largest exposure",
          value: f.leaders[0] ? `${f.leaders[0].name} · ${usdM(f.leaders[0].spend)}` : "—",
        },
      ];
    case "concentration":
      return [
        { label: "Top category", value: f.category },
        { label: "Share of spend", value: pct0(f.pct) },
        { label: "Category spend", value: usdM(f.spend) },
      ];
    case "cycle_constraint":
      return [
        { label: "Slowest internal stage", value: f.stage },
        { label: "Average duration", value: `${f.mean.toFixed(1)} days` },
        { label: "Share of cycle", value: pct0(f.sharePct) },
      ];
    case "control_weakness":
      return [
        { label: "Spend without a clean match", value: usdM(f.failedSpend) },
        { label: "Share of spend", value: pct0(f.pctAtRisk) },
        { label: "Suppliers affected", value: `${f.nSuppliers}` },
      ];
    case "temporal_move":
      return [
        { label: "Supplier", value: f.supplier },
        {
          label: "Year-on-year spend",
          value: f.spendPct != null ? `${f.spendPct > 0 ? "+" : ""}${f.spendPct}%` : "—",
        },
        {
          label: "Exposure shift",
          value: f.quadFrom && f.quadTo ? `${f.quadFrom} → ${f.quadTo}` : "—",
        },
      ];
    case "lens_disagreement":
      return [
        { label: "Supplier", value: f.supplier },
        { label: "Lens spread", value: "≥ 80 pts" },
        { label: "Spend", value: f.spend != null ? usdM(f.spend) : "—" },
      ];
  }
}

function findingRecommendation(
  f: Finding,
  recs: RecommendationsResult | null,
): { text: string; amount: number | null } {
  const byType = (t: string) => (recs?.recommendations ?? []).filter((r) => r.type === t);
  switch (f.key) {
    case "critical_issues": {
      const names = f.leaders.map((l) => l.name);
      return {
        text: `Open structured performance reviews with ${
          names.length ? andList(names) : "the underperforming Class-A suppliers"
        }; put improvement plans (or an exit) against the ${usdM(f.spend)} at stake.`,
        amount: f.spend,
      };
    }
    case "concentration":
      return {
        text: `Reduce single-market dependency in ${f.category}: qualify at least one alternate source and split award on the next cycle.`,
        amount: f.spend,
      };
    case "cycle_constraint":
      return {
        text: `Streamline ${f.stage} — the largest internal stage in the cycle. ${
          byType("slow_stage").length ? firstSentence(byType("slow_stage")[0].reasoning) : ""
        }`.trim(),
        amount: null,
      };
    case "control_weakness":
      return {
        text: `Tighten three-way-match enforcement before payment for the ${f.nSuppliers} affected suppliers; block release on unmatched invoices.`,
        amount: f.failedSpend,
      };
    case "temporal_move":
      return {
        text: `Review ${f.supplier} now while the spend is still shapeable — confirm the growth is intended and the exposure is acceptable.`,
        amount: f.spend,
      };
    case "lens_disagreement":
      return {
        text: `Investigate ${f.supplier}: reconcile why the spend, performance, and supply-risk lenses disagree so sharply before the next award.`,
        amount: f.spend,
      };
  }
}

function buildActionTable(recs: RecommendationsResult | null): ActionRow[] {
  // ONE row per target: a supplier can carry several recs (e.g. Steward + Engage) —
  // keep only its highest-impact action so the table isn't "Engage X / Steward X"
  // wallpaper.
  const best = new Map<
    string,
    { action: string; amount: number | null; rationale: string; impact: number }
  >();
  for (const r of recs?.recommendations ?? []) {
    const target = r.supplier_name ?? r.scope ?? r.category ?? "Process";
    const cur = best.get(target);
    if (!cur || r.impact_score > cur.impact) {
      best.set(target, {
        action: `${ACTION_VERB[r.action]} ${target}`,
        amount: r.total_spend_usd ?? null,
        rationale: firstSentence(r.reasoning),
        impact: r.impact_score,
      });
    }
  }
  const rows = [...best.values()];
  // Ranked by $-EXPOSURE (amount) desc — items with no $ fall to the bottom, ordered
  // by the engine's impact score. Tiered by POSITION (P1 = top 3, P2 = next 3, P3 =
  // the rest), so the table is a real priority list rather than "everything is P1".
  rows.sort((a, b) => (b.amount ?? -1) - (a.amount ?? -1) || b.impact - a.impact);
  return rows.slice(0, 8).map((r, i) => ({
    priority: (i < 3 ? 1 : i < 6 ? 2 : 3) as 1 | 2 | 3,
    action: r.action,
    amount: r.amount,
    rationale: r.rationale,
  }));
}

function watchingItems(
  temporal: TemporalAnomalies | null,
  temporalLoad: TemporalLoad | undefined | null,
): { intro: string | null; items: string[] } {
  if (temporalLoad && temporalLoad.kind === "no-prior") {
    return { intro: `${temporalLoad.label} is the earliest period — no prior year to compare against.`, items: [] };
  }
  if (temporalLoad && temporalLoad.kind === "partial-year") {
    return {
      intro: `${temporalLoad.label} is a partial year — a year-over-year comparison vs ${temporalLoad.priorLabel} isn't meaningful yet.`,
      items: [],
    };
  }
  if (!temporal || temporal.rows.length === 0) {
    return { intro: null, items: [] };
  }
  const items = temporal.rows.slice(0, 5).map((r) => {
    const bits: string[] = [];
    if (r.spend) bits.push(`spend ${r.spend.pct > 0 ? "rose" : "fell"} ${Math.abs(r.spend.pct)}%`);
    if (r.quadrant) bits.push(`jumped ${r.quadrant.from}→${r.quadrant.to}`);
    if (r.score) bits.push(`performance moved ${r.score.delta > 0 ? "+" : ""}${r.score.delta} pts`);
    const tail =
      r.quadrant && r.quadrant.to === "Bottleneck"
        ? " — a dependency forming quietly"
        : r.quadrant && r.quadrant.to === "Strategic"
          ? " — rising into your critical set"
          : "";
    return `${r.supplier_name}'s ${andList(bits)}${tail}.`;
  });
  return {
    intro: `Year-over-year (${temporal.priorLabel} → ${temporal.latestLabel}), ${temporal.flaggedCount} supplier(s) moved sharply. The ones worth a glance:`,
    items,
  };
}

/** Build + render the full argument for a tone. Pure; numbers == the analyses. */
export function renderReportArgument(
  input: ArgumentInput,
  tone: ReportTone,
): RenderedArgument {
  const { situation, findings, temporal, lensRowsAll } = buildFacts(input);
  const rendered: RenderedFinding[] = findings.map((f) => {
    const rec = findingRecommendation(f, input.recommendations);
    return {
      key: f.key,
      headline: findingHeadline(f, situation, tone),
      body: findingBody(f, tone),
      evidence: findingEvidence(f),
      recommendation: rec.text,
      amount: rec.amount,
    };
  });
  return {
    headline: headlineText(findings[0], situation, tone),
    situation: situationParagraphs(situation, tone),
    findings: rendered,
    actions: buildActionTable(input.recommendations),
    watching: watchingItems(temporal, input.temporal),
    lensRows: lensRowsAll.slice(0, 8).map((r, i) => ({
      supplier_name: r.supplier_name,
      verdict: lensVerdict(r, i === 0),
      spend: r.total_spend_usd,
    })),
    hasArgument: situation.totalSpend > 0,
  };
}
