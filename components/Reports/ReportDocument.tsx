"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { ArrowLeft, ChevronDown, ChevronRight } from "lucide-react";
import type {
  SpendOverviewResult,
  AbcResult,
  KraljicResult,
  KraljicQuadrant,
  CycleTimeResult,
  PerformanceSpendResult,
  RecommendationsResult,
} from "@/lib/analysis-types";
import { deriveReportContext, TEMPLATES } from "@/lib/report-templates";
import { type ReportConfig, type SectionKey } from "@/lib/report-config";
import type { CycleBreakdown } from "@/lib/cycle-time-types";
import type { TemporalLoad } from "@/lib/temporal-anomalies";
import { QUADRANT_COLORS } from "@/lib/chart-colors";
import { renderReportArgument, lensVerdict } from "@/lib/report-narrative";
import { buildClassificationAnomalies, buildAnomalyCrossref } from "@/lib/anomaly-crossref";
import { deriveCycleFlags } from "@/lib/cycle-flags";
import { buildTemporalAnomalies } from "@/lib/temporal-anomalies";
import { usePin } from "@/components/Reports/PinContext";
import { ReportTOC } from "@/components/Reports/ReportTOC";
import { buttonVariants } from "@/components/ui/button";
import { OverviewCharts } from "@/components/analysis/OverviewCharts";
import { CycleTimeView } from "@/components/CycleTimeView";
import { DownloadPdfButton } from "@/components/DownloadPdfButton";

export type ReportAnalyses = {
  spend_overview: SpendOverviewResult | null;
  abc: AbcResult | null;
  kraljic: KraljicResult | null;
  cycle_time: CycleTimeResult | null;
  performance_spend: PerformanceSpendResult | null;
  recommendations: RecommendationsResult | null;
  // Anomaly-hub extras, assembled server-side at report-build so they're present
  // in ALL render paths (incl. static PDF export) — no client fetch. breakdown
  // powers the PROCESS family; temporal (period-aware, BOTH modes — a discriminated
  // TemporalLoad carrying the note states) the CHANGED-OVER-TIME family. Optional so
  // pre-existing callers / older shapes stay valid.
  breakdown?: CycleBreakdown | null;
  temporal?: TemporalLoad | null;
};

export type ReportMeta = {
  title: string;
  periodLabel: string;
  generatedBy: string;
  generatedAt: string; // ISO
  filename: string;
  ephemeral?: boolean;
};

const QUADRANT_ORDER: KraljicQuadrant[] = [
  "Strategic",
  "Leverage",
  "Bottleneck",
  "Routine",
];
const ZONE_ORDER = [
  "Stars",
  "Critical Issues",
  "Hidden Gems",
  "Long Tail",
] as const;
const usd = (n: number) =>
  new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);

// Fixed locale + timeZone so the "Generated …" timestamp is identical on the server
// and the client — a bare toLocaleString() renders in each side's locale/zone and
// caused a hydration mismatch on the persisted (SSR) report page.
const generatedFmt = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium",
  timeStyle: "short",
  timeZone: "Asia/Jakarta",
});

/**
 * A report section (Batch 6c). In the editor (`embedded`) the header is sticky,
 * carries a collapse chevron, and the body collapses via
 * the `hidden` attribute (kept in the DOM so PDF export can reveal it). On the
 * static persisted view it renders as a plain section, unchanged.
 */
function ReportSection({
  id,
  title,
  embedded,
  collapsed,
  onToggle,
  headerExtra,
  children,
}: {
  id: SectionKey;
  title: string;
  embedded: boolean;
  collapsed: boolean;
  onToggle: () => void;
  headerExtra?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section
      id={`section-${id}`}
      className="pdf-page-break flex scroll-mt-24 flex-col gap-4"
    >
      <div
        className={
          embedded
            ? "sticky top-9 z-20 -mx-1 flex items-center gap-2 border-b bg-background/95 px-1 py-1.5 backdrop-blur"
            : "flex items-center gap-2"
        }
      >
        {embedded && (
          <button
            type="button"
            onClick={onToggle}
            aria-label={collapsed ? "Expand section" : "Collapse section"}
            aria-expanded={!collapsed}
            className="no-print shrink-0 text-muted-foreground hover:text-foreground"
          >
            {collapsed ? (
              <ChevronRight className="h-4 w-4" />
            ) : (
              <ChevronDown className="h-4 w-4" />
            )}
          </button>
        )}
        <h2 className="text-xl font-semibold">{title}</h2>
        {embedded && headerExtra}
      </div>
      {/* Collapsed body: hidden on screen (embedded editor), always printed
          (`print:flex`) so the PDF is the complete document. `.hidden` class, not
          the `hidden` attribute (which an author print rule can't override). */}
      <div
        className={`export-reveal flex flex-col gap-4 print:flex ${
          embedded && collapsed ? "hidden" : ""
        }`}
      >
        {children}
      </div>
    </section>
  );
}

export function ReportDocument({
  meta,
  analyses,
  config,
  legacyCycle,
  embedded = false,
}: {
  meta: ReportMeta;
  analyses: ReportAnalyses;
  config: ReportConfig;
  /**
   * Set only for reports persisted before Batch 5 (no `cycle_framing` marker):
   * the stored pre/post automation cycle narrative. When present, the cycle
   * section renders this legacy text + a note instead of the live monitoring
   * view — old reports are preserved as historical context, not back-filled.
   */
  legacyCycle?: string | null;
  /**
   * When true (the live editor at /reports/preview), suppress the built-in
   * sticky header (Back + Download) — the editor shell/sidebar owns those — and
   * enable the Batch 6c chrome (TOC, sticky headers, collapse).
   */
  embedded?: boolean;
}) {
  const { pinnedSupplierId, pin } = usePin();
  const { sections, detailLevel } = config;
  const brief = detailLevel === "brief";
  const detailed = detailLevel === "detailed";

  // Tone narratives are generated at RENDER time from the analyses (default to
  // operational for pre-3d reports that have no tone in their config).
  const tone = config.tone ?? "operational";
  const ctx = deriveReportContext(
    {
      spendOverview: analyses.spend_overview,
      abc: analyses.abc,
      kraljic: analyses.kraljic,
      performanceSpend: analyses.performance_spend,
      cycleTime: analyses.cycle_time,
      recommendations: analyses.recommendations,
    },
    meta.periodLabel,
  );
  const T = TEMPLATES[tone];
  // The decision-first ARGUMENT (headline / situation / findings / actions / watching),
  // computed from the same analyses — numbers identical, tone applied.
  const arg = renderReportArgument(analyses, tone);
  const money = (n: number) =>
    n >= 1_000_000 ? `$${(n / 1_000_000).toFixed(1)}M` : `$${Math.round(n / 1000)}K`;

  // ---- Cross-Analysis Anomaly Hub summary (all 3 families) ------------------
  // Computed synchronously from data assembled into `analyses` server-side, so it
  // renders in every path incl. static PDF (no client fetch). Mirrors the live hub
  // via the same pure libs. Shown at `standard`/`detailed` detail (not `brief`).
  const anomalyBlock = (() => {
    const perf = analyses.performance_spend;
    const kr = analyses.kraljic;
    const abcRes = analyses.abc;
    if (!perf || !kr || !abcRes) return null;

    // Classification (Batch 2) — lens disagreement.
    const supplyRiskById = new Map(
      kr.quadrant_assignments.map((q) => [q.supplier_id, q.supply_risk_score]),
    );
    const abcById = new Map(abcRes.classifications.map((c) => [c.supplier_id, c.abc_class]));
    const cls = buildClassificationAnomalies({ perfSuppliers: perf.suppliers, supplyRiskById, abcById });

    // Process (Batch 1) — cycle flags × position, from the assembled breakdown.
    const bd = analyses.breakdown ?? null;
    const proc = bd
      ? buildAnomalyCrossref({
          flagsBySupplier: deriveCycleFlags({
            roster: bd.bySupplier,
            anomalies: analyses.cycle_time?.anomalies ?? [],
            stageAnomalies: bd.stageAnomalies ?? [],
          }).flagsBySupplier,
          perfSuppliers: perf.suppliers,
          roster: bd.bySupplier,
        })
      : null;

    // Temporal (Batch 3) — period-aware in BOTH modes (mirrors the live Action
    // Priorities hub): single-year compares Y vs Y-1, range compares latest vs prior
    // (partial-year skip). The discriminated TemporalLoad carries the note states, so
    // an inert year (no-prior / partial-year) renders a note, not an empty section.
    const tLoad = analyses.temporal ?? null;
    const temporal =
      tLoad?.kind === "ok" ? buildTemporalAnomalies(tLoad.matrix) : null;
    const temporalNote =
      tLoad?.kind === "no-prior"
        ? `${tLoad.label} is the earliest period — no prior year to compare against.`
        : tLoad?.kind === "partial-year"
          ? `${tLoad.label} is a partial year — a year-over-year comparison vs ${tLoad.priorLabel} isn't meaningful.`
          : temporal && temporal.flaggedCount === 0
            ? `No sharp year-over-year changes (${temporal.priorLabel} → ${temporal.latestLabel}).`
            : null;

    const hasAny =
      cls.flaggedCount > 0 ||
      (proc?.flaggedCount ?? 0) > 0 ||
      (temporal?.flaggedCount ?? 0) > 0 ||
      temporalNote != null;
    if (!hasAny) return null;

    const cap = <T,>(rows: T[]) => (detailed ? rows : rows.slice(0, 6));
    const posText = (r: {
      abc_class: string | null;
      kraljic_quadrant: string | null;
      zone: string | null;
    }) =>
      [r.abc_class ? `Class ${r.abc_class}` : null, r.kraljic_quadrant, r.zone]
        .filter(Boolean)
        .join(" · ");
    const PROC_FLAG_LABEL = {
      has_outlier: "Outlier",
      inconsistent: "Inconsistent",
      has_stage_dom: "Stage-dom",
    } as const;

    return (
      <div className="mt-3 flex flex-col gap-3 border-t pt-3">
        <h4 className="text-sm font-semibold text-foreground">Cross-analysis anomalies</h4>

        {/* Process */}
        {proc && proc.flaggedCount > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">Process — cycle execution</p>
            <p className="text-sm text-muted-foreground">
              {proc.flaggedCount} supplier(s) with cycle-time anomalies — {proc.importantCount}{" "}
              A-tier or Strategic ({usd(proc.importantSpend)}). Outlier {proc.flagMix.has_outlier} ·
              Inconsistent {proc.flagMix.inconsistent} · Stage-dom {proc.flagMix.has_stage_dom}.
            </p>
            <ul className="flex flex-col gap-1">
              {cap(proc.rows).map((r, i) => (
                <li
                  key={r.supplier_id}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm"
                >
                  <span className="font-mono text-xs text-muted-foreground">{i + 1}</span>
                  <span className="font-medium">{r.supplier_name}</span>
                  <span className="text-xs text-muted-foreground">
                    {(["has_outlier", "inconsistent", "has_stage_dom"] as const)
                      .filter((k) => r.flags[k])
                      .map((k) => PROC_FLAG_LABEL[k])
                      .join(" · ")}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">{posText(r)}</span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Classification */}
        {cls.flaggedCount > 0 && (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">
              Classification — lens disagreement
            </p>
            <p className="text-sm text-muted-foreground">
              {cls.flaggedCount} of {cls.rosterSize} supplier(s) rank ≥ 80 percentile-points apart
              across Spend, Performance, and Supply-risk. Ranked by the size of the gap.
            </p>
            <ul className="flex flex-col gap-1">
              {cap(cls.rows).map((r, i) => (
                <li
                  key={r.supplier_id}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm"
                >
                  <span className="font-mono text-xs text-muted-foreground">{i + 1}</span>
                  <span className="font-medium">{r.supplier_name}</span>
                  <span className="text-xs text-muted-foreground">
                    {lensVerdict(r, i === 0)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}

        {/* Changed over time — period-aware (BOTH modes): flagged list, else a note. */}
        {temporal && temporal.flaggedCount > 0 ? (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">
              Changed over time — {temporal.priorLabel} → {temporal.latestLabel}
            </p>
            <p className="text-sm text-muted-foreground">
              {temporal.flaggedCount} of {temporal.rosterSize} supplier(s) moved sharply — Spend{" "}
              {temporal.byDetector.spend} · Quadrant {temporal.byDetector.quadrant} · Score{" "}
              {temporal.byDetector.score}.
              {temporal.skippedLabel ? ` (${temporal.skippedLabel} excluded — partial year.)` : ""}
            </p>
            <ul className="flex flex-col gap-1">
              {cap(temporal.rows).map((r, i) => (
                <li
                  key={r.supplier_id}
                  className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 text-sm"
                >
                  <span className="font-mono text-xs text-muted-foreground">{i + 1}</span>
                  <span className="font-medium">{r.supplier_name}</span>
                  <span className="text-xs text-muted-foreground">
                    {[
                      r.quadrant ? `${r.quadrant.from}→${r.quadrant.to}` : null,
                      r.spend ? `Spend ${r.spend.pct > 0 ? "+" : ""}${r.spend.pct}%` : null,
                      r.score ? `Score ${r.score.delta > 0 ? "+" : ""}${r.score.delta}` : null,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </span>
                  <span className="ml-auto text-xs text-muted-foreground">{posText(r)}</span>
                </li>
              ))}
            </ul>
          </div>
        ) : temporalNote ? (
          <div className="flex flex-col gap-1">
            <p className="text-sm font-medium text-foreground">Changed over time</p>
            <p className="text-sm text-muted-foreground">{temporalNote}</p>
          </div>
        ) : null}
      </div>
    );
  })();

  // ---- Section chrome (Batch 6c, editor only) -------------------------------
  // Collapse + scroll-spy are per-session local state. ReportEditor remounts
  // this component on period change (key={spanKey}), so they reset there — no
  // effect needed.
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [activeId, setActiveId] = useState<string | null>(null);

  const toggleCollapse = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const visibleSections = useMemo(() => {
    const list: { id: string; label: string }[] = [
      { id: "cover", label: "Executive Summary" },
    ];
    if (brief) return list;
    const add = (cond: unknown, id: string, label: string) => {
      if (cond) list.push({ id, label });
    };
    add(sections.spendOverview && analyses.spend_overview, "spendOverview", "Spend Overview");
    add(sections.abc && analyses.abc, "abc", "ABC Analysis");
    add(sections.kraljic && analyses.kraljic, "kraljic", "Supplier Quadrant");
    add(sections.performanceSpend && analyses.performance_spend, "performanceSpend", "Performance vs Spend");
    add(sections.cycleTime && (legacyCycle || analyses.cycle_time), "cycleTime", "Cycle Time");
    add(sections.actionDashboard, "actionDashboard", "Action Priorities");
    add(sections.methodology, "methodology", "Methodology");
    return list;
  }, [brief, sections, analyses, legacyCycle]);

  const visibleKey = visibleSections.map((s) => s.id).join(",");

  // Scroll-spy: highlight the section nearest the top of the viewport.
  useEffect(() => {
    if (!embedded) return;
    const els = visibleSections
      .map((s) => document.getElementById(`section-${s.id}`))
      .filter((e): e is HTMLElement => e != null);
    if (els.length === 0) return;
    const obs = new IntersectionObserver(
      (entries) => {
        const visible = entries.filter((e) => e.isIntersecting);
        if (visible.length === 0) return;
        visible.sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top);
        setActiveId(visible[0].target.id.replace(/^section-/, ""));
      },
      { rootMargin: "-76px 0px -55% 0px", threshold: 0 },
    );
    els.forEach((e) => obs.observe(e));
    return () => obs.disconnect();
    // visibleKey captures the observed set; re-run when it changes.
  }, [embedded, visibleKey]); // eslint-disable-line react-hooks/exhaustive-deps

  const onSectionClick = useCallback((id: string) => {
    setCollapsed((prev) => {
      if (!prev.has(id)) return prev;
      const next = new Set(prev);
      next.delete(id);
      return next;
    });
    requestAnimationFrame(() => {
      document
        .getElementById(`section-${id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);

  return (
    <div className="flex flex-col gap-4">
      {!embedded && (
        <div className="no-print sticky top-0 z-10 -mx-6 flex items-center justify-between gap-4 border-b bg-background/95 px-6 py-3 backdrop-blur">
          <Link
            href="/reports"
            className={buttonVariants({ variant: "ghost", size: "sm" })}
          >
            <ArrowLeft className="h-4 w-4" /> Back to Reports
          </Link>
          <span className="hidden truncate text-sm font-medium sm:block">
            {meta.title}
          </span>
          <DownloadPdfButton filename={meta.filename} />
        </div>
      )}

      <div
        id="report-root"
        className="mx-auto flex w-full max-w-[820px] flex-col gap-8"
      >
        {embedded && (
          <ReportTOC
            sections={visibleSections}
            activeId={activeId}
            onSectionClick={onSectionClick}
          />
        )}

        {/* Cover — always */}
        <section
          id="section-cover"
          className="pdf-page-break flex scroll-mt-24 flex-col gap-3 rounded-lg border bg-card p-8"
        >
          <p className="text-xs uppercase tracking-wide text-muted-foreground">
            Procurement Analytics
          </p>
          <h1 className="text-3xl font-bold">{meta.title}</h1>
          <p className="text-sm text-muted-foreground">
            Period: {meta.periodLabel} &middot; {detailLevel} detail &middot;
            Generated {generatedFmt.format(new Date(meta.generatedAt))} by{" "}
            {meta.generatedBy}
            {meta.ephemeral ? " · not saved (range report)" : ""}
          </p>
          {/* THE HEADLINE — the single most important finding, stated plainly. */}
          {arg.hasArgument && (
            <p className="mt-4 text-lg font-medium leading-snug text-foreground">
              {arg.headline}
            </p>
          )}
        </section>

        {/* ── THE ARGUMENT — front matter, always (even in brief) ───────────── */}
        {arg.hasArgument && (
          <>
            <section
              id="section-situation"
              className="pdf-page-break flex scroll-mt-24 flex-col gap-3"
            >
              <h2 className="text-xl font-semibold">The situation</h2>
              {arg.situation.map((p, i) => (
                <p key={i} className="text-sm leading-relaxed">
                  {p}
                </p>
              ))}
            </section>

            {arg.findings.length > 0 && (
              <section
                id="section-findings"
                className="pdf-page-break flex scroll-mt-24 flex-col gap-4"
              >
                <h2 className="text-xl font-semibold">What we found</h2>
                {arg.findings.map((f, i) => (
                  <div
                    key={f.key}
                    data-slot="card"
                    className="flex flex-col gap-2 rounded-xl bg-card p-4 text-sm ring-1 ring-foreground/10"
                  >
                    <h3 className="font-semibold leading-snug">
                      {i + 1}. {f.headline}
                    </h3>
                    {f.body.map((b, j) => (
                      <p key={j} className="leading-relaxed text-muted-foreground">
                        {b}
                      </p>
                    ))}
                    <div className="mt-1 grid grid-cols-3 gap-2">
                      {f.evidence.map((e, k) => (
                        <div key={k} className="rounded-md bg-muted/50 p-2">
                          <div className="font-semibold">{e.value}</div>
                          <div className="text-[11px] leading-tight text-muted-foreground">
                            {e.label}
                          </div>
                        </div>
                      ))}
                    </div>
                    <p className="mt-1 border-l-2 border-primary pl-3 leading-relaxed">
                      <span className="font-semibold">Recommended:</span>{" "}
                      {f.recommendation}
                    </p>
                  </div>
                ))}
              </section>
            )}

            {arg.actions.length > 0 && (
              <section
                id="section-actions"
                className="pdf-page-break flex scroll-mt-24 flex-col gap-3"
              >
                <h2 className="text-xl font-semibold">What to do</h2>
                <p className="text-sm text-muted-foreground">
                  Prioritised by exposure — P1 is where the largest spend is at stake.
                </p>
                <table className="w-full border-collapse text-sm">
                  <thead>
                    <tr className="border-b text-left text-xs uppercase tracking-wide text-muted-foreground">
                      <th className="py-2 pr-2">Priority</th>
                      <th className="py-2 pr-2">Action</th>
                      <th className="py-2 pr-2 text-right">At stake</th>
                      <th className="py-2">Why</th>
                    </tr>
                  </thead>
                  <tbody>
                    {arg.actions.map((a, i) => (
                      <tr key={i} className="border-b align-top">
                        <td className="py-2 pr-2 font-semibold">P{a.priority}</td>
                        <td className="py-2 pr-2 font-medium">{a.action}</td>
                        <td className="py-2 pr-2 text-right tabular-nums">
                          {a.amount != null ? money(a.amount) : "—"}
                        </td>
                        <td className="py-2 text-muted-foreground">{a.rationale}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </section>
            )}

            {(arg.watching.intro || arg.watching.items.length > 0) && (
              <section
                id="section-watching"
                className="pdf-page-break flex scroll-mt-24 flex-col gap-2"
              >
                <h2 className="text-xl font-semibold">Worth watching</h2>
                {arg.watching.intro && (
                  <p className="text-sm text-muted-foreground">{arg.watching.intro}</p>
                )}
                {arg.watching.items.length > 0 && (
                  <ul className="list-disc space-y-1 pl-5 text-sm">
                    {arg.watching.items.map((w, i) => (
                      <li key={i}>{w}</li>
                    ))}
                  </ul>
                )}
              </section>
            )}
          </>
        )}

        {/* ── APPENDIX — the workings; dropped entirely in brief. ───────────── */}
        {!brief && (
          <>
            <section
              id="section-appendix"
              className="pdf-page-break flex scroll-mt-24 flex-col gap-1"
            >
              <h2 className="text-xl font-semibold">Appendix — supporting analysis</h2>
              <p className="text-sm text-muted-foreground">
                The full workings behind the findings above: the spend, ABC, Kraljic,
                performance, and cycle-time analyses, plus the cross-analysis anomaly
                detail.
              </p>
            </section>
            {/* Spend Overview */}
            {sections.spendOverview && analyses.spend_overview && (
              <ReportSection
                id="spendOverview"
                title="Spend Overview"
                embedded={embedded}
                collapsed={collapsed.has("spendOverview")}
                onToggle={() => toggleCollapse("spendOverview")}
              >
                <OverviewCharts spend={analyses.spend_overview} embedded={embedded} />
                <p className="text-sm leading-relaxed text-muted-foreground">
                  {T.spendOverview(ctx)}
                </p>
              </ReportSection>
            )}

            {/* ABC Analysis */}
            {sections.abc && analyses.abc && (
              <ReportSection
                id="abc"
                title="ABC Analysis"
                embedded={embedded}
                collapsed={collapsed.has("abc")}
                onToggle={() => toggleCollapse("abc")}
              >
                {(() => {
                  const rows = analyses.abc!.classifications;
                  const shown = detailed ? rows : rows.slice(0, 20);
                  return (
                    <>
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b text-left text-muted-foreground">
                            <th className="py-1 text-right font-medium">#</th>
                            <th className="py-1 font-medium">Supplier</th>
                            <th className="py-1 font-medium">Class</th>
                            <th className="py-1 text-right font-medium">Spend</th>
                            <th className="py-1 text-right font-medium">%</th>
                          </tr>
                        </thead>
                        <tbody>
                          {shown.map((c) => (
                            <tr
                              key={c.supplier_id}
                              onClick={() => pin(c.supplier_id)}
                              className={`cursor-pointer border-b ${
                                c.supplier_id === pinnedSupplierId
                                  ? "bg-foreground/5 ring-1 ring-inset ring-foreground/30"
                                  : "hover:bg-muted/50"
                              }`}
                            >
                              <td className="py-1 text-right">{c.rank}</td>
                              <td className="py-1 font-medium">
                                {c.supplier_name}
                              </td>
                              <td className="py-1">{c.abc_class}</td>
                              <td className="py-1 text-right">{usd(c.total)}</td>
                              <td className="py-1 text-right">
                                {(c.pct * 100).toFixed(1)}%
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      {!detailed && rows.length > 20 && (
                        <p className="text-xs text-muted-foreground">
                          Showing top 20 of {rows.length}. Use Detailed for the
                          full list.
                        </p>
                      )}
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {T.abc(ctx)}
                      </p>
                    </>
                  );
                })()}
              </ReportSection>
            )}

            {/* Supplier Quadrant (Kraljic) */}
            {sections.kraljic && analyses.kraljic && (
              <ReportSection
                id="kraljic"
                title="Supplier Quadrant (Kraljic Matrix)"
                embedded={embedded}
                collapsed={collapsed.has("kraljic")}
                onToggle={() => toggleCollapse("kraljic")}
              >
                {(() => {
                  const assigns = analyses.kraljic!.quadrant_assignments;
                  return (
                    <>
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b text-left text-muted-foreground">
                            <th className="py-2 font-medium">Quadrant</th>
                            <th className="py-2 text-right font-medium">
                              Suppliers
                            </th>
                            <th className="py-2 text-right font-medium">
                              % of Spend
                            </th>
                            <th className="py-2 text-right font-medium">
                              Avg Performance
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {QUADRANT_ORDER.map((q) => {
                            const p = analyses.kraljic!.quadrant_profiles.find(
                              (x) => x.quadrant === q,
                            );
                            return (
                              <tr key={q} className="border-b">
                                <td className="py-2 font-medium">
                                  <span
                                    className="mr-2 inline-block h-3 w-3 rounded-full align-middle"
                                    style={{ backgroundColor: QUADRANT_COLORS[q] }}
                                  />
                                  {q}
                                </td>
                                <td className="py-2 text-right">
                                  {p?.n_suppliers ?? 0}
                                </td>
                                <td className="py-2 text-right">
                                  {(p?.pct_of_total_spend ?? 0).toFixed(1)}%
                                </td>
                                <td className="py-2 text-right">
                                  {p?.avg_performance_score != null
                                    ? p.avg_performance_score.toFixed(1)
                                    : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {T.kraljic(ctx)}
                      </p>
                      {detailed && (
                        <table className="w-full border-collapse text-xs">
                          <thead>
                            <tr className="border-b text-left text-muted-foreground">
                              <th className="py-1 font-medium">Supplier</th>
                              <th className="py-1 font-medium">Quadrant</th>
                              <th className="py-1 text-right font-medium">
                                Supply risk
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {assigns.map((a) => (
                              <tr key={a.supplier_id} className="border-b">
                                <td className="py-1">{a.supplier_name}</td>
                                <td className="py-1">{a.quadrant}</td>
                                <td className="py-1 text-right">
                                  {a.supply_risk_score.toFixed(1)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </>
                  );
                })()}
              </ReportSection>
            )}

            {/* Performance vs Spend */}
            {sections.performanceSpend && analyses.performance_spend && (
              <ReportSection
                id="performanceSpend"
                title="Performance vs Spend"
                embedded={embedded}
                collapsed={collapsed.has("performanceSpend")}
                onToggle={() => toggleCollapse("performanceSpend")}
              >
                {(() => {
                  const ps = analyses.performance_spend!;
                  const crit = ps.top_critical_issues;
                  const fullRows = ps.suppliers;
                  return (
                    <>
                      <table className="w-full border-collapse text-sm">
                        <thead>
                          <tr className="border-b text-left text-muted-foreground">
                            <th className="py-2 font-medium">Zone</th>
                            <th className="py-2 text-right font-medium">
                              Suppliers
                            </th>
                            <th className="py-2 text-right font-medium">
                              % of Spend
                            </th>
                            <th className="py-2 text-right font-medium">
                              Avg Performance
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {ZONE_ORDER.map((z) => {
                            const p = ps.zone_profiles.find((x) => x.zone === z);
                            return (
                              <tr key={z} className="border-b">
                                <td className="py-2 font-medium">{z}</td>
                                <td className="py-2 text-right">
                                  {p?.n_suppliers ?? 0}
                                </td>
                                <td className="py-2 text-right">
                                  {(p?.pct_of_total_spend ?? 0).toFixed(1)}%
                                </td>
                                <td className="py-2 text-right">
                                  {p?.avg_performance != null
                                    ? p.avg_performance.toFixed(1)
                                    : "—"}
                                </td>
                              </tr>
                            );
                          })}
                        </tbody>
                      </table>
                      <p className="text-sm leading-relaxed text-muted-foreground">
                        {T.performanceSpend(ctx)}
                      </p>
                      {crit.length > 0 && (
                        <div>
                          <h3 className="mb-1 text-sm font-semibold">
                            Top critical issues (high spend, low performance)
                          </h3>
                          <ul className="list-disc space-y-1 pl-5 text-sm text-muted-foreground">
                            {crit.map((s) => (
                              <li key={s.supplier_id}>
                                {s.supplier_name} — {usd(s.total_spend_usd)},
                                performance {s.performance_score.toFixed(1)}
                              </li>
                            ))}
                          </ul>
                        </div>
                      )}
                      {detailed && (
                        <table className="w-full border-collapse text-xs">
                          <thead>
                            <tr className="border-b text-left text-muted-foreground">
                              <th className="py-1 font-medium">Supplier</th>
                              <th className="py-1 font-medium">Zone</th>
                              <th className="py-1 text-right font-medium">Spend</th>
                              <th className="py-1 text-right font-medium">Perf.</th>
                            </tr>
                          </thead>
                          <tbody>
                            {fullRows.map((s) => (
                              <tr key={s.supplier_id} className="border-b">
                                <td className="py-1">{s.supplier_name}</td>
                                <td className="py-1">{s.zone}</td>
                                <td className="py-1 text-right">
                                  {usd(s.total_spend_usd)}
                                </td>
                                <td className="py-1 text-right">
                                  {s.performance_score.toFixed(1)}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      )}
                    </>
                  );
                })()}
              </ReportSection>
            )}

            {/* Cycle Time */}
            {sections.cycleTime &&
              (legacyCycle ? (
                // Pre-Batch-5 report: preserve the original pre/post framing.
                <ReportSection
                  id="cycleTime"
                  title="Cycle Time"
                  embedded={embedded}
                  collapsed={collapsed.has("cycleTime")}
                  onToggle={() => toggleCollapse("cycleTime")}
                >
                  <p className="rounded-md border border-amber-500/40 bg-amber-50 p-3 text-xs text-amber-800 dark:bg-amber-950/30 dark:text-amber-300">
                    This report uses the legacy pre/post automation comparison
                    framing. New reports use ongoing process health monitoring.
                  </p>
                  <p className="text-sm leading-relaxed text-muted-foreground">
                    {legacyCycle}
                  </p>
                </ReportSection>
              ) : (
                analyses.cycle_time && (
                  <ReportSection
                    id="cycleTime"
                    title="Cycle Time — Process Health Monitoring"
                    embedded={embedded}
                    collapsed={collapsed.has("cycleTime")}
                    onToggle={() => toggleCollapse("cycleTime")}
                  >
                    <CycleTimeView data={analyses.cycle_time} embedded={embedded} />
                    <p className="text-sm leading-relaxed text-muted-foreground">
                      {T.cycleTime(ctx)}
                    </p>
                  </ReportSection>
                )
              ))}

            {/* Cross-analysis anomalies — appendix evidence, readable (no S/P/R codes).
                All three families are computed server-side (perf + kraljic + abc for
                classification, the cycle-time breakdown for process, the temporal matrix
                for changed-over-time), so they survive static PDF export and match the
                live hub. The grouped recommendation cards were removed — the prioritised
                "What to do" table above replaces them. */}
            {sections.actionDashboard && anomalyBlock && (
              <section
                id="section-actionDashboard"
                className="pdf-page-break flex scroll-mt-24 flex-col"
              >
                {anomalyBlock}
              </section>
            )}

            {/* Methodology */}
            {sections.methodology && (
              <ReportSection
                id="methodology"
                title="Methodology"
                embedded={embedded}
                collapsed={collapsed.has("methodology")}
                onToggle={() => toggleCollapse("methodology")}
              >
                <div className="flex flex-col gap-2 text-sm text-muted-foreground">
                  <p>{T.methodology(ctx)}</p>
                  <p className="text-xs">
                    Synthetic data calibrated to APQC, Hackett Group, CIPS, MOPS,
                    and AME benchmarks. References: Juran (1951); Mann &amp;
                    Whitney (1947); Kraljic (1983).
                  </p>
                </div>
              </ReportSection>
            )}
          </>
        )}
      </div>
    </div>
  );
}
