> # ⚠️ STALE — PRE-MIGRATION DOCUMENT
>
> **This map describes the OLD flat-`Purchase` data model, which no longer exists.**
> It was written before the normalized 12-table migration
> (`8bc872e` → `eece0c0`, branch `feature/normalized-data-model`) and is retained as a
> historical record of the pre-migration architecture, not as a description of the
> system today.
>
> **What changed, in one paragraph:** the single flat `Purchase` table was replaced by a
> 12-table document graph (Supplier / Framework / Requisition / SourcingEvent / Response
> / PurchaseOrder / PoLine / GoodsReceipt / GrnLine / Invoice / InvoiceLine / Payment).
> A plain Postgres VIEW, `EnrichedPurchase`, reconstructs a PO-grain row with
> **byte-identical column names** to the old `Purchase`, so most read paths and the
> entire Python compute layer were re-pointed without renaming anything. Item-level
> columns (`itemName` / `unit` / `unitPriceUsd` / per-line quantity) are NOT on the view
> and are read from `PoLine` via `lib/po-lines.ts`. Period membership moved from payment
> year to **order year** (`poDate`). Write paths were disabled during the migration and
> have since been restored: supplier CRUD with an audit log, a 12-sheet replace-all
> importer, full-chain transaction creation, and append-only corrections against
> immutable posted records.
>
> **Current source of truth:** `CLAUDE.md` → "CURRENT ARCHITECTURE" + `git log`.
>
> Anywhere below that says `prisma.purchase`, `Purchase` columns, the two-file
> Suppliers/Purchases upload, `import_compute.py`, or `/api/sample-data`, read it as
> history. Those code paths are deleted.

# ARCHITECTURE MAP 04 — Process Health Monitoring & Action Priorities

Scope: the two dashboard pages that carry the app's two regression-gate numbers.
Every claim below cites `path:line` and quotes actual code. Detection logic
(`deriveCycleFlags`, `buildAnomalyHub`, `buildClassificationAnomalies`,
`buildTemporalAnomalies`) lives in orchestrator-owned libs — this section documents
how these pages **consume** it and where each count **surfaces**; the count
reconciliation itself is `_06 §4`.

Regression gates:
- **Process Health flags = 14 / 2 / 35** (outlier suppliers / inconsistent / stage-dominated), Range.
- **Action Priorities hub = 46 / 36 / 11 / 18** (total / process / lens / temporal; Important 17, In-2+ 19), Range.

---

## FILE COVERAGE (25 assigned + 2 supporting)

| # | File | Documented in |
|---|------|---------------|
| 1 | `app/(dashboard)/action-dashboard/page.tsx` | §2 (Action) a–e |
| 2 | `app/(dashboard)/process-health/page.tsx` | §1 (Process) a–e |
| 3 | `app/api/analyses/compute-range/route.ts` | §1b/§2b |
| 4 | `app/api/analyses/compute/route.ts` | §1b/§2b |
| 5 | `app/api/cycle-time/breakdown/route.ts` | §1b |
| 6 | `app/api/cycle-time/stage-occupancy/route.ts` | §1b/§1c |
| 7 | `app/api/cycle-time/supplier-detail/route.ts` | §1b/§1e |
| 8 | `components/ActionDashboardView.tsx` | §2 all |
| 9 | `components/ActionInsightCard.tsx` | §2d/§2e |
| 10 | `components/CycleTime/CycleStatGrid.tsx` | §1c |
| 11 | `components/CycleTime/CycleSupplierSection.tsx` | §1c/§1e |
| 12 | `components/CycleTime/CycleTimeAnomalyCards.tsx` | §1c (14/2/35 render) |
| 13 | `components/CycleTime/CycleTimeClient.tsx` | §1b/§1c/§1e |
| 14 | `components/CycleTime/CycleTimeGlancePanel.tsx` | §1c |
| 15 | `components/CycleTime/CycleTimeSupplierDetailPanel.tsx` | §1c/§1e |
| 16 | `components/CycleTime/StageBreakdownSection.tsx` | §1c/§1d |
| 17 | `components/CycleTime/StageDecompositionTable.tsx` | §1c |
| 18 | `components/CycleTimeView.tsx` | §1c + SHARED-GATES block |
| 19 | `components/charts/CycleTimeBoxPlot.tsx` | §1c |
| 20 | `components/charts/MonthlyCycleTrendChart.tsx` | §1c |
| 21 | `components/charts/StageByCategoryChart.tsx` | §1c |
| 22 | `components/charts/StageOccupancyChart.tsx` | §1c |
| 23 | `lib/action-insights.ts` | §2c (11 insight keys) |
| 24 | `lib/action-priorities.ts` | §2c (8 cats + 3 groups) |
| 25 | `lib/cycle-time-types.ts` | TYPES block |
| S1 | `lib/cycle-breakdown.ts` (supporting — breakdown route delegate) | §1b (Prisma select) |
| S2 | `components/analysis/RangeCompute.tsx` (supporting — range path) | §1b/§2b |

---

# §1 — PROCESS HEALTH MONITORING

Route `/process-health` (URL renamed from `/cycle-time`, redirect elsewhere; the
`/api/cycle-time/*` API paths kept). Page component: `app/(dashboard)/process-health/page.tsx`.

## §1a — PURPOSE

Procure-to-pay process-health monitoring across the supplier base. `process-health/page.tsx:17-18`:

```
const title = "Process Health Monitoring";
const subtitle = "Procure-to-pay process health across the supplier base";
```

Renders (`process-health/page.tsx:78-89`) an `<h1>` = `{title}{label ? " — {label}" : ""}` and the subtitle `<p className="text-sm text-muted-foreground">`, then `{content}`.

## §1b — DATA SOURCES

### Server page — cached vs range branch

`process-health/page.tsx:14-15` resolves the period:
```
const selection = await getCurrentPeriodSelection();
const source = await resolveAnalysisSource(selection);
```
Three branches on `source.kind` (`process-health/page.tsx:23,25,63`):

- **`"empty"`** → `<EmptyState />` (`:24`).
- **`"cached"` (single-year)** — parallel load (`:26-32`):
  ```
  const [cycleTime, period] = await Promise.all([
    getAnalysisResult<CycleTimeResult>(source.periodId, "cycle_time"),
    prisma.reportingPeriod.findUnique({
      where: { id: source.periodId },
      select: { startDate: true, endDate: true },
    }),
  ]);
  ```
  Then a **previous-period lookup** for the glance trend line (`:37-50`):
  ```
  const prevPeriod = await prisma.reportingPeriod.findFirst({
    where: { startDate: { lt: period.startDate } },
    orderBy: { startDate: "desc" },
    select: { id: true, name: true },
  });
  ...
  const prevCt = await getAnalysisResult<CycleTimeResult>(prevPeriod.id, "cycle_time");
  if (prevCt?.distribution.median != null) {
    previousMedian = prevCt.distribution.median;
    previousLabel = prevPeriod.name;
  }
  ```
  Passes `cachedCycleTime={cycleTime}`, `isRangeMode={false}`, `previousMedian`, `previousLabel` to `CycleTimeClient` (`:51-60`).
- **`"range"` (else)** — `CycleTimeClient` with `cachedCycleTime={null}`, `isRangeMode={true}`, `previousMedian={null}`, keyed `${source.startDate}_${source.endDate}` (`:64-75`).

So in cached mode the `cycle_time` analysis is server-loaded; in range mode the client fetches it. The client fetch is in `CycleTimeClient.tsx:77-93`:
```
useEffect(() => {
  if (cachedCycleTime) return;
  ...
  fetch("/api/analyses/compute-range", { method: "POST", ...
    body: JSON.stringify({ startDate, endDate }) })
    ...
    .then((d) => { if (!cancelled) setCtState({ key: k, data: d.cycle_time ?? undefined }); })
```
`if (cachedCycleTime) return;` (`:78`) is the gate that skips the fetch in cached mode.

### The three cycle-time API routes

**1. `/api/cycle-time/breakdown` — the roster + control exposure.** The route file (`app/api/cycle-time/breakdown/route.ts`) is a thin auth+validate wrapper that delegates to `computeCycleBreakdown` (`breakdown/route.ts:37`):
```
const result = await computeCycleBreakdown(start, end);
return NextResponse.json(result);
```
Auth: `getSession()` → 401 if none (`:16-19`). Validation: `start`/`end` must match `/^\d{4}-\d{2}-\d{2}$/` (`:7,24-29`), `end >= start` (`:30-35`). The actual Prisma query lives in the delegate `lib/cycle-breakdown.ts:59-80` (extracted verbatim so route + report assembly share one source):
```
const purchases = await prisma.purchase.findMany({
  where: {
    paymentDate: {
      gte: new Date(`${start}T00:00:00`),
      lte: new Date(`${end}T23:59:59`),
    },
  },
  select: {
    poId: true, invoiceDate: true, supplierExternalId: true, supplierName: true,
    category: true, prToPoDays: true, poToDeliveryDays: true,
    deliveryToInvoiceDays: true, invoiceToPaymentDays: true, totalCycleDays: true,
    threeWayMatchPass: true, totalValueUsd: true,
  },
});
```
The **control-exposure aggregate** (`cycle-breakdown.ts:229-240`):
```
const failedPos = purchases.filter((p) => !p.threeWayMatchPass);
const failedSpend = failedPos.reduce((s, p) => s + p.totalValueUsd, 0);
const totalSpend = purchases.reduce((s, p) => s + p.totalValueUsd, 0);
const controlExposure = {
  failed_spend: failedSpend,
  total_spend: totalSpend,
  pct_at_risk: totalSpend > 0 ? (failedSpend / totalSpend) * 100 : 0,
  n_failed: failedPos.length,
  n_total: purchases.length,
  n_failing_suppliers: new Set(failedPos.map((p) => p.supplierExternalId)).size,
  n_total_suppliers: new Set(purchases.map((p) => p.supplierExternalId)).size,
};
```
Also computes `bySupplier` (per-supplier median/IQR/slowest-stage + ABC/Kraljic/composite via `getRangeAnalyses`, `cycle-breakdown.ts:114-153`), `byCategory` stage means (`:171-190`), and `stageAnomalies` (POs where one stage > 60% of cycle, `:205-225`). [Detection detail of `stageAnomalies`/`bySupplier` join → this is the roster the flag derivation consumes; see `_06`.]

**2. `/api/cycle-time/stage-occupancy` — the pipeline chart series.** Full logic in `stage-occupancy/route.ts`. Auth `getSession()` → 401 (`:35-38`); same date validation (`:42-48`). Prisma query (`:71-85`):
```
const purchases = await prisma.purchase.findMany({
  where: { paymentDate: { gte: new Date(`${start}T00:00:00`), lte: new Date(`${end}T23:59:59`) } },
  select: { prDate: true, poDate: true, deliveryDate: true, invoiceDate: true, paymentDate: true },
});
```
Builds window months from start-month..end-month (`:56-67`), then for each PO and each of the 4 stage-gaps, adds a whole `+1` to every month the gap `[start,end)` touches (`:109-115`), plus a terminal `payment` `+1` in the payment month (`:116-118`). Returns `{ months: StageOccupancyRow[] } satisfies StageOccupancy` (`:122`).

**3. `/api/cycle-time/supplier-detail` — the per-supplier drill-down.** Full logic in `supplier-detail/route.ts`. Auth (`:47-50`), requires `supplierId` (`:56-58`) + validated dates (`:59-70`). TWO parallel queries (`:79-102`):
```
const [allPurchases, supplier] = await Promise.all([
  prisma.purchase.findMany({
    where: { paymentDate: dateFilter },
    select: { poId, supplierExternalId, prDate, poDate, deliveryDate, invoiceDate,
      paymentDate, prToPoDays, poToDeliveryDays, deliveryToInvoiceDays,
      invoiceToPaymentDays, totalCycleDays },  // (abbreviated; :82-95)
  }),
  prisma.supplier.findFirst({
    where: { externalId: supplierId },
    orderBy: { periodId: "desc" },
    select: { supplierName: true, category: true, country: true },
  }),
]);
```
Classification context via `getRangeAnalyses(start, end)` (`:110`): `abcClass` from `analyses.abc.classifications` (`:111-113`), `perf` from `analyses.performance_spend.suppliers` (`:114-116`). Portfolio cycle mean + sample std (ddof=1) for the anomaly z-score (`:119-125`). Returns a `CycleSupplierDetail` (`:175-197`).

### compute vs compute-range (Mode A vs Mode B)

- **`/api/analyses/compute` (`compute/route.ts`)** — ADMIN-only (`:9-11` `session.role !== "ADMIN"` → 403). Takes `{ periodId }` (`:21-28`), verifies the period exists (`:30-33`), then `runComputeAnalyses(periodId)` (`:35`) — this is **Mode A**: recompute + persist the six per-period `AnalysisResult` rows for ONE period. Returns `{ success: true, analyses_computed: true }` (`:44`).
- **`/api/analyses/compute-range` (`compute-range/route.ts`)** — any authenticated user (`:16-20` `getSession()` → 401). Takes `{ startDate, endDate }` validated by zod `dateField` (`:8-13`), then `getRangeAnalyses(startDate, endDate)` (`:36`) — **Mode B**: "Returns cached results immediately, or computes + caches on a miss" (`:35`). Returns the full `RangeAnalyses` payload or 500 on failure (`:37-43`).

Process Health uses **compute-range** (range mode, via `CycleTimeClient.tsx:81`). The `breakdown`, `stage-occupancy`, `supplier-detail` routes query `Purchase` LIVE per request (not cached).

## §1c — COMPUTATION (every computed value)

`CycleTimeClient` orchestrates. It fetches the breakdown roster always (`CycleTimeClient.tsx:63-74`) and derives flags via the shared helper (`:118-122`):
```
const { flagsBySupplier, flagCounts, flagPoCounts, iqrCutoff } = deriveCycleFlags({
  roster, anomalies: cycleTime.anomalies, stageAnomalies,
});
```

Numbered list of every computed value rendered on Process Health:

1. **Glance median + PO count** — `CycleTimeGlancePanel.tsx:70-72`: `median = dist.median`, `n = dist.n`; rendered "runs a median of `{d2(median)} days` across `{num0.format(n)}` POs `{phrase}`" (`:188-189`).
2. **Glance YoY trend** — `CycleTimeGlancePanel.tsx:94-100`: `deltaPct = ((median - previousMedian) / previousMedian) * 100`; only when `!isRangeMode && previousMedian>0` and `|deltaPct| >= 0.5` (`:95,97`). Rendered "That's `{dir}` `{pct}%` from `{prev}` days" (`:190-196`).
3. **Glance typical-range clause** — "Half of all POs clear within `{p25}–{p75} days` (typical range `{iqr}` days)" (`:197-206`).
4. **Glance within-period stability** — `CycleTimeGlancePanel.tsx:102-107`: reads `cycleTime.period_comparison`; `stability.significant = p_value < 0.05`; rendered "Cycle time `{shifted|held steady}` … Mann-Whitney p = `{formatP(p)}`" (`:207-213`). `formatP` = exponential below 0.001 else 3dp (`:22`).
5. **Glance slowest stage + mean %** — `CycleTimeGlancePanel.tsx:75-81`: `stageMeans` from `cycleTime.stage_breakdown[key].mean`; `stageTotal = Σ means`; `slowest = argmax(mean)`; **`slowestPct = Math.round((slowest.mean / stageTotal) * 100)`** — the mean-based % formula (`:81`). Rendered "`{slowest.label}` is the binding constraint at `{slowestPct}%` of the cycle" (`:220-221`).
6. **Glance PR→PO direction** — `CycleTimeGlancePanel.tsx:87-91`: `prToPoPct = (prToPoMean/stageTotal)*100`; `avgStageShare = 100/stageMeans.length`; `prToPoIsSmall = prToPoPct < avgStageShare`; branches the "downstream, not internal" vs "internal" wording (`:224-235`).
7. **Glance slowest Kraljic quadrant** — `CycleTimeGlancePanel.tsx:110-114`: over `cycle_by_quadrant[q].median`, empty quadrants excluded, `argmax` (`:114`); rendered `:237-243`.
8. **Glance slowest category** — `CycleTimeGlancePanel.tsx:117-119`: `argmax(category.total_mean)`; rendered `:244-250`.
9. **Glance outlier bullet** — `CycleTimeGlancePanel.tsx:122-124`: `outliers = cycleTime.anomalies.length`; `maxOutlier = max(a.cycle_days)`; rendered `:141-154`.
10. **Glance inconsistent bullet** — `CycleTimeGlancePanel.tsx:127-129`: `iqrMedian = medianOf(roster.map(r=>r.iqr))`; `iqrCutoff = iqrMedian * 1.5`; `highIqr = roster.filter(r=>r.iqr>iqrCutoff).length` (**re-derives the inconsistent count independently of `deriveCycleFlags` — same 1.5× rule**); rendered `:155-162`.
11. **Glance worst 3-way-match quadrant** — `CycleTimeGlancePanel.tsx:132-133`: `worstQ = QUAD_ORDER.find(q => three_way_match_by_quadrant[q].is_worst)`; `worstRate = pass_rate_pct`; rendered `:163-170`.
12. **Glance Invoice→Payment-dominated exception** — `CycleTimeGlancePanel.tsx:137-138`: `invDom = roster.filter(r => r.slowest_stage === "invoice_to_payment")`; only when exactly one (`invDom.length === 1`); rendered `:171-178`.
13. **Stat grid: Median cycle time** — `CycleStatGrid.tsx:51-66`: `d2(d.median)` (2dp). Optional embedded sparkline over `monthly_trend.median_cycle_days` (`:60`) — but Process Health passes no `embedded`, so plain.
14. **Stat grid: Typical range** — `CycleStatGrid.tsx:67-72`: `{d0(p25)}–{d0(p75)} d`, sublabel `spread {d0(iqr)} d`.
15. **Stat grid: Average cycle time** — `CycleStatGrid.tsx:73`: `d1(d.mean)` (1dp).
16. **Stat grid: Range** — `CycleStatGrid.tsx:74`: `{d0(min)}–{d0(max)} d`.
17. **Stat grid: Slowest stage (5th, dashboard-only)** — `CycleStatGrid.tsx:38-45,75-82`: `stageMeans` from `stage_breakdown[key].mean`; `slowest = argmax`; **`slowestPct = Math.round((slowest.mean / stageTotal) * 100)`** (`:44`); `showSlowest = includeSlowest && slowest.mean > 0` (`:45`). `CycleTimeClient.tsx:167` passes `includeSlowest`. Grid cols switch: `showSlowest ? "sm:grid-cols-3 lg:grid-cols-5" : "lg:grid-cols-4"` (`:47`).
18. **THE 3 ANOMALY FLAG COUNTS 14/2/35** — computed by `deriveCycleFlags(...)` called at `CycleTimeClient.tsx:118` (the exact call site; detection + reconciliation → `_06 §4`). The distinct-supplier counts `flagCounts` render in `CycleTimeAnomalyCards`:
    - Non-zero cards: `CycleTimeAnomalyCards.tsx:84` — `<span className="ml-auto text-lg font-semibold tabular-nums">{count}</span>` where `count={counts[meta.key]}` (`:124`). Cards are ordered `has_outlier` (14) / `inconsistent` (2) / `has_stage_dom` (35) per `CARDS` (`:18-22`).
    - Zero card: `CycleTimeAnomalyCards.tsx:64` — `<span ...>0</span>`.
    - The **PO-level** counts sit in each card's description (`CycleTimeAnomalyCards.tsx:27-37`): outlier `"{p} outlier PO(s) · z > 2σ"`, inconsistent `"Typical range > 1.5× the portfolio median"`, stage-dom `"{p} stage-dominated PO(s) · one stage > 60%"`.
    - The SAME counts re-surface as roster filter-chip labels in `CycleSupplierSection.tsx:126-134`: `{c.label} ({counts[c.key]})`.
19. **Box plot P25/P75/median/whiskers/outlier dots** — `CycleTimeBoxPlot.tsx`: box = `x(d.p25)..x(d.p75)` (`:122-131`), median line `x(d.median)` (`:133`), whiskers `x(d.min)..x(d.p25)` and `x(d.p75)..x(d.max)` (`:117-118`). Outlier dots from `anomalies.filter(a => a.cycle_days != null)` (`:46-48`), jittered `dotCy = cy + (i%2===0 ? -1 : 1)*(boxH/2+8)` (`:141`). Axis clamped ≥0: `xmin = Math.max(0, lo - pad)` (`:57`).
20. **Distribution insight (dashboard-only)** — `CycleTimeView.tsx:471-507` `DistributionInsight`: `skew` fires when `mean - median >= 0.5` (`:474`); `slow` fires when every outlier `cycle_days > median` (`:478-481`). Gated by `showDistributionInsight` (`:582`); `CycleTimeClient.tsx:191` passes it `true`.
21. **Stage decomposition table (4 stage means + descriptives)** — `StageDecompositionTable.tsx:63-102`: rows = the 4 `STAGES` (`:15-20`), columns N/Average/Median/P25/P75 from `data.stage_breakdown[key]` (`:64-69`), all `d2` = 2dp (`:22,93-96`). Rendered inside `StageBreakdownSection` on the dashboard (`StageBreakdownSection.tsx:254`).
22. **Stage insight prose (4-paragraph, shape-detected)** — `StageBreakdownSection.tsx:56-171` `StageInsight`: `means` from `stage_breakdown[key].mean` (`:63-67`); `pctOf(m)=Math.round((m/total)*100)` (`:76`). Shape thresholds quoted: `DOM_PCT = 40`, `SECOND_PCT = 25`, `EVEN_MAX = 35` (`:86-88`); `twoLarge = domPct>=25 && secondPct>=25` (`:89`); `evenSpread = !twoLarge && domPct<35` (`:90`); `isDominant = !twoLarge && !evenSpread && (domPct>=40 || dom.mean>=1.5*second.mean)` (`:94-95`); `external = domKey === "po_to_delivery"` (`:102`); `roughlyEven = domPct>=40 && domPct<=60` (`:103`).
23. **Stage-by-category stacked bars** — `StageByCategoryChart.tsx:22-64`: mean days per stage per category from `CycleCategoryRow` fields; 4 `<Bar>` stacked on `stackId="stage"` (`:51-60`).
24. **Stage occupancy 5-series chart** — `StageOccupancyChart.tsx:18-24` `SERIES`: `pr_active`, `po_active`, `delivery_active`, `invoice_active`, **`payment`** (the 5th, terminal). Y label "POs active" (`:60-68`). Data from `/api/cycle-time/stage-occupancy` (see §1b).
25. **Monthly cycle trend (reports-only on this page path)** — `MonthlyCycleTrendChart.tsx`: `avg_cycle_days` line + dashed 3-mo rolling from `rolling_avg_trend` joined by month (`:57-63`). Process Health passes `showMonthlyTrend={false}` (`CycleTimeClient.tsx:189`) so it is HIDDEN on the dashboard; kept for reports.
26. **Control Exposure card ($ + %)** — `CycleTimeView.tsx:344-394` when `controlExposure` present (`CycleTimeClient.tsx:192` passes `breakdown?.controlExposure`). Three StatBlocks: "Spend through failed matches" `formatCompactCurrency(control.failed_spend)` (`:355-360`), "Share of total spend" `{pct_at_risk.toFixed(1)}%` of `formatCompactCurrency(total_spend)` (`:361-366`), "Failed POs" `{n_failed}` across `{n_failing_suppliers}` suppliers (`:367-372`). Insight prose `ControlInsight` (`:150-172`): `oneIn = round(n_total/n_failed)`, `byCount = (n_failed/n_total)*100` (`:158-159`).
27. **3-way-match pass rates by quadrant** — `CycleTimeView.tsx:236-278` `ThreeWayMatchTable` quadTable: `pass_rate_pct` per `QUAD_ORDER` quadrant (`:243-247`), worst reddened (`m.is_worst` → `font-semibold text-destructive`, `:270`).
28. **Cycle-by-quadrant medians (dashboard, inside control card)** — `CycleTimeView.tsx:280-327` `cycleTable`: `cycle_by_quadrant[q].median`, slowest reddened (`:319`). `CycleInsight` prose (`:188-234`): derives slow/fast quadrants, gap = `maxMed - minMed`, risk-axis clause only when all 4 present and both high-risk quadrants strictly slower (`:216-220`).
29. **Roster columns** — `CycleSupplierSection.tsx:228-238` `BySupplier` header: **`#` · Supplier · Median (d) · POs · Slowest stage · ABC · Exposure · Performance · Anomalies**. Values `CycleSupplierSection.tsx:252-270`: `#`=index+1 (`:252`), `median_cycle.toFixed(1)` (`:254`), `po_count` (`:255`), `StageChip` slowest (`:256-258`), ABC `Chip` (`:259-261`), Kraljic `Chip` (`:262-264`), `PerfBar score={r.composite}` (`:265-267`), `FlagPills` from `flagsBySupplier.get(r.supplier_id)` (`:268-270`).
30. **Drill-down cycle stats (median delta / spread / speed-rank)** — `CycleTimeSupplierDetailPanel.tsx:453-560` `CycleStatsBlock`: `medDelta = cyc.median_cycle - portfolio.median` (`:465`); `wider = inconsistent` (the flag itself, `:476`); percentile rank `slownessPct = round(slower/total*100)` (`:487`), gauge color `slownessPct>=60 ? warning : <=40 ? success : primary` (`:491-492`).
31. **Drill-down per-stage bars (supplier vs portfolio)** — `CycleTimeSupplierDetailPanel.tsx:61-80` `StageBars`: `supplier_mean` vs `portfolio_mean` from `data.stages` (the supplier-detail route's `stages`, mean-based per `supplier-detail/route.ts:129-137`).
32. **Drill-down cycle-consistency chart** — `CycleTimeSupplierDetailPanel.tsx:199-399` `CycleConsistencyChart`: x = order-by-payment-date; band = `median ± bandHalfWidth`, `bandHalfWidth = portfolio?.iqrCutoff ?? 1.5 * cyc.iqr` (`:871`); needs ≥3 POs (`:213-218`); red/base line split at injected band-crossings (`:260-289`).
33. **Drill-down PO table (5 milestone dates + anomaly)** — `CycleTimeSupplierDetailPanel.tsx:594-662` `PoList`: PO ID/PR/PO/Delivery/Invoice/Payment/Cycle days/Anomalies; flagged rows (`p.is_anomaly || stageDominatedPoIds.has(p.po_id)`) get amber tint `color-mix(in srgb, var(--warning) 9%, transparent)` (`:636`).

**Thresholds quoted from Process-Health files:**
- Outlier / z-score: `is_anomaly: z > 2` in `supplier-detail/route.ts:170`; box-plot dots "> 2σ above mean" (`CycleTimeBoxPlot.tsx:9-11`); stage-dom `maxStage / total > 0.6` in `cycle-breakdown.ts:215`.
- Inconsistent: `iqrCutoff = iqrMedian * 1.5` (`CycleTimeGlancePanel.tsx:128`); tooltip "interquartile spread exceeds the variability threshold" (`cycle-time-types.ts:28-29`).
- Stage-dom PO desc "one stage > 60%" (`CycleTimeAnomalyCards.tsx:36`); FLAG_TOOLTIP `has_stage_dom` "over 60% of the total cycle time" (`cycle-time-types.ts:30-31`).
- Distribution skew threshold `mean - median >= 0.5` (`CycleTimeView.tsx:474`).

## §1d — VISUAL STRUCTURE

`CycleTimeClient.tsx:154-227` top-level: `<div className="flex flex-col gap-6">` containing, in order:
1. `CycleTimeGlancePanel` (`:156-164`) — `Card` with `<CardTitle>Cycle at a glance</CardTitle>`, body `CardContent className="space-y-4 text-sm leading-relaxed"` (`CycleTimeGlancePanel.tsx:186`).
2. `CycleStatGrid ... includeSlowest` (`:167`) — grid `grid grid-cols-2 gap-4 {cols}` (`CycleStatGrid.tsx:50`).
3. Anomaly cards (gated on breakdown, `:170-183`) — `CycleTimeAnomalyCards`, inner grid `grid grid-cols-1 gap-2 sm:grid-cols-3` (`CycleTimeAnomalyCards.tsx:120`).
4. `CycleTimeView` with the dashboard gates (`:185-194`) — see SHARED-GATES block.
5. `StageBreakdownSection` (`:198-203`) — `Card` "Stage breakdown"; `CardContent className="space-y-6"` (`StageBreakdownSection.tsx:231`), Row 1 pipeline chart, Row 2 `grid grid-cols-1 gap-6 lg:grid-cols-2` (`:251`): left = decomposition table + `StageInsight`, right = `StageByCategoryChart`.
6. `CycleSupplierSection` (gated on breakdown, `:206-220`) — roster `Card id="cycle-roster"` (`CycleSupplierSection.tsx:207`) + `CycleTimeSupplierDetailPanel`.

**Drill-down dialog** — `CycleTimeSupplierDetailPanel.tsx:725-776`: base-ui `Dialog open={!!supplierId}` → `DialogContent showCloseButton={false} className="flex max-h-[85vh] w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[680px] {panelElevation}"` (`:726-729`); header + `ProcessDetailBody`. Body sections (`:806-884`): "Cycle stats", "Per-stage average — this supplier vs portfolio", "Purchase orders ({po_count})" with `ViewToggle` Table⇄Chart (`:858`).

## §1e — INTERACTIONS

- **Single active flag (cards ⇄ chips)** — `CycleTimeClient.tsx:44` `activeFlag` state; `setFlag` (`:140-150`) toggles + on card-select smooth-scrolls to `#cycle-roster` (`:144-148`). Cards call `handleCardSelect` (scroll), chips call `handleChipSelect` (no scroll) (`:151-152`). Card active state: `CycleTimeAnomalyCards.tsx:78` `ring-2 ring-inset ring-foreground/40`.
- **Roster filter** — `CycleSupplierSection.tsx:195-197`: `activeFlag ? rows.filter(r => flagsBySupplier.get(r.supplier_id)?.[activeFlag]) : rows`. Filtered-count note "Showing {filteredRows.length} of {rows.length}" (`:220-222`).
- **Sort** — `useTableSort<CycleSupplierRow>(filteredRows, ..., "median_cycle", "desc")` (`CycleSupplierSection.tsx:199-204`); `SortHead` per column.
- **Row → drill-down** — `CycleSupplierSection.tsx:245` `onClick={() => onSupplierClick(r.supplier_id)}`; selection lifted in `CycleTimeClient` (`:47` `selectedSupplierId`), so **box-plot outlier dots open the SAME panel**: `CycleTimeClient.tsx:193` passes `onOutlierClick={setSelectedSupplierId}` to `CycleTimeView`, which forwards to `CycleTimeBoxPlot` where `onClick={canOpen ? () => onOutlierClick(a.supplier_id) : ...}` (`CycleTimeBoxPlot.tsx:149-155`).
- **Span-change reset** — `CycleTimeClient.tsx:50-55` render-time compare (no set-state-in-effect): `if (prevKey !== key) { setPrevKey(key); if (activeFlag) setActiveFlag(null); if (selectedSupplierId) setSelectedSupplierId(null); }`.
- **Drill-down PO Table⇄Chart** — `CycleTimeSupplierDetailPanel.tsx:797` `poView` state, reset to `"table"` on supplier change (`:798-801`).

---

# §2 — ACTION PRIORITIES

Route `/action-dashboard` (URL unchanged). Page: `app/(dashboard)/action-dashboard/page.tsx`; main view `components/ActionDashboardView.tsx`.

## §2a — PURPOSE

Cross-analysis priorities hub — "where to focus across spend, supplier, and process
analyses — flagged, not prescribed" (`ActionDashboardView.tsx:1356-1358`). Page
`<h1>` = `Action Priorities{label ? " — {label}" : ""}` (`page.tsx:88-90`).

## §2b — DATA SOURCES

`page.tsx:22-23` resolves selection/source; three branches (`:28,30,66`):
- **`"empty"`** → `<EmptyState />` (`:29`).
- **`"cached"` (single-year)** — one `Promise.all` of SEVEN loads (`:37-48`):
  ```
  const [data, cycle, perf, kraljic, span, temporal, supplierCategory] = await Promise.all([
    getAnalysisResult<RecommendationsResult>(source.periodId, "recommendations"),
    getAnalysisResult<CycleTimeResult>(source.periodId, "cycle_time"),
    getAnalysisResult<PerformanceSpendResult>(source.periodId, "performance_spend"),
    getAnalysisResult<KraljicResult>(source.periodId, "kraljic"),
    getDateRangeFromSelection(selection),
    loadTemporalMatrix({ selectedPeriodId: source.periodId }),
    getSupplierCategoryMap(),
  ]);
  ```
  `getSupplierCategoryMap()` is the ONLY extra Prisma read beyond the analyses (comment `:44-47` "55-row Prisma read, period-independent … powers the Concentration panel"). Passes all to `ActionDashboardView` with `isRangeMode={false}` (`:52-62`).
- **`"range"` (else)** — loads only `[temporal, supplierCategory]` server-side (`:69-72`) then renders `RangeCompute kind="recommendations"` keyed `${startDate}_${endDate}` (`:73-82`). `RangeCompute` (`components/analysis/RangeCompute.tsx:50-78`) POSTs `/api/analyses/compute-range` (Mode B), and on `kind === "recommendations"` renders `ActionDashboardView` with `data=recommendations`, `cycleTime=cycle_time`, `perf=performance_spend`, `kraljic`, `isRangeMode` (`RangeCompute.tsx:106-121`).

**Client-side breakdown fetch** (both modes, from within the view) — `ActionDashboardView.tsx:1217-1230`:
```
fetch(`/api/cycle-time/breakdown?start=${startDate}&end=${endDate}`)
  ...
  .then((d) => { if (!cancelled) setBd({ key: k, data: d }); })
```
This one breakdown feeds the glance, the stat grid, and the unified table (comment `:1214-1215` "lifted here so the glance, stat grid, and the one table all read ONE hub — same as Process Health").

Mode A vs Mode B: identical to §1b — Action Priorities' single-year `cycle_time`/`recommendations`/`perf`/`kraljic` are server-read from cached `AnalysisResult` (Mode A output); range mode computes via `getRangeAnalyses` (Mode B).

## §2c — COMPUTATION (every computed value)

`ActionDashboardView.tsx:1166-1168`: `narrative = summary_stats.narrative`, `byCat = summary_stats.by_category`.

### Glance narrative (`PrioritiesGlancePanel`, `:308-447`)

1. **Roster + spend lead** — `:384-386` `{narrative.n_suppliers} active suppliers` and `{usd(narrative.total_spend)} {phrase}`. `phrase` from `periodPhrase` (`:105-111`): "in {yyyy}" single / "from {sy} to {ey}" range.
2. **Concentration clause** — `concShare = Math.round(narrative.top_category_share_pct)` (`:319`); `heavy = share >= 50` (`:320`); rendered `:387-402`.
3. **"Where the exposure sits"** — `:408-431`: `top_category_name`, `a_items_count` A-tier suppliers, tail suppliers `tail.tail_supplier_count` at `{tail.tail_spend_share_pct.toFixed(0)}%`.
4. **"Worth noting" bullets (hub-derived, each self-omits)** — `:324-375`:
   - importantUnion bullet: `hub.importantUnionCount` of `hub.distinctFlagged` flagged sit on important relationships, carrying `usd(hub.process.importantSpend)` (`:327-341`).
   - widest lens: `hub.classification.rows[0]` `{disagreement}-point spread` (`:343-351`).
   - biggest temporal move: `hub.temporal.rows[0]` (`:352-366`).
   - compound: `hub.compoundCount` "trip more than one analysis" (`:367-374`).

### StatBlock grid (`PrioritiesStatGrid`, `:452-501`) — 4 cards

5. **Category concentration** — `{Math.round(narrative.top_category_share_pct)}%`, sublabel `top_category_name` (`:467-472`).
6. **Flagged suppliers** = `hub.distinctFlagged` (= **46**), sublabel `{hub.process.flaggedCount} process · {hub.classification.flaggedCount} lens · {t?.flaggedCount ?? 0} time` (= **36 process · 11 lens · 18 time**) (`:473-482`).
7. **On important relationships** = `hub.importantUnionCount` (= **17**), sublabel `usd(hub.process.importantSpend)` of anomaly spend (`:483-492`).
8. **Top-10 needing attention** = `narrative.top10_in_attention` (`:493-498`).

### "Where to act" (`WhereToAct`, `:659-734`) — 8 category rows in 3 group cards

9. Groups from `ACTION_GROUPS` (`:689`); each group count `= Σ byCat[c]` (`:690`); one group insight line (`spendInsight`/`suppliersInsight`/`processInsight`, `:114-130`, wired at `:1300-1304`).
10. Per-category row (`CategoryRow`, `:612-657`): dot color `CATEGORY_COLOR_VAR[cat]` (`:628`), label `CATEGORY_LABEL[cat]` (`:640`), `metric` from `categoryMeta` (`:549-610`), count `byCat[cat]`; **capped-population display** `population != null && population > count ? "{count} of {population}"` (`:629-630`).
11. **Capped population** — `ActionDashboardView.tsx:1177-1191`: counts `perf.suppliers` where `zone === "Critical Issues"`, `zone === "Hidden Gems"`, `kraljic_quadrant === "Bottleneck"` → the "5 of 12" denominator for the 3 top-5-capped categories.

`categoryMeta` metric formulas (`:549-610`):
- `concentration`: `"{Math.round(share)}% · {name}"`, href `/spend-overview` (`:555-564`).
- `tail_spend`: `"{tail_supplier_count} suppliers · {tail_spend_share_pct.toFixed(0)}% of spend"` (`:565-574`).
- `process_improvement`: `"{impact_score.toFixed(1)}% fail · {quad}"` (`:575-585`).
- `slow_stage`: `"{slowest_stage_name} · {slowest_stage_avg_days.toFixed(1)}d"` or `"{stage} · {avg_days.toFixed(1)}d"` (`:586-601`).
- `critical_spend`/`critical_issues_engagement`/`hidden_gems_promotion`/`bottleneck_risk`: supplier rows via `supplierRows` (`:513-547`).

### Cross-analysis anomalies (`CrossAnalysisAnomalies`, `:1011-1136`) — 3 family cards

12. **THE HUB COUNTS 46/36/11/18** — `buildAnomalyHub(...)` is called at `ActionDashboardView.tsx:1256` (the exact call site; detection + reconciliation → `_06 §4`):
    ```
    return buildAnomalyHub({
      flagsBySupplier, perfSuppliers: perf?.suppliers ?? [], roster,
      supplyRiskById, temporal: temporalAnomalies,
    });
    ```
    Flags fed in come from `deriveCycleFlags({ roster, anomalies, stageAnomalies }).flagsBySupplier` when the breakdown is present (`:1246`), else outlier-only (`:1247-1252`). Temporal fed via `buildTemporalAnomalies(temporal.matrix)` when `temporal.kind === "ok"` (`:1255`).
    Where each count SURFACES:
    - **Process = 36** → `FamilyCard ... count={process.flaggedCount}` (`:1104`), rendered `FamilyCard.tsx:770-772` `<span ...>{count}</span>`.
    - **Lens = 11** → `count={classification.flaggedCount}` (`:1113`).
    - **Temporal = 18** → `count={tempCount}` where `tempCount = tAnom?.flaggedCount ?? 0` (`:1058,1124`).
    - **Total = 46** → StatGrid "Flagged suppliers" (`:476`) + filter chip "All ({counts.all})" where `counts.all = hub.distinctFlagged` (`:843,1273`).
    - **Important = 17** → StatGrid (`:486`) + chip "Important only ({counts.important})" = `hub.importantUnionCount` (`:1277`).
    - **In-2+ = 19** → chip "In 2+ families ({counts.compound})" = `hub.compoundCount` (`:1278`).
13. Family-card descriptors (`:1058-1083`): process `"Outlier {flagMix.has_outlier} · Inconsistent {flagMix.inconsistent} · Stage-dom {flagMix.has_stage_dom}"` (`:1080`); lens `"Widest gap {rows[0].disagreement} · ≥{CLASSIFICATION_DISAGREEMENT_CUTOFF}-pt spread"` (`:1081-1083`); temporal `"{latestLabel} vs {priorLabel} · Spend {byDetector.spend} · Quadrant {byDetector.quadrant} · Score {byDetector.score}"` (`:1074`).
14. **Temporal note-states** (single-year) — `:1061-1078`: `partial-year` → `"{label} is a partial year — not compared"`, disabled (`:1061-1064`); `no-prior` → `"{label} is the earliest period — no prior year"`, disabled (`:1065-1068`); `insufficient`/absent → `"Needs at least two reporting periods"`, disabled (`:1069-1072`); zero-moves → `"No sharp moves (...)"`, disabled (`:1075-1078`).

### Unified anomaly table (`AnomalyTable`, `:890-1009`)

15. **Filter counts** — `ActionDashboardView.tsx:1272-1279`: `all=distinctFlagged`, `process=process.flaggedCount`, `classification=classification.flaggedCount`, `temporal=temporal?.flaggedCount ?? 0`, `important=importantUnionCount`, `compound=compoundCount`.
16. **Unified rows** — `buildUnifiedRows(hub, perfById, abcById)` (`:264-303,1271`): one row per `hub.familiesBySupplier` entry; `important = abc_class === "A" || kraljic_quadrant === "Strategic"` (`:296`); position sourced from canonical span analyses (perf + breakdown ABC).
17. **Filter chips** — `AnomalyFilterChips` (`:823-852`), `FILTER_LABEL` (`:815-821`): `All / Process / Lens disagreement / Changed over time / Important only / In 2+ families`. Table filter logic `:905-910`: `important` → `r.important`; `compound` → `r.families.size >= 2`; else `r.families.has(activeFilter)`.
18. **Anomaly cell chips** — `AnomalyCell` (`:182-240`): process flags via `FLAG_META`; `Lens gap {disagreement}`; temporal `{from} → {to}` / `Spend {±pct}%` / `Score {±delta}`.

### The 11 ActionInsightCard tab panels — `lib/action-insights.ts` `buildInsight(key, ctx)`

`InsightKey` = the 8 `RecommendationCategory` + `"process" | "classification" | "temporal"` (`action-insights.ts:33-37`). Dispatcher `:679-706`. Each returns `{title, lead, stats[3], table, why, footer?}` (`:55-62`). All 11 enumerated:

1. **`concentration`** (`:117-193`) — flagship supplier→category join. `byCat` groups `universe` by `ctx.supplierCategory`; top category `share = top.spend/total*100`; stats [Category spend, Share of total, Suppliers in it]; FULL-set table of in-category suppliers, `emphasis = quadrant === "Strategic" && perf < median` (`:168`); `why` branches on `strategicBelow`/`strategicAll` (`:174-183`) — "N of the M suppliers here are Strategic … score below the {median}-point median"; footer → `/spend-overview` (`:191`).
2. **`critical_spend`** (`:198-246`) — A-tier vital few from `recommendations.filter(type==="critical_spend")`; `combined` spend, `share`; `below` = recs below median; table [Supplier, Spend, Share, Performance]; `why` = "{below} of these {N} vital-few score below the {median}-point median" (`:240-243`).
3. **`critical_issues_engagement` → criticalIssues`** (`:251-285`) — `universe` filtered `zone === "Critical Issues"` (FULL zone set, not top-5); stats [Underperforming, Combined spend, Performance median]; `emphasis = quadrant === "Strategic"`; `why` on `strategic.length` (`:279-282`).
4. **`hidden_gems_promotion` → hiddenGems`** (`:290-324`) — `zone === "Hidden Gems"` sorted by perf; `lowRisk` = Leverage/Routine; `emphasis` = low-risk; `why` "safe to consolidate" vs "hard-to-source" (`:318-321`).
5. **`bottleneck_risk`** (`:329-364`) — `quadrant === "Bottleneck"` sorted by risk; `avgRisk`; `alsoFlagged` = also in `hub.process.rows` (`:335-336`); `emphasis = processFlagged.has(id)`; `why` on `alsoFlagged` (`:358-361`).
6. **`tail_spend`** (`:369-406`) — `universe` where `spend/total < 0.01` (the **1% tail threshold**, `:374`); `sharePct`, `rosterPct`; `bottleneck` subset; `why` "N of the tail are Bottleneck" (`:400-403`).
7. **`slow_stage` → slowStage`** (`:418-465`) — `STAGE_ROWS` marks PO→Delivery `internal: false` (`:413`); `slowestInternal = argmax(internal means)`; **`flagged = slowestInternal.mean > 8`** (the 8-day flag, `:425`); table of all 4 stages with PO→Delivery `muted` + note `"excluded — physical lead time"` (`:448-449`); `why` "time inside your own accounts-payable process … PO→Delivery … excluded" (`:462`).
8. **`process_improvement` → processImprovement`** (`:485-521`) — reads `three_way_match_by_quadrant` + `breakdown.controlExposure`; `worst` = `is_worst` quadrant or lowest pass rate; lead uses `ce.pct_at_risk`/`ce.failed_spend`; `why = worstFraming(worst.q)` (`:472-483,519`) — adaptive prose per worst quadrant.
9. **`process` → processFamily`** (`:534-573`) — `hub.process`; stats [Flagged suppliers, On important relationships, Anomaly spend]; table [Supplier, Anomalies (`flagsText`), ABC, Exposure, Spend]; `emphasis = r.important`; `why` on `important.length` (`:567-570`).
10. **`classification` → lensFamily`** (`:593-629`) — `hub.classification`; stats [Flagged suppliers, Widest gap `{disagreement} pts`, Across a roster of]; table [Supplier, Spend%, Perf%, Risk%, The contradiction]; `why` uses `axisHigh(top.max_axis)`/`axisLow(top.min_axis)` (`:578-591,626`) — "No single view reveals this."
11. **`temporal` → temporalFamily`** (`:641-674`) — `hub.temporal`; stats [Suppliers moved, Quadrant jumps, Comparable roster]; table [Supplier, Spend Δ, Exposure move, Perf. Δ]; `why` = sharpest move via `temporalMove(top)` (`:634-639,671`).

Helpers: `universe(ctx)` joins perf + kraljic supply-risk + supplierCategory (`:93-107`); `totalSpendOf` prefers `narrative.total_spend` (`:109-110`); `perfMedianOf = ctx.perf.axis_thresholds.performance_median` (`:112`).

### `lib/action-priorities.ts` — the 8 categories + 3 groups (FULLY ENUMERATED)

`CATEGORY_ORDER` (`:10-22`): `concentration`, `critical_spend`, `tail_spend` (Spend); `critical_issues_engagement`, `hidden_gems_promotion`, `bottleneck_risk` (Suppliers); `process_improvement`, `slow_stage` (Process).

| Category | `CATEGORY_LABEL` (`:24-33`) | `CATEGORY_COLOR_VAR` (`:36-45`) | `CATEGORY_WHY` (`:48-65`, verbatim gist) | `CATEGORY_NUDGE` (`:68-77`) |
|---|---|---|---|---|
| concentration | "Concentration" | `var(--priority-concentrate)` | "Where spend is most concentrated by category — resilience exposure, not performance." | "Suggested: diversification / second-source review." |
| critical_spend | "Critical Spend" | `var(--priority-steward)` | "The vital few — your largest supplier relationships (A-tier)…" | "Suggested: confirm contract + SLA coverage." |
| tail_spend | "Tail Spend" | `var(--priority-consolidate)` | "The long tail — many tiny suppliers…" | "Suggested: review for consolidation opportunities." |
| critical_issues_engagement | "Critical Issues Engagement" | `var(--priority-engage)` | "The widest gap between what you pay and what you get…" | "Suggested: performance review before renewal." |
| hidden_gems_promotion | "Hidden Gems Promotion" | `var(--priority-promote)` | "Strong performers you're barely using…" | "Suggested: evaluate for an expanded share of wallet." |
| bottleneck_risk | "Bottleneck Risk Mitigation" | `var(--priority-mitigate)` | "Low-spend but hard to replace — high supply risk…" | "Suggested: line up a qualified second source." |
| process_improvement | "Process Improvement" | `var(--priority-improve)` | "Internal process friction slowing the procure-to-pay cycle." | "Suggested: review the flagged stage's handoffs." |
| slow_stage | "Slowest Stage" | `var(--priority-slowstage)` | "The internal procure-to-pay stage(s) taking longest…" | "Suggested: review the stage's workflow." |

`ACTION_GROUPS` (`:94-123`) — 3 groups (type `ActionGroup`, `:85-92`):
- **spend** — title "From your Spend analysis", tagline "Where the money is exposed", `colorVar var(--priority-steward)`, categories `["concentration","critical_spend","tail_spend"]` (`:95-102`).
- **suppliers** — "From your Supplier analysis", "Who needs attention", `var(--priority-engage)`, `["critical_issues_engagement","hidden_gems_promotion","bottleneck_risk"]` (`:103-114`).
- **process** — "From your Process analysis", "Where the workflow leaks", `var(--priority-improve)`, `["process_improvement","slow_stage"]` (`:115-122`).

Each group also carries a `lead` prose string (`:99,107,119`).

**Thresholds quoted in Action files:** tail `s.spend / total < 0.01` (`action-insights.ts:374`); slow-stage flag `slowestInternal.mean > 8` (`action-insights.ts:425`); capped-population `zone === "Critical Issues"/"Hidden Gems"`, `kraljic_quadrant === "Bottleneck"` (`ActionDashboardView.tsx:1182-1184`); `CLASSIFICATION_DISAGREEMENT_CUTOFF` referenced in descriptors (`ActionDashboardView.tsx:1082-1083`, imported from `lib/anomaly-crossref` — constant owned by `_06`). Category concentration 0.30 and tail 0.01 as compute-layer emitter thresholds live in Python (`compute_analyses.py`) — NOT in these TS files; the TS reads the emitted `narrative`/`recommendations` values only.

## §2d — VISUAL STRUCTURE

`ActionDashboardView.tsx:1354-1442` root `<div className="flex flex-col gap-6">`:
1. Subtitle `<p className="max-w-3xl text-sm text-muted-foreground">` (`:1356-1358`).
2. `PrioritiesGlancePanel` + `PrioritiesStatGrid` (when `narrative`, `:1360-1364`) — glance `Card` body `CardContent className="space-y-4 text-sm leading-relaxed"` (`:382`); stat grid `grid grid-cols-2 gap-4 lg:grid-cols-4` (`:466`).
3. `WhereToAct` (`:1373-1380`) — `Card` "Where to act"; inner `grid grid-cols-1 gap-4 lg:grid-cols-3` (`:688`); each group `flex flex-col rounded-lg border bg-card/40 p-3` (`:694`).
4. `CrossAnalysisAnomalies` (`:1382-1390`) — `Card`; family grid `grid grid-cols-1 gap-2 sm:grid-cols-3` (`:1097`); active card `ring-2 ring-inset ring-foreground/40` (`:790`).
5. `AnomalyTable` (when `hub.distinctFlagged > 0`, `:1392-1401`) — `Card id="anomaly-roster"` (`:935`); columns `# / Supplier / Spend / ABC / Exposure / Performance / Anomalies` (`:958-964`).
6. `ActionInsightCard` — **conditionally mounted** (`:1415-1426`).
7. `UnifiedSupplierDetailModal` (when `canDrill`, `:1429-1441`).

**`ActionInsightCard`** — `ActionInsightCard.tsx:242-300`: base-ui `Dialog open={openKey != null}` (`:243`) → `DialogContent showCloseButton={false}` with `className="flex max-h-[85vh] w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[680px] {panelElevation}"` (`:244-251`). Header (`:254-269`) = group icon + `DialogTitle` (group title) + close `Button`. Tab bar (`:271-277`) = `PillTabs` over `tabs.map((t) => [t.key, tabLabel(t.label, tabCounts[t.key])])` with count badges (`:189-200`). Body = `InsightBody` (`:111-187`: lead `<p>` + up to 3 `StatBlock size="compact"` + full-set `<table>` + "Why this matters" callout `rounded-md border-l-2 border-l-primary bg-muted/40 p-3`, `:177-184`). Footer (`:285-294`) = optional footer link + "Esc to close".

**The 4 groups + count badges** — `INSIGHT_GROUPS` (`ActionInsightCard.tsx:29-77`): `spend` (Concentration/Critical Spend/Tail Spend), `suppliers` (Critical Issues/Hidden Gems/Bottleneck Risk), `process` (Process Improvement/Slowest Stage), `anomalies` (Process/Lens disagreement/Changed over time). For the `anomalies` group, tabs with a 0 count are dropped: `tabs = group.tabs.filter((t) => group.id !== "anomalies" || (tabCounts[t.key] ?? 0) > 0)` (`:236-237`). Per-tab counts fed from `insightTabCounts` (`ActionDashboardView.tsx:1326-1341`).

**Nested-modal behaviour (documented exactly as coded; FLAGGED pending design decision).** The insight card is CONDITIONALLY MOUNTED — `ActionDashboardView.tsx:1415`:
```
{openPanel != null && (
  <ActionInsightCard ... onSupplier={onCardSupplier} />
)}
```
The comment above it (`:1411-1414`) states the intent verbatim: *"CONDITIONALLY MOUNTED: setting openPanel = null removes the card + its overlay from the tree atomically, so a row-click's close-then-open of the supplier modal can never leave a second scrim stacked (no modal-over-modal)."* A row click inside the card runs `onCardSupplier` (`:1346-1352`):
```
const onCardSupplier = canDrill
  ? (id: string) => {
      const tab: DetailTab = openPanel === "process" ? "process" : "classification";
      setOpenPanel(null);        // unmounts the insight card first
      openSupplier(id, tab);     // then opens the supplier modal
    }
  : undefined;
```
So the card is unmounted (`setOpenPanel(null)`) BEFORE the supplier modal opens — the two dialogs never coexist. This is documented as a deliberate design choice in the code comments; per instructions it is flagged as a pending design decision without further editorializing.

## §2e — INTERACTIONS

- **Local state** — `ActionDashboardView.tsx:1195-1199`: `selectedSupplierId`, `detailTab` (`"classification"|"spend"|"process"`), `activeFilter` (`FamilyFilter|null`), `openPanel` (`InsightKey|null`, "one at a time across all 11 cards", `:1198-1199`).
- **Span-change reset** — `:1201-1208` render-time compare: on span change resets `selectedSupplierId`, `activeFilter`, `openPanel`.
- **Family-card click → filter + scroll** — `selectFamily` (`:1292-1298`): toggles `activeFilter`, then `requestAnimationFrame` scroll to `#anomaly-roster` offset `-80`. Card action buttons (`FamilyCard.tsx:795-809`): "Filter roster →"/"Filtering roster ↓" (`onSelect`) + "View more →" (`onViewMore` → `onOpenPanel`).
- **Filter chips** — `AnomalyTable` `AnomalyFilterChips` (`:945`) + `setActiveFilter` (`:1397`); filtered-count note "Showing {filtered.length} of {rows.length}" (`:947-949`).
- **Sort** — `useTableSort<UnifiedAnomalyRow>(filtered, keyFn, "total_spend_usd", "desc")` (`:912-932`); sortable columns Supplier/Spend/ABC/Exposure/Performance (`:959-963`).
- **Row → UnifiedSupplierDetailModal, tab routing** — `onAnomalySupplier` (`:1285-1290`):
  ```
  const row = unifiedRows.find((r) => r.supplier_id === id);
  openSupplier(id, row && row.families.has("process") ? "process" : "classification");
  ```
  → **process-family members open the Process tab; everything else opens Classification** (comment `:1283-1284`). `openSupplier` sets `detailTab` then `selectedSupplierId` (`:1209-1212`). Modal peer-click resets to Classification: `onSupplierClick={(id) => openSupplier(id, "classification")}` (`:1439`).
- **Insight-card tab switch** — `ActionInsightCard` `onTab={openInsight}` (`:1421`), `openInsight = (key) => setOpenPanel(key)` (`:1342`); switching tabs does not close (comment `ActionInsightCard.tsx:210-211`).
- **Insight-card row click** — closes card then opens supplier modal via `onCardSupplier` (see §2d nested-modal).

---

# CycleTimeView — SHARED show* GATES

`components/CycleTimeView.tsx:509-543` — SHARED by the dashboard (`CycleTimeClient`), reports, and range-compute. Props + defaults (`:511-542`):

| Gate prop | Default | Dashboard passes (`CycleTimeClient.tsx:185-194`) | Effect when true |
|---|---|---|---|
| `embedded` | `false` | — (default) | Adds sparkline to median stat (`CycleStatGrid.tsx:55-61`) |
| `showAnomaliesTable` | `true` | `false` (`:187`) | Renders `AnomaliesTable` Outlier POs (`:613`) |
| `showMonthlyTrend` | `true` | `false` (`:188`) | Renders `MonthlyCycleTrendChart` card (`:550-566`) |
| `showStatGrid` | `true` | `false` (`:189`) | Renders `CycleStatGrid` (`:548`) — dashboard renders it itself above the flags |
| `showStageDecomposition` | `true` | `false` (`:190`) | Renders Stage Decomposition card (`:586-598`) — dashboard moves it into `StageBreakdownSection` |
| `showDistributionInsight` | `false` | `true` (`:191`) | Renders `DistributionInsight` under box plot (`:582`) |
| `controlExposure` | `undefined` | `breakdown?.controlExposure` (`:192`) | Swaps bare pass-rate table → spend-at-risk control card (`:600-611`) |
| `onOutlierClick` | `undefined` | `setSelectedSupplierId` (`:193`) | Box-plot dots open supplier panel (`CycleTimeBoxPlot.tsx:149-155`) |

**Reports pass NONE of the dashboard gates** → original layout: `RangeCompute.tsx:123-124` renders `<CycleTimeView data={state.data.cycle_time} />` with all defaults (stat grid + monthly trend + stage decomposition + anomalies table + bare pass-rate table, no distribution insight, no control card, no outlier click). Confirmed by the default branches: `!control` → bare `quadTable` + standalone `CycleByQuadrantTable` (`:329-342,604-611`).

Exports of `CycleTimeView.tsx`: the single `CycleTimeView` component (`:509`); all sub-components (`SortHead`, `CycleByQuadrantTable`, `ControlInsight`, `CycleInsight`, `ThreeWayMatchTable`, `AnomaliesTable`, `DistributionInsight`) are module-private.

---

# TYPES — `lib/cycle-time-types.ts` (exports enumerated)

- `CYCLE_STAGES` (`:7-12`) — const array of the 4 P2P stages `{key,label}`; `pr_to_po`/`po_to_delivery`/`delivery_to_invoice`/`invoice_to_payment`.
- `CycleStageKey` (`:14`) — `typeof CYCLE_STAGES[number]["key"]`.
- `CycleFlagKey` (`:19`) — `"has_outlier" | "inconsistent" | "has_stage_dom"`.
- `SupplierFlagState` (`:20`) — `Record<CycleFlagKey, boolean>`.
- **`FLAG_TOOLTIP`** (`:25-32`) — `Record<CycleFlagKey, string>`, the plain-language hover text shared by roster pills / anomaly cards / detail badge. `has_outlier`: "…at least one PO whose total cycle time ran more than 2σ above the period mean." `inconsistent`: "…interquartile spread exceeds the variability threshold set across all suppliers…not tied to any single PO…" `has_stage_dom`: "…at least one PO where a single stage took over 60% of the total cycle time."
- `AbcClass` (`:34`) — `"A" | "B" | "C"`.
- `CycleSupplierRow` (`:36-53`) — roster row (median/p25/p75/iqr/slowest_stage/abc/kraljic/composite).
- `CycleStageComparison` (`:59-64`) — supplier_mean vs portfolio_mean per stage.
- `CyclePoRow` (`:68-81`) — one PO with 5 milestone dates + `is_anomaly`.
- `CycleSupplierDetail` (`:83-106`) — the supplier-detail route payload (`supplier`/`cycle`/`stages`/`pos`).
- `CyclePortfolioContext` (`:112-120`) — population median/p25/p75 + `supplierMedians[]` + `iqrCutoff`.
- `CycleCategoryRow` (`:122-131`) — per-category stage means + `total_mean`.
- `CycleBreakdown` (`:133-143`) — `{bySupplier, byCategory, stageAnomalies?, controlExposure?}`.
- `ControlExposure` (`:146-154`) — `{failed_spend, total_spend, pct_at_risk, n_failed, n_total, n_failing_suppliers, n_total_suppliers}`.
- `StageOccupancyRow` (`:162-169`) — `{month, pr_active, po_active, delivery_active, invoice_active, payment}`.
- `StageOccupancy` (`:171`) — `{ months: StageOccupancyRow[] }`.

**`FLAG_META`** is NOT in this types file — it is redefined per-component (identical shape) at `CycleSupplierSection.tsx:36-40`, `ActionDashboardView.tsx:150-154`, and as inline `CARDS` color in `CycleTimeAnomalyCards.tsx:18-22`. All three map `has_outlier → var(--warning)`, `inconsistent → var(--primary)`, `has_stage_dom → var(--destructive)`. [DIVERGENCE FLAG: three duplicate copies of the flag→color/label mapping rather than one shared export — they agree today but are not DRY.]

---

# DIVERGENCES & NOTES

1. **Inconsistent count computed twice, independently.** `deriveCycleFlags` (owned by `_06`) produces the authoritative `flagCounts` at `CycleTimeClient.tsx:118`, but `CycleTimeGlancePanel.tsx:127-129` re-derives `highIqr = roster.filter(r => r.iqr > iqrMedian*1.5).length` from scratch for its "Worth noting" bullet. Same rule (`1.5 × median IQR`), separate code path. [DIVERGENCE FLAG — duplicate logic; a roster/threshold change must update both.]
2. **`FLAG_META` triplicated** — see TYPES block above.
3. **Category concentration 0.30 / tail 0.01 compute thresholds are Python-side.** These TS files never read `0.30`; the concentration category count arrives pre-computed in `narrative`/`recommendations`. The only `0.01` in TS is the insight-panel's own tail recompute (`action-insights.ts:374`) — an independent client-side re-derivation, NOT the emitter constant. [INFERRED the emitter home is `python/compute_analyses.py` from CLAUDE.md; not read here — confirming file is outside this section's 25.]
4. **Breakdown route Prisma select is in the delegate, not the route.** `breakdown/route.ts` has NO Prisma query; the select + controlExposure aggregate live in `lib/cycle-breakdown.ts:59-80,229-240` (a supporting file, orchestrator-adjacent). Documented here because the task required the select quote for the breakdown fetch.
5. **`CycleSupplierSection` dual-mode** — it accepts an optional `data` prop; when the parent (`CycleTimeClient`) supplies breakdown data it is presentational and skips its own fetch (`CycleSupplierSection.tsx:320,322-323`), else it self-fetches `/api/cycle-time/breakdown` (`:326`). On Process Health the parent always supplies it.
6. **`_06 §4` owns detection + reconciliation** for the 14/2/35 and 46/36/11/18 counts. This section cites only the CONSUMING call sites (`deriveCycleFlags` @ `CycleTimeClient.tsx:118`; `buildAnomalyHub` @ `ActionDashboardView.tsx:1256`) and the render sites.

---

## A3 EXPORTS COMPLETENESS INDEX (auto-generated — every `export` in this doc's files, cited)

Guarantees one-to-one A3 coverage: each symbol below is defined at the cited line in a file this doc documents.

| Symbol | Kind | file:line |
|---|---|---|
| `ActionDashboardView` | fn | `ActionDashboardView.tsx:1143` |
| `INSIGHT_GROUPS` | const | `ActionInsightCard.tsx:29` |
| `groupOfInsightKey` | fn | `ActionInsightCard.tsx:96` |
| `firstTabOfGroup` | fn | `ActionInsightCard.tsx:101` |
| `ActionInsightCard` | fn | `ActionInsightCard.tsx:213` |
| `CycleStatGrid` | fn | `CycleStatGrid.tsx:24` |
| `CycleSupplierSection` | fn | `CycleSupplierSection.tsx:285` |
| `CycleTimeAnomalyCards` | fn | `CycleTimeAnomalyCards.tsx:100` |
| `CycleTimeBoxPlot` | fn | `CycleTimeBoxPlot.tsx:13` |
| `CycleTimeClient` | fn | `CycleTimeClient.tsx:24` |
| `CycleTimeGlancePanel` | fn | `CycleTimeGlancePanel.tsx:51` |
| `CycleTimeSupplierDetailPanel` | fn | `CycleTimeSupplierDetailPanel.tsx:677` |
| `ProcessDetailBody` | fn | `CycleTimeSupplierDetailPanel.tsx:780` |
| `CycleTimeView` | fn | `CycleTimeView.tsx:509` |
| `MonthlyCycleTrendChart` | fn | `MonthlyCycleTrendChart.tsx:50` |
| `StageBreakdownSection` | fn | `StageBreakdownSection.tsx:184` |
| `StageByCategoryChart` | fn | `StageByCategoryChart.tsx:22` |
| `StageDecompositionTable` | fn | `StageDecompositionTable.tsx:63` |
| `StageOccupancyChart` | fn | `StageOccupancyChart.tsx:54` |
| `InsightKey` | type | `action-insights.ts:33` |
| `InsightStat` | type | `action-insights.ts:39` |
| `InsightColumn` | type | `action-insights.ts:40` |
| `InsightRow` | type | `action-insights.ts:41` |
| `InsightTable` | type | `action-insights.ts:50` |
| `InsightModel` | type | `action-insights.ts:55` |
| `InsightCtx` | type | `action-insights.ts:64` |
| `buildInsight` | fn | `action-insights.ts:679` |
| `CATEGORY_ORDER` | const | `action-priorities.ts:10` |
| `CATEGORY_LABEL` | const | `action-priorities.ts:24` |
| `CATEGORY_COLOR_VAR` | const | `action-priorities.ts:36` |
| `CATEGORY_WHY` | const | `action-priorities.ts:48` |
| `CATEGORY_NUDGE` | const | `action-priorities.ts:68` |
| `ActionGroup` | type | `action-priorities.ts:85` |
| `ACTION_GROUPS` | const | `action-priorities.ts:94` |
| `CYCLE_STAGES` | const | `cycle-time-types.ts:7` |
| `CycleStageKey` | type | `cycle-time-types.ts:14` |
| `CycleFlagKey` | type | `cycle-time-types.ts:19` |
| `SupplierFlagState` | type | `cycle-time-types.ts:20` |
| `FLAG_TOOLTIP` | const | `cycle-time-types.ts:25` |
| `AbcClass` | type | `cycle-time-types.ts:34` |
| `CycleSupplierRow` | type | `cycle-time-types.ts:36` |
| `CycleStageComparison` | type | `cycle-time-types.ts:59` |
| `CyclePoRow` | type | `cycle-time-types.ts:68` |
| `CycleSupplierDetail` | type | `cycle-time-types.ts:83` |
| `CyclePortfolioContext` | type | `cycle-time-types.ts:112` |
| `CycleCategoryRow` | type | `cycle-time-types.ts:122` |
| `CycleBreakdown` | type | `cycle-time-types.ts:133` |
| `ControlExposure` | type | `cycle-time-types.ts:146` |
| `StageOccupancyRow` | type | `cycle-time-types.ts:162` |
| `StageOccupancy` | type | `cycle-time-types.ts:171` |
| `(default)` | default | `page.tsx:12` |
| `(default)` | default | `page.tsx:20` |
| `runtime` | const | `route.ts:5` |
| `runtime` | const | `route.ts:6` |
| `POST` | fn | `route.ts:8` |
| `runtime` | const | `route.ts:13` |
| `POST` | fn | `route.ts:15` |
| `GET` | fn | `route.ts:15` |
| `GET` | fn | `route.ts:34` |
| `GET` | fn | `route.ts:46` |

**Total distinct exports across this doc's files: 60.**
