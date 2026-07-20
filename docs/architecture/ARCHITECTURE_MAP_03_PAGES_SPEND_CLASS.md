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

# ARCHITECTURE MAP 03 — Pages: Spend Overview & Supplier Classification

Scope: two analytical dashboard pages and their entire client/API/chart/lib surface (34 assigned files). Every claim below cites `path:line` and quotes the actual code. Python emitter lines are cited for values that ORIGINATE in `python/compute_analyses.py`; the canonical deep formula derivation lives in `_06` (compute substrate) — here we cite the emitter line + the `AnalysisResult` key + the display hop, and write "deep formula: see _06".

Convention used throughout: **AR** = a row of the `AnalysisResult` table; its `resultJson` column is the typed payload (`getAnalysisResult` at `lib/analysis-types.ts:334-344` quotes `row.resultJson as unknown as T`).

---

# PART A — SPEND OVERVIEW PAGE

## a. PURPOSE

Answers "where did our money go this period, and how concentrated is it?" — total spend / invoice volume / supplier count / average invoice KPIs, a spend-by-category donut, a top-10 supplier bar chart, a monthly spend trend line, an ABC/Pareto concentration card, a full 55-row supplier ranking table, and a per-supplier drill-down (spend-by-item, all invoices, year-by-year evolution). Merged the former standalone ABC Analysis page (server redirect noted in CLAUDE.md; the ABC content is `AbcParetoCard`).

## b. DATA SOURCES

Server → client → API → Prisma trace:

1. **Server page** `app/(dashboard)/spend-overview/page.tsx`:
   - `getCurrentPeriodSelection()` + `resolveAnalysisSource(selection)` (`:14-15`) resolve the selected period/range into a `source`.
   - If `source.kind === "cached"` it looks up the reporting period bounds: `prisma.reportingPeriod.findUnique({ where: { id: source.periodId }, select: { startDate: true, endDate: true } })` (`:31-34`), then `startDate = toIsoDate(period.startDate)` / `endDate = toIsoDate(period.endDate)` (`:43-44`). For `range` it uses `source.startDate`/`source.endDate` directly (`:46-47`). `empty` → `<EmptyState />` (`:17-24`).
   - Renders `<SpendOverviewClient startDate endDate periodLabel isRangeMode={source.kind === "range"} />` (`:55-60`). No analysis data is fetched server-side — the page is purely a span resolver.

2. **Client** `components/SpendOverview/SpendOverviewClient.tsx` POSTs the span:
   ```
   fetch("/api/spend-overview", { method: "POST", ... body: JSON.stringify({ startDate, endDate }) })   // :79-83
   ```
   keyed on `spanKey = `${startDate}_${endDate}`` (`:61`); loaded data tagged with its span key (`:66`).

3. **API** `app/api/spend-overview/route.ts` (POST, `runtime = "nodejs"` `:9`):
   - Auth: `getSession()`; 401 if absent (`:19-22`).
   - `const analyses = await getRangeAnalyses(startDate, endDate)` (`:41`) — the cache-or-compute helper; 400 "No spend data for this period." if `!analyses.spend_overview` (`:42-47`). This is the ONLY read of `spend_overview` + `abc` (AR keys) for the charts.
   - Builds the per-supplier Purchase aggregate with a raw SQL over the span (`:62-72`):
     ```sql
     SELECT "supplierExternalId" AS id, COUNT(*)::int AS po_count, SUM("totalValueUsd")::float8 AS total_spend
     FROM "Purchase"
     WHERE COALESCE("paymentDate", "prDate") >= ${start} AND COALESCE("paymentDate", "prDate") <= ${end}
     GROUP BY "supplierExternalId"
     ```
     The `COALESCE(paymentDate, prDate)` filter mirrors the Python load so totals reconcile with `spend_overview` (comment `:58-59`).
   - Roster identity: `prisma.supplierMetric.findMany({ select: { supplierExternalId, supplierName, category }, distinct: ["supplierExternalId"], orderBy: { periodId: "desc" } })` (`:81-85`). `distinct` avoids per-period fan-out (comment `:78-80`). ALL suppliers are included — those with $0 in-span appear muted & ranked last (comment `:76-77`).
   - `abc`/`kraljic` come from the same `analyses` object: `abcBySupplier` (`:51-53`) and `quadrantBySupplier` (`:54-56`).
   - Assembles `ranking: SupplierRankingRow[]` (`:87-108`): per roster supplier joins agg (spend/po_count), abc_class (`:101`), kraljic_quadrant (`:102`), computes `avg_po_value = poCount > 0 ? totalSpend/poCount : 0` (`:100`), `inactive: poCount === 0` (`:104`); sorts by `total_spend` desc then assigns 1-based `rank` (`:107-108`).
   - Returns `{ spend_overview: analyses.spend_overview, abc: analyses.abc ?? null, ranking }` (`:110-114`).

4. **Drill-down route 1 — spend-detail** `app/api/suppliers/[id]/spend-detail/route.ts` (GET, `?start&end`): period-scoped decomposition for one supplier. Reads:
   - `prisma.supplierMetric.findMany` (periodId/supplierName/category/compositeScore) (`:69-77`), `prisma.supplier.findFirst` (identity/country) (`:78-82`), `prisma.reportingPeriod.findMany` (`:83-86`).
   - `prisma.purchase.findMany` for this supplier over `paymentDate: dateFilter` (`:108-125`) → stats, `byItem` (`:170-184`), `pos` (`:186-202`).
   - When `start && end`: `getRangeAnalyses(start,end)` (`:137`) for period-scoped `abcClass`/`kraljicQuadrant`/`zone`/`rangePerfScore` (`:138-147`); else latest-period `getAnalysisResult` ×3 (`:149-163`).
   - Period-scoped portfolio context via `prisma.purchase.groupBy({ by: ["supplierExternalId"], where: dateFilter ? { paymentDate: dateFilter } : {}, _sum: { totalValueUsd } })` (`:271-275`) → `rank` / `percentOfTotal` / `activeSupplierCount` (`:276-284`).
   - Returns a `SpendDetail` (`:286-311`). 404 only when `metricRows.length === 0 && !supplier` (`:90-91`); a supplier absent from the SPAN returns 200 with zeroed stats.

5. **Drill-down route 2 — evolution** `app/api/suppliers/[id]/evolution/route.ts` (GET, NOT period-scoped, all years):
   - `prisma.reportingPeriod.findMany` + `prisma.purchase.findMany({ where: { supplierExternalId: id } })` + `prisma.supplierMetric.findMany` (per-period sub-scores) in parallel (`:33-60`).
   - For each period reads `getAnalysisResult<AbcResult>/<KraljicResult>/<PerformanceSpendResult>` (`:81-90`).
   - Emits `SupplierEvolution` with per-year spend/invoiceCount/abcClass/kraljicQuadrant/performanceScore/subScores/topItems (`:92-130`) + `insights` strings (`:132-159`). 404 if the supplier has zero purchases (`:62-64`).

## c. COMPUTATION — every displayed value (numbered)

Source-column → transform hops → displayed value. Python-originating values cite the emitter; deep formula: see _06.

**KPI row (`SpendOverviewClient.tsx:149-174`):**

1. **Total spend** — `Purchase.totalValueUsd` → Python `spend_overview()` `"total_spend": num(total_spend)` (`compute_analyses.py:275`; `total_spend = purchases["totalValueUsd"].sum()` `:222`) → AR `spend_overview.total_spend` → client `spend.total_spend` → `formatCompactCurrency(spend.total_spend)` (`SpendOverviewClient.tsx:153`). Format: compact "$X.XM". Sublabel = `phrase` = `periodPhrase(periodLabel, isRangeMode)` → "from 2024 to 2026" / "in 2026" (`:27-35`, `:125`).

2. **Total invoices** — Python `"total_pos": int(len(purchases))` (`compute_analyses.py:276`) → `spend.total_pos` → `num0.format(spend.total_pos)` (`SpendOverviewClient.tsx:159`, `num0 = new Intl.NumberFormat("en-US")` `:24`). Sublabel `${perSupplier.toFixed(1)} per supplier` where `perSupplier = spend.active_suppliers > 0 ? spend.total_pos / spend.active_suppliers : 0` (`:126-127`, `:160`).

3. **Active suppliers** — Python `"active_suppliers": int(purchases["supplierExternalId"].nunique())` (`compute_analyses.py:277`) → `spend.active_suppliers` → `num0.format(...)` (`:165`).

4. **categoryCount ("across N categories")** — ⚠️ **the 14-vs-9 fix.** Client reads `categoryCount = spend.total_categories ?? (spend.top_suppliers_by_category ? Object.keys(...).length : spend.by_category.length)` (`SpendOverviewClient.tsx:131-135`). `total_categories` is the emitted DISTINCT REAL category count: Python `"total_categories": int(len(cat))` where `cat = purchases.groupby("category")["totalValueUsd"].sum()...` (`compute_analyses.py:285`, `:223`) — the FULL per-category groupby, "Other" excluded. It does NOT read `by_category.length` (capped at top-8 + "Other" = ≤9). **Verified: the field read is `spend.total_categories` (type: optional `total_categories?: number` at `analysis-types.ts:26`).** Sublabel at `:166`. This matches CLAUDE.md's "8e23026" fix.

5. **Avg invoice value** — `avgPoValue = spend.total_pos > 0 ? spend.total_spend / spend.total_pos : 0` (`:124`) → `formatCompactCurrency(avgPoValue)` (`:171`). Sublabel literal "per invoice".

**Charts:**

6. **Spend by Category donut** — `spend.by_category` (`SpendOverviewClient.tsx:182` → `<SpendByCategoryChart data={spend.by_category} />`). Python builds `by_category` from top-8 categories by spend + synthetic "Other": `by_category = [... cat.head(8).items()]; if len(cat) > 8: by_category.append({"category": "Other", "total": num(cat.iloc[8:].sum())})` (`compute_analyses.py:224-226`). Rendered as a `PieChart` with `innerRadius={60} outerRadius={100}` (`SpendByCategoryChart.tsx:29-32`), cells cycle `CATEGORY_COLORS[i % CATEGORY_COLORS.length]` (`:33-35`). Tooltip formatter shows `usd0.format(value)` + `(pct%)` computed as `(value/total)*100` where `total = data.reduce(...)` (`:20`, `:37-42`).

7. **Top 10 suppliers bars** — `spend` prop → `<TopSuppliersCard spend={spend} elevated />` (`SpendOverviewClient.tsx:187`). Data = `spend.top_suppliers` (Python top-10: `sup = ...groupby(...).sum().sort_values(...).head(10)` → `top_suppliers` `compute_analyses.py:228-235`) unless a category filter is picked → `byCategory[selected]` (`OverviewCharts.tsx:62-64`). Rendered by `TopSuppliersChart` vertical `BarChart`, bar fill `CHART_COLORS[0]`, `radius={[0,4,4,0]}` (`TopSuppliersChart.tsx:78-102`); Y-axis custom `SupplierNameTick` uses `var(--foreground)` / `var(--primary)` when pinned (`:44-60`, `:90`).

8. **Monthly Spend Trend line** — `spend.monthly_trend` → `<MonthlySpendTrendChart data={spend.monthly_trend} />` (`SpendOverviewClient.tsx:196`). Python emits per payment-month `{month, total, po_count}` (`compute_analyses.py:263-272`). Rendered `LineChart` `dataKey="total"`, `stroke={CHART_COLORS[0]}`, `dot={{ r: 3 }}` (`MonthlySpendTrendChart.tsx:42-48`); tooltip `usd0.format` (`:41`).

**ABC / Pareto (`AbcParetoCard.tsx`, data = `data.abc`):**

9-11. **Class A/B/C blocks** — `abc.summary[cls].n` suppliers + `pct1(abc.summary[cls].pct_of_spend)` of spend (`AbcParetoCard.tsx:38-44`). Python `summary[cls] = {"n": int(len(sub)), "total_spend":..., "pct_of_spend": num((st/grand), 6)}` (`compute_analyses.py:333-337`). Accent colors: `ABC_ACCENT = { A:"destructive", B:"warning", C:"success" }` (`AbcParetoCard.tsx:15-19`) → StatBlock left-border. `pct1 = (fraction) => `${(fraction*100).toFixed(1)}%`` (`:20`).

12. **Pareto bars** — `abc.classifications` → `<ParetoChart data={abc.classifications} />` (`:48`). Bars `dataKey="total"`, per-cell `fill={ABC_COLORS[d.abc_class]}` (`ParetoChart.tsx:77-97`). Python classifies by fixed 80/95: `classify(c): if c<=0.80 return "A"; if c<=0.95 return "B"; return "C"` (`compute_analyses.py:307-312`); `thresholds: [0.80, 0.95]` (`:340`).

13. **Pareto cumulative-% line** — `dataKey="cumulative_pct"`, right axis `domain={[0,1]}`, `stroke="var(--chart-line)"` (`ParetoChart.tsx:98-106`, `:66-72`). Python `spend["cumulative_pct"] = spend["pct"].cumsum()` (`compute_analyses.py:305`).

14-15. **80% / 95% reference lines** — `<ReferenceLine yAxisId="right" y={0.8} stroke={ABC_COLORS.A} .../>` and `y={0.95} stroke={ABC_COLORS.B}` (`ParetoChart.tsx:107-120`). Footer literal "Thresholds fixed at 80% / 95%." (`AbcParetoCard.tsx:50-53`).

**Supplier ranking table (`SupplierRankingTable.tsx`, one row per `SupplierRankingRow`):**

16. **# (positional index)** — `{i + 1}` reflecting current sort, NOT the API's `rank` field, and intentionally not sortable (`SupplierRankingTable.tsx:124`, comment `:27-28`/`:90`).
17. **Supplier** — `r.supplier_name`, truncated `max-w-[200px]` (`:125-129`).
18. **Category** — `r.category ?? "—"`, truncated `max-w-[160px]` (`:130-134`). Source = `SupplierMetric.category` (`route.ts:82`,`:97`).
19. **Spend** — `r.inactive ? "—" : formatCompactCurrency(r.total_spend)` (`:135`). Source = SQL `SUM("totalValueUsd")` (`route.ts:67`,`:93`,`:98`).
20. **Invoices** — `r.inactive ? "—" : num0.format(r.po_count)` (`:136`). Source = SQL `COUNT(*)` (`route.ts:66`,`:92`,`:99`).
21. **Avg invoice** — `r.inactive ? "—" : formatCompactCurrency(r.avg_po_value)` (`:137`). `avg_po_value = poCount>0 ? totalSpend/poCount : 0` (`route.ts:100`).
22. **ABC chip** — color-mix tint 12% + token text: `backgroundColor: color-mix(in srgb, ${ABC_COLORS[r.abc_class]} 12%, transparent)` (`:141-148`), label = bare `r.abc_class`; null → "—" (`:149-151`). Source = `abc.classifications[].abc_class` joined by supplier (`route.ts:90`,`:101`).

**InsightsPanel (`InsightsPanel.tsx`, "Spend at a glance", computed client-side):**

23. **Concentration adjective** — `concentrationWord = aPct >= 70 ? "heavily concentrated" : aPct >= 50 ? "concentrated" : "relatively distributed"` where `aPct = abc.summary.A.pct_of_spend * 100` (`:65`,`:69-70`). Lead sentence quotes `aN` (Class A count), `cN` (Class C), `pct1(aPct)`, `pct1(cPct)` (`:63-66`,`:144-153`). `isConcentrated = aPct >= 50` adds a "Pareto distribution…" clause (`:71`,`:151-152`).

24. **Where the money goes** — categories sorted desc (`:80`), `named = categories.filter(c => c.category !== OTHER)` where `OTHER = "Other"` (`:79`,`:81`). `topCatDominates` gate: `topCatPct >= 40 || (secondCategory.total > 0 && topCategory.total >= 1.5 * secondCategory.total)` → "dominates at" vs "is the largest at" (`:92-97`,`:160`). `top3Pct` = share of top-3 (`:98-102`). Top supplier joined with invoice count: `ranking.find(r => r.supplier_id === topSupplier.supplier_id)?.po_count` (`:114-117`,`:165-175`).

25. **Monthly rhythm bullet** — `median`/`minMonth`/`maxMonth` of `spend.monthly_trend[].total` (`:120-130`,`:183-189`), guarded on `hasRhythm = monthTotals.length >= 2` (`:121`).

26. **Supplier concentration bullet** — `sup50 = suppliersToReach(activeRanking, total, 50)`, `sup80 = suppliersToReach(activeRanking, total, 80)` where `activeRanking = ranking.filter(r => !r.inactive)` (`:134-136`,`:190-196`); `suppliersToReach` walks the spend-desc cumulative until `share(cum,total) >= targetPct` (`:29-38`). Long tail = `Math.max(0, activeRanking.length - sup80)` (`:194`).

27. **Categories-to-80% bullet** — `totalCategories = spendOverview.total_categories ?? (top_suppliers_by_category keys ?? named.length)` (`:82-86`,`:197`); `catsTo80` counts real categories (excluding "Other") until cumulative ≥80% (`:104-111`,`:200`); diversification word `catsTo80 <= 2 ? "narrow" : catsTo80 <= 5 ? "moderate" : "broad"` (`:201`).

## d. VISUAL STRUCTURE

Server page root: `<div className="flex flex-col gap-6">` with `<h1 className="text-2xl font-semibold">` (`page.tsx:51-52`). Client children (rendered as sibling fragments, so the `gap-6` applies between them):

- **InsightsPanel** — `<Card className={cardElevation}>` titled "Spend at a glance", body `<CardContent className="space-y-4 text-sm leading-relaxed">` (`InsightsPanel.tsx:139-143`); bullets `<ul className="list-disc space-y-1 pl-5 text-muted-foreground">` (`:182`).
- **KPI row** — `<div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">` of 4 `<StatBlock size="lg" ...>` (`SpendOverviewClient.tsx:149-174`).
- **Charts row** — `<div className="grid grid-cols-1 gap-4 lg:grid-cols-2">` holding the Spend-by-Category `<Card className={cardElevation}>` and the `<PinProvider value={pinValue}><TopSuppliersCard spend={spend} elevated /></PinProvider>` (`:176-189`).
- **Monthly Spend Trend** — full-width `<Card className={cardElevation}>` (`:191-198`).
- **AbcParetoCard** — `<Card className={cardElevation}>` → grid `<div className="grid grid-cols-3 gap-4">` of 3 StatBlocks over `<ParetoChart>` inside `<CardContent className="space-y-4">` (`AbcParetoCard.tsx:31-56`).
- **SupplierRankingTable** — `<Card className={`overflow-visible ${cardElevation}`}>` (overflow-visible so the `sticky top-0` header pins; comment `:80-81`), `<CardContent className="pt-1">`, a bare `<table className="w-full border-collapse text-sm">` with `sticky top-0 z-10 ... bg-card` `<th>` cells and `py-3` rows (`:82-156`).
- **SpendDecompositionPanel** — a `Dialog`/`DialogContent` centered card, `className="flex max-h-[85vh] w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[680px] ${panelElevation}"`, `showCloseButton={false}` (`SpendDecompositionPanel.tsx:327-332`). Header `border-b p-4` (`:333`); each body section is a `border-b p-4` block (`:434`,`:457`,`:537`,`:549`).

Shared primitives used: `Card`/`CardContent`/`CardHeader`/`CardTitle`, `StatBlock`, `Dialog`/`DialogContent`/`DialogTitle`, `PillTabs`, `ViewToggle`, `ChartFrame`, `CountryFlag`, `SortArrow` (from `@/components/RankingCells`).

## e. INTERACTIONS

- **Local state (client):** `loaded`/`errored` tagged by `spanKey` (derived-loading pattern, no setState-in-effect; `SpendOverviewClient.tsx:62-67`); `selectedSupplierId` (`:64`); `prevSpanKey` render-time reset clears the drill-down on span change (`:70-74`). Fetch effect keyed `[startDate, endDate]` with a `cancelled` guard (`:76-101`).
- **Pin (cross-chart):** `pinValue = { pinnedSupplierId: selectedSupplierId, pin: setSelectedSupplierId, clear }` (`:103-110`) provided ONLY around `TopSuppliersCard` via `<PinProvider>` (`:186-188`). A Top-10 bar click calls `pin(id)` (`TopSuppliersChart.tsx:96-100`) → opens the decomposition panel. The Pareto bars also call `pin` (`ParetoChart.tsx:80-84`) but are OUTSIDE any PinProvider on this page (`AbcParetoCard` is not wrapped), so `usePin()` returns the no-op default context → Pareto clicks are inert here.
- **Ranking table sort:** `useState<{key,dir}>` default `{ total_spend, desc }` (`SupplierRankingTable.tsx:62-65`); `toggleSort` flips dir or sets a sensible default (text asc / numeric desc) (`:72-77`); `SortArrow` shows the active column (`:105`). Row `onClick={() => onSupplierClick(r.supplier_id)}` (`:115`) sets `selectedSupplierId` in the client.
- **Decomposition panel** (`SpendDecompositionPanel`): opens on `open={!!supplierId}` (`:327`); fetches spend-detail keyed `[supplierId, startDate, endDate]` (`:292-305`) and evolution keyed `[supplierId]` (`:308-320`). Body (`SpendDetailBody`) has 3 PillTabs `[["byItem","Spend by item"],["pos","All invoices"],["evolution","Annual breakdown"]]` (`:551-555`) + per-tab `ViewToggle` (chart/table) for byItem & pos (`:564`,`:574`). Tab 1 = horizontal bar `SpendByItemChart` (top-15 + "Others (N)" rollup; `:57-93`); Tab 2 = `PosTimeChart` bars by payment date (`:110-131`); Tab 3 = `EvolutionTab` (annual spend line + product-mix stacked bars + spend-only insights; `:186-268`). Transient UI resets on supplier change via render-time `prevId` compare (`:405-411`). `selectedYear` derived from equal start/end year slices sub-score sparklines (`:414-415`).
- Absent-supplier handling: `absent = st.poCount === 0` → "No items/invoices in this period" empty states (`:420`,`:560-561`,`:570-571`).

---

# PART B — SUPPLIER CLASSIFICATION PAGE

## a. PURPOSE

Answers "how is each supplier positioned by exposure AND by performance, and who should we act on?" — merges the Kraljic exposure matrix (spend × supply-risk) and the Performance-vs-Spend zoning into one page: a glance narrative + KPI row, a 2×2 cross-classification synthesis (Kraljic quadrant × performance median), a two-tab "Classification views" (Exposure positioning scatter + Performance positioning scatter, each with a profile table + drill-in insights), and a full 55-row ranking table filterable by synthesis bucket, plus a per-supplier detail panel (supply-risk breakdown + quadrant peers + performance trajectory).

## b. DATA SOURCES

1. **Server page** `app/(dashboard)/supplier-classification/page.tsx`: `await requireAuth()` (`:22`), reads `?supplier=` into `initialSupplierId` (`:23-24`), resolves the span identically to Spend Overview (`getCurrentPeriodSelection` + `resolveAnalysisSource`; cached branch reads `prisma.reportingPeriod.findUnique` `:48-51`). Renders `<SupplierClassificationClient startDate endDate periodLabel isRangeMode initialSupplierId />` (`:79-85`).

2. **Client** `components/SupplierClassification/SupplierClassificationClient.tsx` POSTs `fetch("/api/supplier-classification", { method:"POST", body: { startDate, endDate } })` keyed on `spanKey` (`:63-87`).

3. **API** `app/api/supplier-classification/route.ts` (POST, nodejs `:19`):
   - Auth 401 (`:29-32`); `getRangeAnalyses(startDate, endDate)` (`:51`) → 400 "No classification data for this period." if `!analyses.performance_spend` (`:52-57`).
   - `perf = analyses.performance_spend` (`:59`), `abc` (`:60`), `abcBySupplier` (`:61-63`), `getSupplierCategoryMap()` (`:64` — supplier→category, not carried on the analyses payloads), `perfBySupplier` (`:65`).
   - Roster: `prisma.supplierMetric.findMany({ select:{ supplierExternalId, supplierName }, distinct:["supplierExternalId"], orderBy:{ periodId:"desc" } })` (`:71-75`).
   - `ranking: ClassificationRankingRow[]` (`:77-91`): per roster supplier joins `perfBySupplier` (`ps`) → `kraljic_quadrant: ps?.kraljic_quadrant`, `performance_score: ps?.performance_score`, `total_spend: ps?.total_spend_usd ?? 0`, `abc_class` from `abcBySupplier`, `category` from `categoryMap`, `inactive: !ps` (`:79-89`); sorted by `total_spend` desc (`:91`).
   - Prior-period YoY summary (single-year only): `prisma.reportingPeriod.findMany` (`:96-99`); finds the exact-match period index `selIdx` (`:101-103`); if `selIdx > 0` reads the prior period's `getAnalysisResult<KraljicResult>("kraljic")` + `<PerformanceSpendResult>("performance_spend")` (`:107-110`), computes `avg` performance + quadrant `counts` from `quadrant_profiles[].n_suppliers` (`:112-121`) → `previous: ClassificationPrevSummary` (`:121`).
   - Returns `{ kraljic, performance_spend, abc, ranking, previous }` (`:125-132`).

4. **Drill-down routes:** the detail panel & unified modal reuse the SAME two supplier routes as Spend Overview — `/api/suppliers/[id]/spend-detail?start&end` (`SupplierClassificationDetailPanel.tsx:497`) and `/api/suppliers/[id]/evolution` (`:511`). See Part A §b items 4-5 for those payloads. The classification-specific data (supply-risk breakdown, quadrant peers) is read from the ALREADY-LOADED `kraljic`/`perf` props (no extra fetch): `myAssignment = kraljic?.quadrant_assignments.find(q => q.supplier_id === supplierId)` (`SupplierClassificationDetailPanel.tsx:624-626`).

## c. COMPUTATION — every displayed value (numbered)

**Kraljic scatter (`KraljicScatterChart.tsx`, data = `kraljic.quadrant_assignments`):**

1. **Dot X position** — `dataKey="log_spend"` (`:112-114`). Python `"log_spend": num(spend_map[s])` where `spend_map[sid] = np.log1p(v)` (`compute_analyses.py:952`,`:895`). Axis RELABELED as "% of total spend" via `buildSpendAxis` (positions stay at log_spend; only labels change — `lib/spend-axis.ts:1-12`,`:36-75`); `total = assignments.reduce((sum,a) => sum + Math.expm1(a.log_spend), 0)` (`KraljicScatterChart.tsx:72`).
2. **Dot Y position** — `dataKey="supply_risk_score"` (`:127-142`). Python `"supply_risk_score": risk_total` = the 2dp sum of `risk_components` (`compute_analyses.py:939`,`:953`). Deep formula: see _06.
3. **Dot color** — by quadrant: `fill={QUADRANT_COLORS[q]}` per `<Scatter>` series (`:160-172`). `"quadrant": quad_map[s]` (`compute_analyses.py:955`).
4. **Reference lines** — `x={thresholds.spend_median}`, `y={thresholds.risk_median}`, both `stroke="#94a3b8"` (`:150-159`). Python `axis_thresholds: {spend_median, risk_median}` (`compute_analyses.py:980`). ⚠️ These two ReferenceLine strokes are hardcoded hex `#94a3b8` — a deviation from the "theme tokens only / no hardcoded hex" rule in CLAUDE.md (same in `PerformanceSpendScatter.tsx:157-166`).
5. **Tooltip** — `spendMoneyAndShare(Math.expm1(d.log_spend), total)` + `Risk d.supply_risk_score.toFixed(1)` (`KraljicScatterChart.tsx:44-48`; helper `spend-axis.ts:85-89`).

**Performance-vs-Spend scatter (`PerformanceSpendScatter.tsx`, data = `perf.suppliers`):**

6. **Dot X** — `dataKey="log_spend"` relabeled % (`:118-133`), `total = suppliers.reduce(sum + s.total_spend_usd)` (`:83`).
7. **Dot Y** — `dataKey="performance_score"`, fixed `domain={[0,100]}` at rest (`:134-149`). Python `"performance_score": num(perf_of(s))` (the filter-live composite; `compute_analyses.py:649`,`:921-929`). Deep formula: see _06.
8. **Dot color** — by ZONE: series over `ZONE_ORDER`, `fill={ZONE_COLORS[z]}` (`:75-79`,`:167-177`). Deliberately distinct from the Kraljic quadrant palette (comment `:72-74`); the quadrant appears only as a tooltip cross-ref (`:47-50`). Python `zone_of(s)`: `hi_spend = log_spend > spend_med`, `hi_perf = perf > perf_med` → Stars / Critical Issues / Hidden Gems / Long Tail (`compute_analyses.py:632-641`). ⚠️ Note the strict `>`: an exactly-at-median supplier is LOW-perf.

**Quadrant profile table (`ClassificationTabs.tsx` KraljicTab, `:414-447`):**

9. **Suppliers** — `p?.n_suppliers ?? 0` (`:439`). Python `"n_suppliers": len(members)` (`compute_analyses.py:968`).
10. **Total spend** — `usd(p?.total_spend ?? 0)` compact 1dp (`:440`; `usd` `:47-53`). Python `"total_spend": num(tot)` (`:969`).
11. **% of spend** — `num(p?.pct_of_total_spend ?? 0)` 1dp (`:441`). Python `"pct_of_total_spend": num((tot/grand_total)*100)` (`:970`).
12. **Avg performance (2dp)** — `num(p?.avg_performance_score ?? null, 2)` (`:442`). Python `"avg_performance_score": num(np.mean(perfs))` (`:971`). ⚠️ 2dp per the CLAUDE.md "2-decimal precision EVERYWHERE" rule — confirmed (`num(x, 2)`).

**Zone profile table (`ClassificationTabs.tsx` PerformanceTab, `:484-517`):**

13. **Suppliers** — `p?.n_suppliers ?? 0` (`:509`). Python `"n_suppliers": len(members)` (`compute_analyses.py:665`).
14. **Total spend** — `usd(p?.total_spend_usd ?? 0)` (`:510`). Python `"total_spend_usd": num(tot)` (`:666`).
15. **% of spend** — `num(p?.pct_of_total_spend ?? 0)` (`:511`). Python `"pct_of_total_spend": num((tot/grand_total)*100)` (`:667`).
16. **Avg performance (2dp)** — `num(p?.avg_performance ?? null, 2)` (`:512`). Python `"avg_performance": num(np.mean(perfs))` (`:668`).

**Cross-classification synthesis cards (`CrossClassificationCard.tsx` + `lib/supplier-classification.ts`):**

The four buckets are computed by `computeSynthesis(perf)` (`supplier-classification.ts:94-119`): `median = perf.axis_thresholds.performance_median` (`:97`); `below = s.performance_score <= median` (`:108`, at-or-below = LOW, matching the Python strict-`>` zone split — comment `:104-107`); each supplier matched to the `SYNTHESIS_META` entry with `m.quadrant === s.kraljic_quadrant && m.below === below` (`:109-112`); each bucket sorted `total_spend_usd` desc (`:115-117`).

17. **strategic_under** — Strategic quadrant, `below: true`; title "Strategic underperformers", action "Secure supply or qualify alternates." (`:39-51`).
18. **bottleneck_critical** — Bottleneck, `below: true`; "Bottleneck critical issues", action "Prioritize engagement & risk mitigation." (`:52-64`).
19. **leverage_workhorse** — Leverage, `below: false` (the only ABOVE-median bucket); "Workhorse leverage", action "Consolidate volume to negotiate." (`:65-77`).
20. **routine_risk** — Routine, `below: true`; "Routine quality risks", action "Rationalize or move to catalog buys." (`:78-90`).

Each tile displays `count = suppliers.length` (`CrossClassificationCard.tsx:75`,`:119`), top-`TOP_N=3` names inline (`:28`,`:96`,`:139-148`) with "…+N more" expand (`:149-160`), and `meta.action`/"View suppliers →" footer (`:174-184`). Empty bucket → muted non-interactive tile "No suppliers in this category…" (`:78-94`). ⚠️ CLAUDE.md's `routine_risk` synthesis-card blue-alignment note refers to `theme.text: "text-blue-600 dark:text-blue-400"` (`:85-88`) — confirmed blue, matching `--quadrant-routine`.

**ClassificationInsightsPanel (`ClassificationInsightsPanel.tsx`, computed client-side from loaded analyses):**

21. **Portfolio size** — `portfolioSize = kraljic ? kraljic.quadrant_profiles.reduce((s,p)=>s+p.n_suppliers,0) : total` (`:90-92`; F14 note — the SAME population the quadrant counts sum to). Displayed in the lead prose (`:174-176`) and a StatBlock (`:206-211`).
22. **Avg performance vs median** — `avgPerf = perf.suppliers.reduce(...)/total` (`:79-82`), `median = perf.axis_thresholds.performance_median` (`:78`); prose "Performance averages X against a period median of Y" (`:180-184`); StatBlock "Avg performance" value `avgPerf.toFixed(2)` sublabel `period median ${median.toFixed(2)}` (`:212-217`).
23. **Distribution sentence** — single-year-with-prior → YoY: `dir` from `avgPerf` vs `previous.avg_performance` (`:104-107`) + `quadShiftPhrase(changed)` per-quadrant deltas `countOf(q) - previous.quadrant_counts[q]` (`:108-112`,`:36-52`). Else → largest-quadrant note (`:126-137`). `countOf(q) = kraljic?.quadrant_profiles.find(p=>p.quadrant===q)?.n_suppliers ?? 0` (`:84-85`).
24. **Strategic-underperformers bullet** — `strategicUnder = computeSynthesis(perf).strategic_under.length` (`:96`); bullet "N Strategic suppliers sit at or below the period median" or, if 0, "All N Strategic suppliers sit above…" (`:142-156`).
25. **Class-A bullet + StatBlock** — `classA = abc?.summary.A.n ?? null` (`:97`); bullet (`:157-164`) + conditional StatBlock "Class A suppliers" (`:224-231`).
26. **Strategic-suppliers StatBlock** — `strategicCount = countOf("Strategic")` (`:94`) sublabel "high spend × high risk" (`:218-223`).

**Ranking table (`SupplierClassificationTable.tsx`, one row per `ClassificationRankingRow`):**

27. **#** — `{i+1}` positional (`:162`). **Supplier** — `r.supplier_name` truncated (`:163-167`). **Category** — `r.category ?? "—"` (`:168-172`).
28. **ABC chip** — `<Chip color={r.abc_class ? ABC_COLORS[r.abc_class] : null} label={r.abc_class} />` (`:173-175`), color-mix 12% tint (`:47-58`).
29. **Exposure chip** — `<Chip color={QUADRANT_COLORS[r.kraljic_quadrant]} label={r.kraljic_quadrant} />` (`:176-181`).
30. **Performance** — `<PerfBar score={r.performance_score} />` (`:182-184`, from `@/components/RankingCells`). Source = `perf.suppliers[].performance_score` (`route.ts:86`).
31. **Spend** — `r.inactive ? "—" : formatCompactCurrency(r.total_spend)` (`:185-187`).

**Group-insights drill-in (`ClassificationTabs.tsx` `kraljicInsights`/`perfInsights`):** when a profile-table row is clicked, a `GroupInsightsPanel` renders. Summary stats: Avg spend / Avg risk (or Avg performance) / Share of spend (`:112-122`,`:189-199`). Notable patterns are self-omitting: widest supply-risk/performance spread (`:124-136`,`:201-212`) + `dominantCategoryPattern` ("Most concentrated in X (n of N suppliers)" when `ids.length>=3 && topN/ids.length>=0.5 && topN>=2`, `:84-99`). Standout: Kraljic → LEAST-risky member gets ★ (`:146-156`); Performance → top performer gets ★ only in above-median zones (`aboveMedian = z==="Stars"||z==="Hidden Gems"`, `:220-239`). Weakest = most-risky / worst-performer caveat for multi-member groups.

## d. VISUAL STRUCTURE

Server root `<div className="flex flex-col gap-6">` with title + subtitle "Combined exposure and performance positioning" (`page.tsx:71-78`). Client children (sibling fragments):

- **ClassificationInsightsPanel** — `<Card className={cardElevation}>` "Classification at a glance", `<CardContent className="space-y-4 text-sm leading-relaxed">` (`:168-172`), then a StatBlock grid `<div className="grid grid-cols-2 gap-4 lg:grid-cols-4">` of 4 `StatBlock size="comfortable"` (`:205-232`). Rendered as a fragment (`<>...</>` `:166-233`).
- **CrossClassificationCard** — `<Card className={cardElevation}>` "Cross-classification insights", grid `<div className="grid grid-cols-1 gap-3 sm:grid-cols-2">` of 4 `SynthesisTile`s (`:212-235`). Each tile `flex flex-col gap-2 rounded-lg border bg-muted/30 p-4` (`:109-115`), empty variant `border-l-4 border-l-muted-foreground/30 ... opacity-60` (`:80-83`).
- **ClassificationTabs** (`key={spanKey}` remounts on span change, `Client.tsx:136`) — `<Card className={cardElevation}>` "Classification views" with `<PillTabs className="mt-2" tabs=[["kraljic","Exposure positioning"],["performance","Performance positioning"]] />` (`:551-560`), `<CardContent className="p-4">` holding a scatter (`relative` wrapper + optional `ResetZoomButton absolute right-2 top-2`), a shadcn `<Table>` profile, and a conditional `GroupInsightsPanel` (`:403-457`,`:473-527`).
- **SupplierClassificationTable** — wrapped in `<div ref={tableRef} className="scroll-mt-20">` (`Client.tsx:143`); `<Card className={`overflow-visible ${cardElevation}`}>` with an optional destructive-tint filter banner `mb-3 ... rounded-lg border px-3 py-2.5` (`:99-119`) above a `sticky top-0` `<table>` (`:120-192`).
- **SupplierClassificationDetailPanel** — `Dialog`/`DialogContent` `sm:max-w-[680px] max-h-[85vh] ... p-0 ${panelElevation}` (`:530-535`); header `border-b p-4` (`:536`); body sections `border-b p-4` (`:640`,`:667`,`:680`).

Shared primitives: `Card*`, `StatBlock`, `Dialog*`, `PillTabs`, shadcn `Table*`, `SortArrow`/`PerfBar` (RankingCells), `CountryFlag`, `ScoreComponents`, `ChartFrame`.

## e. INTERACTIONS

- **Local state (client):** `loaded`/`errored` span-keyed (`Client.tsx:33-34`,`:52-53`); `selectedSupplierId` seeded from `initialSupplierId` deep-link (`:35`); `activeSynthesis: SynthesisKey | null` (`:36`); `tableRef` for scroll (`:37`). Render-time `prevSpanKey` compare resets both selection & synthesis filter on span change (`:56-61`). Fetch effect keyed `[startDate,endDate]` (`:63-87`).
- **Synthesis filter → table:** `handleSynthesisSelect(key)` sets `activeSynthesis` then `requestAnimationFrame` scrolls the table into view with an 80px offset (`:41-50`). `filteredRanking` = `data.ranking` filtered to `computeSynthesis(data.performance_spend)[activeSynthesis]` ids (`:97-103`). The table shows a "Filtered to X · N suppliers" banner + Clear (`Table.tsx:99-119`). A tile's "View suppliers →" toggles via `onToggleFilter` (`CrossClassificationCard.tsx:176-184`,`:231`).
- **Classification-views tab drill:** each tab holds its own `selected` quadrant/zone (`ClassificationTabs.tsx:391`,`:469`); clicking a profile row toggles it (`:429-434`,`:499-505`) → animate-zooms the scatter (`zoomQuadrant`/`zoomZone` prop drives `useAnimatedDomain`, `KraljicScatterChart.tsx:86-105`, `PerformanceSpendScatter.tsx:95-112`) AND opens the `GroupInsightsPanel`. `ResetZoomButton` clears it (`:369-380`,`:412`,`:482`). Switching top-level tabs unmounts the other's selection (comment `:534-535`).
- **Scatter point click → detail:** `<PinnableDot onSelect={onDotClick} />` (`KraljicScatterChart.tsx:170`, `PerformanceSpendScatter.tsx:175`) → `onSupplierClick(id)` → `setSelectedSupplierId`. Names inside synthesis tiles (`NameButton`, `CrossClassificationCard.tsx:31-56`), group-insight member lists (`ClassificationTabs.tsx:340-353`), and ranking rows (`Table.tsx:154`) all call `onSupplierClick`.
- **Detail panel** (`SupplierClassificationDetailPanel`): fetches spend-detail keyed `[supplierId,startDate,endDate]` (`:492-505`) + evolution keyed `[supplierId]` (`:507-519`). Body (`ClassificationDetailBody`) has an expandable "Performance trajectory" card (`PerfSummaryButton` `open` state `perfOpen` default true, `:610`,`:647-653`) whose expanded `ScoreComponents` render full-width below the grid (`:657-661`), a `QuadrantTenureCard` (`:654`), and 2 PillTabs `[["risk","Supply risk"],["peers","Quadrant peers"]]` (`:682-687`). Tab "risk" → `SupplyRiskBreakdown` (3 bars: supply_concentration ≤50 / cost_premium ≤25 / import_friction ≤25 from `myAssignment.risk_components`, `:235-309`,`:691-695`); tab "peers" → `QuadrantPeers` (same-quadrant peer table, default sort by the quadrant's defining axis `DEFAULT_PEER_SORT`, self-rank insight, `:311-461`,`:697-705`). Peer-row clicks re-target the panel via `onSupplierClick` (`:421`). Transient state resets on supplier change via render-time `prevId`/`prevQuad` compares (`:611-616`,`:355-360`).

---

# PART C — SHARED / SUPPORTING FILES

## lib/spend-overview-types.ts (shapes the ranking + drill payloads)

Exported types (3):
- **`SupplierRankingRow`** (`:4-17`) — `supplier_id, supplier_name, category|null, total_spend, po_count, avg_po_value, abc_class:"A"|"B"|"C"|null, kraljic_quadrant:KraljicQuadrant|null, rank, inactive`. Comment: inactive rows render muted, ranked last (`:14-16`).
- **`SpendDetail`** (`:20-74`) — nested `supplier{ id,name,category,country,abcClass,kraljicQuadrant,zone,performance{score,mode:"single"|"range"|"all",periodLabel,previousScore,previousLabel,latestScore,latestLabel} }` + `stats{ totalSpend,poCount,earliestDate,latestDate,avgPoValue,rank,percentOfTotal,activeSupplierCount }` + `byItem[]` + `pos[]`. The `performance.mode` discriminant drives the panel's score display (`:38-46`).
- **`SupplierEvolution`** (`:77-98`) — `supplier{id,name}` + `periods[]{ year,periodLabel,spend,invoiceCount,abcClass,kraljicQuadrant,performanceScore,subScores{quality,delivery,process,risk}|null,topItems[] }` + `insights[]`.

## lib/supplier-classification-types.ts

Exported types (4):
- **`ClassificationRankingRow`** (`:9-22`) — `supplier_id, supplier_name, category|null, abc_class, kraljic_quadrant, performance_score|null, total_spend, inactive`. ⚠️ The comment (`:16-17`) calls `performance_score` the "latest-in-range snapshot" but the API sets it from the filter-live `perf.suppliers[].performance_score` (`route.ts:86`) — a stale comment, not a runtime divergence.
- **`SynthesisKey`** (`:25-29`) — union `"strategic_under" | "bottleneck_critical" | "leverage_workhorse" | "routine_risk"`.
- **`ClassificationPrevSummary`** (`:37-41`) — `periodLabel, avg_performance, quadrant_counts: Record<KraljicQuadrant, number>`.
- **`ClassificationPageData`** (`:44-50`) — `kraljic|null, performance_spend, abc|null, ranking[], previous|null`.

## lib/supplier-classification.ts

`SynthesisMeta` type (`:17-29`), `SYNTHESIS_ORDER` (`:31-36`), `SYNTHESIS_META` record (thresholds/copy per bucket, `:38-91`), and `computeSynthesis()` (`:94-119`) — documented under Part B §c items 17-20. The key threshold is `below = s.performance_score <= median` (`:108`), deliberately treating the at-median supplier as LOW-perf to match Python's strict-`>` `zone_of` (comment `:104-107`) — a confirmed code-vs-code CONSISTENCY (E11), not a divergence.

## lib/spend-axis.ts

VIZ-ONLY %-of-spend axis for both scatters; points still plotted at `log_spend` so positions/median-split/assignments are byte-identical to compute (comment `:1-12`). Exports: `formatSpendPct` (<0.1%→2dp, <1%→1dp, ≥1%→0dp; `:16-21`), `SpendAxis` type (`:23-30`), `buildSpendAxis(logSpends,total)` (`:36-75` — pad `Math.max(0.25, span*0.04)` `:47`, decade ticks via `posOfPct(10**e)` `:53-64`, guarantees ≥2 ticks `:66-69`, defuzz round-trip `snap` `:72-73`), `formatSpendMoney` (`:78-82`), `spendMoneyAndShare` ("$28.4M (4.83%)" `:85-89`). Consumed by `KraljicScatterChart`/`PerformanceSpendScatter` only.

## lib/supplier-detail.ts (`buildSupplierDetail`)

Pure cross-analysis assembler NOT used by these two pages' panels — it serves the Action Priorities `UnifiedSupplierDetailModal`'s callers (via `SupplierDetailInput`). Exports `SupplierDirectory` type (`:19-22`, static `{country, num_pos}`), `SupplierDetailInput` type (`:25-31`, the analyses subset), `SupplierDetail` type (`:33-47`), and `buildSupplierDetail(supplierId, a, supplierCategory, directory)` (`:56-98`): finds the supplier's rows in `abc.classifications` / `kraljic.quadrant_assignments` / `performance_spend.suppliers`, returns null when the name resolves in none (`:71-73`), and merges spend/perf/risk/classification/anomalies/recs from the loaded analyses + identity from the static maps. `total_spend_usd: psRow?.total_spend_usd ?? abcRow?.total ?? null` (`:88`); `kraljic_quadrant: krRow?.quadrant ?? psRow?.kraljic_quadrant ?? null` (`:93`).

## components/UnifiedSupplierDetailModal.tsx (shared drill from Action Priorities; reuses THESE pages' bodies)

One centered `Dialog` (`sm:max-w-[680px] max-h-[85vh] ... p-0 ${panelElevation}`, `showCloseButton={false}`, `:191-195`) stacking 3 top-level analysis tabs behind `PillTabs tabs=[["classification","Classification"],["spend","Spend"],["process","Process"]]` (`:232-236`), `initialTab` prop defaulting `"classification"` (`:55`,`:69`). **Body-extraction pattern:** it renders the presentational bodies exported from the three page panels — `ClassificationDetailBody` (from `SupplierClassificationDetailPanel.tsx:586`), `SpendDetailBody` (from `SpendDecompositionPanel.tsx:381`), `ProcessDetailBody` (from `CycleTimeSupplierDetailPanel.tsx:780`, imported `:24`). Shared fetch: spend-detail + evolution fetched ONCE (`:101-128`) and fed to BOTH the Classification and Spend bodies (no double fetch). **Lazy Process fetch:** `processOpened` seeded `initialTab === "process"` (`:72`); the breakdown roster + per-supplier cycle detail are fetched only when `processOpened` (`:134-160`) — `openTab` flips it true on first Process open (`:85-88`). Derives roster context (iqrCutoff = `median(roster.iqr)*1.5`, `inconsistent`, `stageDominatedPoIds`, `portfolio`) exactly as CycleTimeClient does (`:162-178`). Reset key `${supplierId}_${startDate}_${endDate}` render-time re-lands on `initialTab` (`:77-83`). Shared identity header sourced from `detail.supplier` (`:196-224`). Row→modal wiring: mounted on Action Priorities (not on these two pages), but it re-uses the two page panels' bodies — the DRY seam these pages export.

## components/analysis/RangeCompute.tsx (shared with reports; `kind` branching)

Client that POSTs `/api/analyses/compute-range` for a span (`:52-56`) and renders one of four views by `kind: "overview" | "abc" | "recommendations" | "cycle_time"` (`:16-20`). Branches (`:96-127`): `overview` → `<OverviewCharts spend={...} />`; `abc` → `<AbcView abc={...} />`; `recommendations` → `<ActionDashboardView ... />` (passes `temporal` + `supplierCategory` props, `:106-121`); default → `<CycleTimeView data={...} />`. ⚠️ Header comment (`:12-15`): Kraljic + performance_spend ranges are now served by the Supplier Classification page's OWN client — "no longer routed through RangeCompute". So this shared component does NOT drive either of the two pages in this doc; it's the report/legacy range surface for overview/abc/recs/cycle. Parents pass a `key` from the dates to remount into loading (comment `:27-31`).

## components/analysis/OverviewCharts.tsx (shared with report editor)

Exports `TopSuppliersCard` (used by Spend Overview `:187` with `elevated`, and internally) and `OverviewCharts`. `TopSuppliersCard` (`:47-106`): category filter Select fed by `spend.top_suppliers_by_category` keys (`:56-69`); "All Categories" → `spend.top_suppliers`, else `byCategory[selected]` (`:62-64`); filter hidden when the per-category field is absent (`:60`,`:75`). `OverviewCharts` (`:167-220`): 4 `KpiCard`s (Total Spend / Total invoices / Active Suppliers / **Avg Cycle Time** = `spend.avg_cycle_time.toFixed(1)` days — `:196`; ⚠️ this `avg_cycle_time` KPI appears ONLY here, i.e. only in the report-embedded overview, NOT on the standalone Spend Overview page whose KPI row uses "Avg invoice value" instead). `embedded` flag adds monthly-trend/po_count sparklines (`:174-179`) and STACKS the 3 chart cards (Monthly / By category / Top suppliers) because a Recharts chart inside a `display:none` tab prints blank (comment `:160-165`,`:199-215`). Non-embedded stacks the same three (`:207-215`). Standalone Spend Overview does NOT use `OverviewCharts` — it composes its own cards; only `TopSuppliersCard` is shared.

## components/analysis/AbcView.tsx (shared with reports; RangeCompute `kind="abc"`)

Full ABC view: Methodology card ("top 80% → A, next 15% → B, bottom 5% → C … 80% / 95%" `:35-44`), 3 class cards with `borderLeft: 4px solid ABC_COLORS[cls]` (`:46-62`), a `ParetoChart` (`:64-71`), and a full per-supplier `<Table>` (Rank/Supplier/Class badge/Total Spend/% /Cumulative %, `:73-118`). `usdCompact` 1dp (`:23-28`), `pct1` (`:29`). Reached via `RangeCompute` `kind="abc"` (which CLAUDE.md notes is now unreachable-but-harmless) and the report editor's ABC section — NOT the Spend Overview dashboard (which uses the compact `AbcParetoCard` instead).

## components/charts (7 chart components)

- **KraljicScatterChart.tsx** — documented Part B §c 1-5. `ScatterChart height={450}` (`:108`), animate-zoom via `useAnimatedDomain` (`:97`), zoomed series hides non-selected quadrants (`data={... ? [] : filter}` `:167`), Legend `verticalAlign="top"` to avoid axis-label collision (`:147-149`). Hardcoded `#94a3b8` reference strokes (`:151-158`).
- **PerformanceSpendScatter.tsx** — documented Part B §c 6-8. Same zoom/legend structure; owns the ZONE palette (`:72-79`); Y fixed `[0,100]` (`:93`,`:138`). Hardcoded `#94a3b8` strokes (`:157-166`).
- **ParetoChart.tsx** — documented Part A §c 12-15. `ComposedChart height={400}` (`:52`); dual Y-axes (left spend `usdCompact`, right cumulative `[0,1]` as %); pin-aware cell stroke via `usePin()` (`:50`,`:86-96`); bar `onClick` pins (`:80-84`); cumulative `stroke="var(--chart-line)"` (`:104`).
- **SpendByCategoryChart.tsx** — documented Part A §c 6. Donut `innerRadius={60} outerRadius={100} paddingAngle={1}`, `CATEGORY_COLORS` cells, tooltip full `usd0` + % (`:15-47`).
- **TopSuppliersChart.tsx** — documented Part A §c 7. Vertical `BarChart height={Math.max(300, data.length*36)}` (`:78`); pin via `usePin()` (`:74`) — pinned bar gets `stroke="currentColor" strokeWidth={2}` (`:104-112`) and pinned name highlighted `var(--primary)` bold (`:44-60`); bar `onClick` pins (`:96-100`).
- **MonthlySpendTrendChart.tsx** — documented Part A §c 8. `LineChart height={300}`, `dataKey="total"`, `stroke={CHART_COLORS[0]}`, tooltip `usd0` (`:26-52`).
- (Chart deps `ChartFrame`, `PinnableDot`, `useAnimatedDomain`, `PinContext`, `Sparkline`, `PortalTooltip` are imported but NOT in the assigned 34 — cited only where referenced.)

## components/PerformanceScoreCard.tsx

⚠️ **ORPHANED / DEAD CODE.** Defines `PerformanceScoreCard` (`:34-115`) — a clickable performance StatBlock with a signed `PerfDelta` (`:9-25`) and mode-aware sublabel ("single"/"range"/"all", `:52-77`). **Grep confirms it is never imported anywhere in the repo** (only its own definition matches `PerformanceScoreCard`). The Supplier Classification detail panel uses a LOCAL `PerfSummaryButton` instead (`SupplierClassificationDetailPanel.tsx:76-164`), and Spend Overview shows a plain "Performance" StatBlock (`SpendDecompositionPanel.tsx:440-452`). This component is a candidate for deletion — flag for the maintainers.

## components/PerformanceTrajectory.tsx (used via `ScoreComponents`)

Exports `ScoreComponents` (`:266-319`) — imported by the Supplier Classification detail panel (`SupplierClassificationDetailPanel.tsx:19`,`:659`). Renders the composite trajectory (`CompositeTrajectory` `:202-257`: 0-1 pts → single value, 2 → "before → after" + `DeltaBadge`, 3+ → tight-domain `LineChart` with Y clamped to `[max(0,floor(min-pad)), min(100,ceil(max+pad))]`, `:232-256`) plus 5… actually 4 per-sub-score cards. **⚠️ The `SUBS` weights (`:18-23`) are Quality 30 / Delivery 30 / Process 22 / Risk 18** — matching the current composite `0.30·Q + 0.30·D + 0.22·P + 0.18·R` in CLAUDE.md (4 dims, Service removed). `SubScoreCard` (`:98-158`) shows value 2dp, an inline-SVG `CardSparkline` with a portal tooltip (`:35-96`), a weight bar (`width: ${weight}%`), and a delta ("stable" on zero-delta, "first year on record" on null). `selectedYear` slices ONLY the sub-score sparklines (`sparkKeep`, `:274-276`,`:300-301`), value/delta stay all-years (comment `:265-268`).

---

# DIVERGENCES & FLAGS

1. **`total_categories` (the 14-vs-9 fix) — CONFIRMED, no divergence.** Both `SpendOverviewClient.tsx:131-135` and `InsightsPanel.tsx:82-86` read `spend.total_categories` first (fallback to `top_suppliers_by_category` keys, then `by_category.length`). Emitter `compute_analyses.py:285` `"total_categories": int(len(cat))` = distinct real categories, "Other" excluded (`:279-284`). Type is optional `total_categories?` (`analysis-types.ts:26`) for old cached rows. Matches CLAUDE.md's `8e23026` claim exactly.

2. **Kraljic / zone at-median convention — CONSISTENT (E11).** Python `zone_of` uses strict `>` (`compute_analyses.py:632-634`), so at-median = LOW-perf → Critical Issues/Long Tail. `computeSynthesis` mirrors it with `below = score <= median` (`supplier-classification.ts:108`). No code-vs-Methodology divergence.

3. **Hardcoded hex `#94a3b8`** on the scatter reference lines (`KraljicScatterChart.tsx:151-158`, `PerformanceSpendScatter.tsx:157-166`) violates the CLAUDE.md "Theme-aware tokens only — NO hardcoded hex" scope rule. Also `EvolutionTab`'s amber note uses Tailwind `amber-*` literals (`SpendDecompositionPanel.tsx:217`) and the two YoY cards use `text-green-600 dark:text-green-500` / `text-red-*` literals (`:513-514`) — colour literals, not tokens.

4. **`PerformanceScoreCard.tsx` is dead code** — defined, never imported (grep-verified). Not referenced by either page.

5. **`ClassificationRankingRow.performance_score` doc comment stale** — says "latest-in-range snapshot" (`supplier-classification-types.ts:16-17`) but the API populates it from the filter-live `perf.suppliers[].performance_score` (`route.ts:86`). Comment-only, no runtime impact.

6. **`avg_cycle_time` KPI mismatch across surfaces** — the standalone Spend Overview page shows "Avg invoice value" (`SpendOverviewClient.tsx:168-173`); only the report-embedded `OverviewCharts` shows "Avg Cycle Time" (`OverviewCharts.tsx:196`). Not a bug — noted so the two spend-overview surfaces aren't assumed identical.

7. **Pareto pin is inert on Spend Overview** — `AbcParetoCard` (which contains `ParetoChart`) is not wrapped in a `PinProvider` (only `TopSuppliersCard` is, `SpendOverviewClient.tsx:186-188`), so Pareto bar clicks hit the no-op default `usePin()` and do nothing. Working as designed (single pin scoped to Top-10), but worth recording.

8. **Ranking table shows the FULL roster (55), not just in-period suppliers** — both APIs seed the ranking from `SupplierMetric distinct supplierExternalId` (`spend-overview/route.ts:81-85`, `supplier-classification/route.ts:71-75`), so $0/inactive suppliers appear muted & ranked last. Matches CLAUDE.md. (The latent "spend ranking drops a metric-less supplier" hole noted in CLAUDE.md is confirmed structurally: a Purchase-only supplier with no `SupplierMetric` row would be absent from this roster — not firing today.)

---

## A3 EXPORTS COMPLETENESS INDEX (auto-generated — every `export` in this doc's files, cited)

Guarantees one-to-one A3 coverage: each symbol below is defined at the cited line in a file this doc documents.

| Symbol | Kind | file:line |
|---|---|---|
| `AbcParetoCard` | fn | `AbcParetoCard.tsx:29` |
| `AbcView` | fn | `AbcView.tsx:32` |
| `ClassificationInsightsPanel` | fn | `ClassificationInsightsPanel.tsx:61` |
| `ClassificationTabs` | fn | `ClassificationTabs.tsx:537` |
| `CrossClassificationCard` | fn | `CrossClassificationCard.tsx:196` |
| `InsightsPanel` | fn | `InsightsPanel.tsx:46` |
| `KraljicScatterChart` | fn | `KraljicScatterChart.tsx:52` |
| `MonthlySpendTrendChart` | fn | `MonthlySpendTrendChart.tsx:26` |
| `TopSuppliersCard` | fn | `OverviewCharts.tsx:47` |
| `OverviewCharts` | fn | `OverviewCharts.tsx:167` |
| `ParetoChart` | fn | `ParetoChart.tsx:49` |
| `PerformanceScoreCard` | fn | `PerformanceScoreCard.tsx:34` |
| `PerformanceSpendScatter` | fn | `PerformanceSpendScatter.tsx:59` |
| `ScoreComponents` | fn | `PerformanceTrajectory.tsx:266` |
| `RangeCompute` | fn | `RangeCompute.tsx:32` |
| `SpendByCategoryChart` | fn | `SpendByCategoryChart.tsx:15` |
| `SpendDecompositionPanel` | fn | `SpendDecompositionPanel.tsx:271` |
| `SpendDetailBody` | fn | `SpendDecompositionPanel.tsx:381` |
| `SpendOverviewClient` | fn | `SpendOverviewClient.tsx:48` |
| `SupplierClassificationClient` | fn | `SupplierClassificationClient.tsx:18` |
| `SupplierClassificationDetailPanel` | fn | `SupplierClassificationDetailPanel.tsx:466` |
| `ClassificationDetailBody` | fn | `SupplierClassificationDetailPanel.tsx:586` |
| `SupplierClassificationTable` | fn | `SupplierClassificationTable.tsx:61` |
| `SupplierRankingTable` | fn | `SupplierRankingTable.tsx:52` |
| `TopSuppliersChart` | fn | `TopSuppliersChart.tsx:73` |
| `UnifiedSupplierDetailModal` | fn | `UnifiedSupplierDetailModal.tsx:46` |
| `(default)` | default | `page.tsx:13` |
| `(default)` | default | `page.tsx:17` |
| `runtime` | const | `route.ts:9` |
| `runtime` | const | `route.ts:12` |
| `runtime` | const | `route.ts:13` |
| `POST` | fn | `route.ts:18` |
| `runtime` | const | `route.ts:19` |
| `GET` | fn | `route.ts:23` |
| `POST` | fn | `route.ts:28` |
| `GET` | fn | `route.ts:29` |
| `formatSpendPct` | fn | `spend-axis.ts:16` |
| `SpendAxis` | type | `spend-axis.ts:23` |
| `buildSpendAxis` | fn | `spend-axis.ts:36` |
| `formatSpendMoney` | fn | `spend-axis.ts:78` |
| `spendMoneyAndShare` | fn | `spend-axis.ts:85` |
| `SupplierRankingRow` | type | `spend-overview-types.ts:4` |
| `SpendDetail` | type | `spend-overview-types.ts:20` |
| `SupplierEvolution` | type | `spend-overview-types.ts:77` |
| `ClassificationRankingRow` | type | `supplier-classification-types.ts:9` |
| `SynthesisKey` | type | `supplier-classification-types.ts:25` |
| `ClassificationPrevSummary` | type | `supplier-classification-types.ts:37` |
| `ClassificationPageData` | type | `supplier-classification-types.ts:44` |
| `SynthesisMeta` | type | `supplier-classification.ts:17` |
| `SYNTHESIS_ORDER` | const | `supplier-classification.ts:31` |
| `SYNTHESIS_META` | const | `supplier-classification.ts:38` |
| `computeSynthesis` | fn | `supplier-classification.ts:94` |
| `SupplierDirectory` | type | `supplier-detail.ts:19` |
| `SupplierDetailInput` | type | `supplier-detail.ts:25` |
| `SupplierDetail` | type | `supplier-detail.ts:33` |
| `buildSupplierDetail` | fn | `supplier-detail.ts:56` |

**Total distinct exports across this doc's files: 56.**
