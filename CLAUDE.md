# Project: Procurement Analytics Web App

A full-stack Next.js web app for presenting mining procurement analytics from synthetic 
data. Multi-user with auth, single organization, fixed analyses (no parameter tweaking).

## Current Work

> **Current state of record = `git log`.** This file holds DURABLE architecture +
> decisions, NOT commit-by-commit progress. For "where are we", read the commits —
> do not trust this section for the latest state. **HEAD as of last doc update:
> the Action Priorities dashboard-rebuild commit (2026-07-09) — run `git log` for
> the hash.**

> ⚠️ **`tier` (declared Core/Established/Standard) was REMOVED ENTIRELY in
> `158849b`** — data, Prisma columns (`Supplier.tier` + `SupplierMetric.tier`,
> migration `remove_tier`), compute (all tier emitters + the whole
> `tier_reclassification` recommendation category), every API/UI surface, the
> report tier-filter dimension, and methodology §4.4. No `TIER_MAP`, no tier
> chips/columns/headers. Classifications were byte-identical (tier was never an
> analysis input); the Action Dashboard went 22→16 recs across 4 categories.
> **Historical mentions of tier below are batch history — tier no longer exists.**
> Also in `158849b`: the two Classification-views tabs were relabeled
> **"Kraljic matrix" → "Exposure positioning"** and **"Performance vs spend" →
> "Performance positioning"** (PillTabs code keys `kraljic`/`performance`
> unchanged).

4 analytical pages live (Kraljic + Performance-vs-Spend merged into one Supplier
Classification page; ABC merged into Spend Overview): Spend Overview, Supplier
Classification, Process Health Monitoring, Action Priorities
(+ Reports, Methodology). `/` → `/spend-overview`; `/abc-analysis` →
`/spend-overview` (both redirects). The Action Priorities page (`/action-dashboard`
URL unchanged) is now a 3-group instrument-panel dashboard grid — see the top
session block.

### REPORTS: FULL 3-FAMILY ANOMALY HUB (2026-07-10, latest) — PROCESS + TEMPORAL ADDED

**Reports now render ALL THREE anomaly families** (process + classification +
temporal), finishing the deferred follow-up from the reports-alignment batch
(`d74d831`, which shipped classification-only). The process + temporal data is
**assembled SERVER-SIDE into `ReportAnalyses`** so every render path — editor,
persisted `/reports/[id]`, ephemeral `/reports/preview`, AND **static PDF export** —
has it at render time. NO client fetch (that was the deferral reason: PDF =
`html2canvas` on the rendered DOM, so async-fetched data wouldn't be captured).

- **⚠️ `computeCycleBreakdown` EXTRACTED to `lib/cycle-breakdown.ts`** (verbatim from
  the `/api/cycle-time/breakdown` route → the route is now a thin auth+validate
  wrapper). One source of truth for the breakdown. **Regression-sensitive** — Process
  Health, the live hub, AND the modal's Process tab all consume that route;
  **verified UNCHANGED** (Process Health 11/2/35 + filter sync; hub 46 flagged/3
  families; modal Process tab). Optional `preloaded` ABC/perf param lets report
  paths skip a redundant `getRangeAnalyses`.
- **`lib/report-analyses.ts` `assembleReportRangeAnalyses`** = `getRangeAnalyses` +
  `computeCycleBreakdown` + `loadTemporalMatrix`. Returns `RangeAnalyses & {breakdown,
  temporal}` (non-null fields preserved for `generateExecutiveSummary`; structurally
  assignable to the nullable `ReportAnalyses`).
- **New endpoint `/api/reports/analyses`** → the assembler. **The editor's fetch was
  repointed** from `/api/analyses/compute-range` to it (same `{startDate,endDate}`
  body). ⚠️ **The dashboard's `compute-range` is UNTOUCHED** — non-report pages don't
  over-compute the breakdown/temporal. Ephemeral route uses the assembler; the
  persisted page adds the breakdown INLINE (reusing its Mode-A abc/perf via
  `preloaded`, keeping its fast per-period reads) and OMITS temporal.
- **⚠️ TEMPORAL IS RANGE-ONLY in reports** (gated on `config.period.mode === "range"`)
  — mirrors the live hub (single-year → inert). So persisted single-year reports show
  process + classification; ephemeral RANGE reports show all three.
- **`ReportAnalyses` extended** with `breakdown?` + `temporal?`. **`ReportDocument`
  computes all 3 families SYNCHRONOUSLY from props** (reuses `deriveCycleFlags` +
  `buildAnomalyCrossref`, `buildClassificationAnomalies`, `buildTemporalAnomalies` —
  NO reimplementation) and renders three summary sub-blocks; the old "deferred" inline
  note is GONE.
- **Header-date hydration fix** (pre-existing, folded in): the persisted (SSR) report
  header used `new Date(meta.generatedAt).toLocaleString()` → locale/zone mismatch
  server vs client. Now a module-level fixed `Intl.DateTimeFormat("en-US", {dateStyle,
  timeStyle, timeZone:"Asia/Jakarta"})` → deterministic; hydration warning gone.
- **⚠️ VERIFIED numbers MATCH the live hub** (range report): process **36 / 16 important
  / $491.8M** (Outlier 11 · Inconsistent 2 · Stage-dom 35); classification **11/55**
  (gaps 96/94); temporal **18/48** (Spend 10 · Quadrant 7 · Score 3, 2026 excluded).
  Persisted 2024 report: process 27 + classification, temporal omitted. **PDF: all 3
  families inside captured `.pdf-page-break` sections.** tsc/ESLint clean; no Python
  change, no migration; export structure intact.

### SUPPLIER SELECTION VIEW (2026-07-10) — BEST-SUPPLIER-PER-CATEGORY ENGINE

**New page `/supplier-selection` (nav: after Action Priorities) — the
decision-support half of the cross-page vision (the anomaly hub was the diagnostic
half).** Per procurement CATEGORY, ranks suppliers by a transparent weighted blend
of THREE EXISTING signals and surfaces a recommended pick with reasoning. NO new
fundamental scoring, NO Python/compute change, NO new endpoint (reuses
compute-range). 5th analytical page.

- **`lib/supplier-selection.ts` (NEW, pure):** `fit = 0.50·Performance +
  0.30·Safety + 0.20·PriceValue` (all 0–100). `SELECTION_WEIGHTS = {perf:0.50,
  safety:0.30, price:0.20}` — NAMED constant, tunable. **Performance** =
  `perf.performance_score` (composite); **Safety** = `100 − Kraljic
  supply_risk_score`; **PriceValue** = `100 − cost_premium×4` (the 0–25 Kraljic
  cost-premium term). `buildSupplierSelection` ranks per category (fit desc),
  flags the top pick, derives a plain "why" from the component pattern, sets
  `soleSource` (1 supplier) / `thinData` (≤2) edge flags; categories sorted
  most-spend-first.
- **⚠️ PRICEVALUE IS AN OVERPRICING PENALTY, NOT A CHEAPNESS REWARD.** The source
  `cost_premium` is `clip(premium×62.5, 0, 25)` — below-market clips to 0, so
  at-market, below-market, AND un-benchmarked suppliers ALL score PriceValue 100;
  only measured above-benchmark pricing is docked. Live: 31/55 suppliers at
  premium 0, 24/55 with a measured premium. **Surfaced honestly in the UI** — Price
  bars labelled "Price vs. benchmark" + a page-level caveat box ("reflects not
  overpaying… not a 'cheapest' ranking"). No-benchmark fallback = PriceValue 100.
  **⚠️ FUTURE REFINEMENT (Path B, deliberately NOT this batch):** a SIGNED
  price-from-Purchase signal (per-supplier per-item unit price vs the item
  spend-weighted benchmark, keeping the below-market sign) would REWARD cheapness
  and map no-benchmark → neutral 50 — needs a new TS route querying Purchase
  (replicating `_cost_premium_points`); no Python change. Noted as a follow-up.
- **`components/SupplierSelection/SupplierSelectionClient.tsx` (NEW):** client
  fetches span-scoped `perf` + `kraljic` (+ `cycle_time` for the modal) via
  `/api/analyses/compute-range`, runs the pure blend, renders per-category cards —
  ranked rows with **★ Recommended** (amber ring), 3-component bars (Perf green
  `--zone-stars` / Safety blue `--quadrant-routine` / Price amber `--warning`), fit
  score, the "why", and meta chips (ABC / Kraljic / zone / spend / country). Rows →
  **REUSE `UnifiedSupplierDetailModal`** (perf/kraljic/cycleTime/dates all in hand).
  Keyed on the span so a period change remounts (avoids set-state-in-effect).
- **`page.tsx` (NEW, server):** resolves the span (BOTH modes), loads the GLOBAL
  catalog maps `getSupplierCategoryMap` + `getSupplierDirectory` (category + country
  — the analysis rows don't carry these), passes to the client. **Span-scoped like
  the other analyses** (single-year + range both via compute-range).
- **⚠️ VERIFIED (Range 2024–2026).** Picks sensible: Heavy Equipment OEM ★
  Kobexindo fit 95.5 (Perf 91/Safety 100/Price 100); Mining Contractor ★ Madhani
  (C-tier hidden gem); Cipta Kridatama correctly docked to 80.5 (Price 60, +9.9%
  premium → "prices well above the category benchmark"). fit math verified; "why"
  matches components; thin-data note (Conveyor & Belt 2 suppliers). Single-year 2026
  recomputes (United Tractors ★ 98.6). Rows→modal (Classification tab). Dark-mode
  token-safe. **No regressions** (Process Health, anomaly hub, modal intact after
  the shared `Sidebar.tsx` nav edit). tsc/ESLint clean; Python untouched.

### CROSS-PAGE ANOMALIES, BATCH 3 (2026-07-10) — TEMPORAL FAMILY → 3-FAMILY HUB COMPLETE

**The Cross-Analysis Anomaly Hub is now COMPLETE with 3 families: process (Batch 1)
· classification (Batch 2) · changed-over-time (Batch 3, NEW).** The temporal
family compares each supplier's LATEST vs PRIOR period. NO Python change, NO new
endpoint, NO migration/recompute — reads the trustworthy per-period AnalysisResults
(Purchase-derived; the stored-SupplierMetric lag does NOT touch this — see the prior
investigation). Both AP modes; dark-mode/token-safe.

- **New pure lib `lib/temporal-anomalies.ts`** (`buildTemporalMatrix` +
  `buildTemporalAnomalies`) + server loader **`lib/temporal-load.ts`**
  (`loadTemporalMatrix`, cached `getAnalysisResult` reads). Three detectors, latest
  vs prior: **spend FOLD ≥ 2.5×** (`SPEND_FOLD_CUTOFF`; ratio, NOT raw % — drops cap
  at −100% while spikes reach +1600%) with a **$100K small-base guard**
  (`SPEND_SMALL_BASE_MIN`); **Kraljic quadrant jump** (any change, ranked diagonal >
  adjacent via axes-flipped); **score swing ≥ 18 pts** (`SCORE_SWING_CUTOFF`). All
  NAMED CONSTANTS.
- **⚠️ PARTIAL-YEAR GUARD (`PARTIAL_YEAR_SPEND_FRACTION = 0.5`).** The naive latest
  pair = 2026 vs 2025 is DEGENERATE — **2026 is a partial year (~$30M vs 2025's
  ~$284M)** so ~85% of suppliers show a volume-artifact drop. The guard skips a
  latest year whose total spend < 50% of the prior's → compares **2025 vs 2024**
  (two comparable years); the block live-labels "(2026 excluded — partial year)".
- **⚠️ CALIBRATED against live data.** On 2024→2025: each detector selective (spend
  ~21%, quadrant 15%, score ~6% at ≥18); FAMILY union **18/48 (38%)** — higher than
  classification's 20% because it's 3 DISTINCT sharp signals on a dynamic year-pair,
  every one a real move (verified: +801%, −68%, Leverage→Bottleneck diagonal). Was
  46% at score≥15; tightened to **≥18** to trim the least-dramatic swings → 38%.
  Ranked by significance (quadrant distance dominates, then spend magnitude, then
  score).
- **`buildAnomalyHub` now folds in the temporal family** and generalizes the compound
  system: `compoundIds: Set` → **`familiesBySupplier: Map<id, Set<family>>`** so the
  "⧉ also X" badge spans all 3 families. Batch 1 (`cycle-flags`) + Batch 2
  (`buildClassificationAnomalies`) logic UNTOUCHED.
- **Cyan `TemporalBlock`** (`--temporal` token, light+dark) below the violet
  Classification block: synthesis + a significance-ranked list with change chips
  (quadrant `→`, spend Δ%, score Δpts) + position chips. Rows → unified modal
  **Classification tab** (where the evolution sparklines live). Plumbing: `page.tsx`
  server-loads the matrix (mode-independent) + passes `temporal` + `isRangeMode`;
  `RangeCompute` forwards them (range mode → `isRangeMode`).
- **⚠️ Single-year mode: the temporal block is INERT** — shows "Select Range to see
  year-over-year changes"; the hub synthesis omits the temporal clause; process +
  classification render normally. **Graceful:** <2 periods → "needs ≥2 periods";
  zero temporal → "no sharp changes".
- **⚠️ VERIFIED numbers.** RANGE hub: **46 distinct = 36 process + 11 classification +
  18 temporal, 20 compound**; temporal **18/48 (38%)**, 2024→2025, by-signal
  Spend/Quadrant/Score. Process Health UNCHANGED (11/2/35). $100K guard confirmed
  (Total Energies 4.2× fold / $68.5K → NOT flagged). Dark cyan `#22d3ee`. tsc/ESLint
  clean; Python untouched.

### REPORTS ALIGNED (2026-07-10) — ACTION PRIORITIES STRUCTURE + CLASSIFICATION ANOMALY SUMMARY

**The Reports feature was brought in line with the current app.** Presentation/copy
only — NO `scores.py`/compute change, export path untouched, both render paths
(persisted `/reports/[id]` + ephemeral `/reports/preview`) work.

- **⚠️ "Impact N" REMOVED; recs regrouped by the 3 diagnostic analyses.**
  `ReportDocument` no longer renders the flat impact-ranked list with an "Impact N"
  badge. Recs are now grouped by `ACTION_GROUPS` (From your Spend / Supplier /
  Process analysis — imported from `lib/action-priorities`), each item tagged with
  its **category chip** (one of the current 8) + a `CATEGORY_COLOR_VAR` token
  border; priority is conveyed by ORDER, not a number. The stale local
  `ACTION_COLORS` hex map (only the old 4 actions) was DELETED.
- **Classification anomaly summary ADDED (contained, no new fetch).** A
  "Cross-analysis anomalies — lens disagreement" sub-block in the Recommended
  Priorities section, computed via the shared `buildClassificationAnomalies`
  (Batch 2) from data the report ALREADY has (`performance_spend` + `kraljic` +
  `abc` — all in `ReportAnalyses`). Gated on `!brief`. Verified byte-consistent with
  the live hub (Range 11/55, gaps 96/94/93). Same cutoff (80).
- **⚠️ DEFERRED (noted follow-up): the process-cycle anomaly half** (outlier /
  inconsistent / stage-dominated) is NOT in reports — it needs the per-PO
  `/api/cycle-time/breakdown` roster (per-supplier IQR + stage anomalies), which
  `ReportAnalyses` doesn't carry. Plumbing a live fetch into the shared
  server/client/PDF-export component was deliberately deferred (risky
  unsupervised). The report renders an **inline note** pointing to the live Action
  Priorities hub for that family. **To finish later:** plumb the breakdown roster
  into the report data path (or precompute the 3 process flags server-side into an
  analysis the report reads), then reuse `deriveCycleFlags` + `buildAnomalyCrossref`
  for the process block.
- **Prose reframed in all 3 tones** (`lib/report-templates.ts`):
  `recommendedPriorities` (executive/operational/analytical) + the operational
  `methodology` line dropped "ranked by impact score" / "score N leads the list" →
  "organised by analysis (Spend / Suppliers / Process)". ⚠️ **Reports never encoded
  the old scoring weights** (templates say "CIPS-aligned performance score"
  generically), so NO scoring-model copy change was needed in reports — the
  methodology-page fix covered that surface.
- Dark-mode safe (category chips + group titles are theme tokens, no hex).
  tsc/ESLint clean.

### DOC FIX (2026-07-10) — METHODOLOGY PAGE ALIGNED TO CURRENT MODEL

**The in-app Methodology page (`app/(dashboard)/methodology/page.tsx`) was the LAST
stale scoring surface — now corrected.** It described the pre-`aca864c` model
(Service dimension, weights 25/25/20/15/15, `risk = 100 − (0.4·country +
0.3·complaints + 0.3·single_source)`), which contradicted the live dashboard AND
`methodology_defense_doc.md`. Now consistent with both (`python/scores.py` = source
of truth): composite **0.30·Q + 0.30·D + 0.22·P + 0.18·R** (four dims), **Service
removed** (survey-based RFx/response-time; 15% redistributed proportionally),
**Risk `100 − (0.6·country_distance + 0.4·roster_concentration)`** structural-only,
**Quality per-PO** (defect+complaint counts), and the **two-risk-scores distinction**
(composite Risk higher=safer vs Kraljic supply-risk higher=riskier, shared
roster-concentration signal). Also fixed: §8 inverted "annual aggregates / not
per-transaction" claim → per-PO; §2 dropped the stale single-source-flags mention
(scores now computed at import via `scores.py`); §3.2 supply_concentration "within
the period" → "across the full roster"; §8 dropped leftover "k = 4" (no clustering
analysis exists). §6 light-touched: "Action Dashboard" → **Action Priorities** with
its current **8 categories** (Concentration · Critical Spend · Tail Spend · Critical
Issues Engagement · Hidden Gems Promotion · Bottleneck Risk Mitigation · Process
Improvement · Slowest Stage); §6 impact-formula detail left for a future pass. ⚠️
**Presentation/copy ONLY — no `scores.py`/compute change.** §1/3.1/3.4/5/7/9 left
as-is (already current). tsc/ESLint clean; renders correctly (formula blocks +
dark-mode verified).

### MOST RECENT SESSION (2026-07-10, later) — CROSS-PAGE ANOMALIES, BATCH 2: "CROSS-ANALYSIS ANOMALY HUB" — read this FIRST

**Batch 2 shipped: Batch 1's standalone process-anomaly section was RESTRUCTURED
into a unified "Cross-Analysis Anomaly Hub" holding TWO anomaly families, and a
NEW second family was added — cross-lens classification disagreement.** One amber
section: hub header + hub-level synthesis + Block 1 (process) + Block 2
(classification). Pure compute added to `lib/anomaly-crossref.ts`; NO Python, NO
new endpoint, NO migration, NO recompute. Both AP modes; dark-mode/token-safe.

- **⚠️ `lib/cycle-flags.ts` + Process Health UNTOUCHED** (verified still 11/2/35 on
  the Range). Batch 1's `buildAnomalyCrossref` is UNCHANGED and reused inside the
  new `buildAnomalyHub`. `AnomalyExposureSection` → `CrossAnalysisAnomalyHub`.
- **Block 1 — Process anomalies** = Batch 1's content verbatim (cycle flags ×
  ABC/Kraljic/zone, severity-inverting synthesis, Exposure `$` stat tile, flagged
  list), now a sub-block. Rows → unified modal **Process** tab.
- **Block 2 — Classification anomalies (NEW): cross-lens DISAGREEMENT ranking.**
  For each roster supplier, percentile-rank three lenses — **S = spend**
  (`perf.total_spend_usd`), **P = performance** (`perf.performance_score`), **R =
  supply-risk** (⚠️ numeric `kraljic.quadrant_assignments[].supply_risk_score` — the
  `kraljic` prop AP already passes; `perf` only carries the categorical quadrant).
  `disagreement = max(S,P,R) − min(S,P,R)`; percentiles are **integer-rounded FIRST**
  so the bars reconcile with the displayed spread exactly. **Cutoff =
  `CLASSIFICATION_DISAGREEMENT_CUTOFF = 80`** (a named const in the lib, referenced
  by the display copy so they stay in sync). Ranked by spread desc; each row shows
  rank · name · spread · **three-lens mini-bars** (S blue `--quadrant-routine` / P
  green `--zone-stars` / R red `--quadrant-strategic`, distinct hues so the
  contradiction is visible) · a **computed verdict** ("Top performance, bottom
  spend" etc., from the max/min axes) · position chips. Rows → unified modal
  **Classification** tab.
- **⚠️ Cutoff CALIBRATED to 80 (was 50).** ≥50 flagged ~60% of the roster (33/55
  Range, 13/20 2026) — not an "anomaly". The live spread distribution has a natural
  break at **87→80→79**, so 80 cuts just above the dense 78-79 tail → flags the
  genuine extremes only (one lens ~top-decile, another ~bottom-decile): **11/55
  Range (20%), 3/20 2026 (15%)**. The striking top is unchanged (Total Energies 96,
  Lintas Marga 94, Kobexindo 93, Madhani 91).
- **Hub-level synthesis** ties both families: "N suppliers show a cross-analysis
  anomaly — M process, K classification, J both. X on important relationships."
  **Compound badge** (`⧉ also process` / `⧉ also classification`) marks suppliers in
  BOTH families — the cross-supplier overlap surfaced without a merged list. Violet
  accent (`--zone-hidden-gems`) for the classification family vs amber for the hub.
- **Drill routing:** hub process rows → Process tab, hub classification rows →
  Classification tab (reuses Batch 1's `initialTab` prop; band rows still →
  Classification, unchanged).
- **⚠️ VERIFIED numbers (cutoff 80).** RANGE: **41 flagged = 36 process + 11
  classification − 6 both**; 17 important. 2026: **11 = 10 + 3 − 2**; 5 important.
  Both reconcile. Disagreement math spot-checked (Total Energies S2/P4/R98 → spread
  96 "high supply-risk, bottom spend"; Kobexindo S85/P98/R5 → 93 "top performance,
  low supply-risk"; bars match the spread). Dark-mode tokens resolve (amber
  `#fbbf24`, violet `#a78bfa`, bars `#60a5fa`/`#34d399`/`#f87171`). tsc/ESLint clean.

### SESSION (2026-07-10) — CROSS-PAGE ANOMALIES, BATCH 1: "ANOMALY EXPOSURE"

**Batch 1 of the cross-page-anomaly project shipped: a new AMBER "Anomaly
exposure" section on Action Priorities that cross-references the THREE EXISTING
Process Health cycle-time anomaly flags against each flagged supplier's ABC /
Kraljic / performance-zone position.** The first "hub" piece — it spans analyses,
so it renders as a dedicated 4th section BELOW the 3 `ACTION_GROUPS` bands (not
inside any one band). Presentation + a pure join only; NO compute change, NO new
endpoint, NO migration, NO range-cache clear. Both AP modes; dark-mode/token-safe.

- **Shared flag helper (`lib/cycle-flags.ts`, NEW) — the regression-sensitive
  extraction.** The ~15-line flag derivation was lifted VERBATIM out of
  `CycleTimeClient.tsx` into `deriveCycleFlags({roster, anomalies, stageAnomalies})
  → {flagsBySupplier, flagCounts, flagPoCounts, iqrCutoff}`. Same
  `IQR > 1.5×median(roster IQRs)` rule, same outlier-set + stage-dom-set
  membership. **Imported by BOTH `CycleTimeClient` AND `ActionDashboardView`** so
  the flags are guaranteed identical across the two pages. ⚠️ **Process Health is a
  regression surface** — verified byte-identical via independent recompute (Range:
  outlier 11 suppliers / 15 POs, inconsistent 2, stage-dom 35 / 95 POs; roster
  chips + filter sync unchanged). Do NOT re-inline this logic.
- **Cross-reference (`lib/anomaly-crossref.ts`, NEW, pure):**
  `buildAnomalyCrossref({flagsBySupplier, perfSuppliers, roster})` joins each
  flagged supplier's `{flags}` with `{abc_class}` (from the breakdown roster) +
  `{total_spend_usd, kraljic_quadrant, zone}` (from `performance_spend`).
  **`important = abc_class==='A' OR kraljic_quadrant==='Strategic'`.** Rolls up
  `flaggedCount / importantCount / importantSpend / flagMix`, rows sorted
  IMPORTANT-first then spend-desc.
- **Plumbing = ONE breakdown fetch, no new endpoint.** `ActionDashboardView`'s new
  `AnomalyExposureSection` self-fetches `/api/cycle-time/breakdown?start&end`
  (span-scoped, keyed on the dates AP already passes in BOTH modes — the exact
  route + lazy pattern Process Health / the unified modal use). `has_outlier` comes
  from the already-loaded `cycleTime.anomalies` (needs no breakdown); ABC comes
  FREE from `breakdown.bySupplier[].abc_class`; spend/Kraljic/zone from the `perf`
  prop AP already loads.
- **The section (amber accent = `--warning`):** band header "Anomaly exposure —
  process anomalies, weighted by who they hit" + "N flagged"; a
  severity-INVERTING synthesis line (≥1 important → "concentrated on your most
  important relationships"; 0 important → "lower urgency"); a `$`-exposure StatTile
  (importantSpend + coverage + flag-mix line); a wide list tile (flagged suppliers,
  important-first, top-4 + "+N more") with FLAG chips (Outlier=`--warning`,
  Inconsistent=`--primary`, Stage-dom=`--destructive` — mirrors PH's `FLAG_META`)
  and bordered POSITION chips (Class A / Kraljic / zone — A-tier + Strategic
  highlighted amber). Rows call `onSupplier(id)` → the **unified modal**.
- **Row → unified modal opens on the PROCESS tab.** Added an optional `initialTab?:
  Tab` prop to `UnifiedSupplierDetailModal` (default `"classification"` → all
  existing callers unchanged); the anomaly rows pass `"process"`, and
  `processOpened` is seeded true so the lazy Process fetch fires. Band rows +
  peer-links still open on Classification.
- **⚠️ VERIFIED numbers (2026-07-10).** RANGE (2024–2026): **36 flagged / 16
  important / $491.8M** exposure / flag-mix outlier 11 · inconsistent 2 · stage-dom
  35. SINGLE-YEAR 2026: **10 / 5 / $23.2M** / mix **0** · 7 · 4 (exercises the
  Outlier-0 case). Both match an independent recompute EXACTLY. tsc + ESLint clean;
  no console/server errors on a cold build. **Degraded (breakdown-fetch-fail →
  outlier-only + note) + zero-flagged (neutral state) branches are
  written-and-type-checked but NOT runtime-forced** (no failing/empty span was
  available to trigger them) — accepted as defensive for Batch 1.

### SESSION (2026-07-09) — ACTION PRIORITIES → 3-GROUP DASHBOARD GRID

**Action Priorities restructured into 3 analysis-grouped sections + 3 new
categories, rendered as a compact instrument-panel dashboard grid.** ONE commit
covering BOTH the compute/data changes AND the tiled-view rebuild (an earlier
stacked-card version of the grouping was rejected and superseded by the grid).
The existing 4 categories' compute + impact formulas + `priority_rank` are
UNCHANGED; the new work is additive + a presentation rebuild.

- **3 groups (`ACTION_GROUPS` in `lib/action-priorities.ts`):** Spend → Suppliers
  → Process, one per diagnostic analysis. Spend = Concentration · Critical Spend ·
  Tail Spend; Suppliers = Engage · Promote · Mitigate (three equal list tiles);
  Process = Improve · Slowest Stage.
- **3 NEW categories (`recommendations_analysis`, `python/compute_analyses.py`):**
  - `critical_spend` / **steward** — the A-tier "vital few" (REUSES `abc_analysis`
    80/95 tiers — no re-implement), ranked by spend; drills to the supplier.
  - `tail_spend` / **consolidate** — ONE portfolio-summary card: sub-1% suppliers
    (`TAIL_SPEND_SHARE = 0.01`) — count + combined spend share + roster share.
  - `slow_stage` / **streamline** — internal P2P stages above the 8-day flag
    (PO→Delivery excluded), ranked by avg days; carries `avg_days` +
    `cycle_share_pct`.
- **De-dups (the only two existing categories that changed):** Concentration is now
  **CATEGORY-LEVEL ONLY** (`CATEGORY_CONC_THRESHOLD` 0.30; the old supplier-level
  >10% branch + `SUPPLIER_CONC_THRESHOLD` are GONE → supplier criticality lives in
  Critical Spend). `process_improvement` (Improve) is now **COMPLIANCE-ONLY** (the
  worst-quadrant 3-way-match item; the per-stage timing items moved to Slowest
  Stage). No item appears under two Process-group categories.
- **Narrative (`summary_stats.narrative`) gained** `a_items_count`,
  `slowest_stage_name`, `slowest_stage_avg_days` (all optional → old cached rows
  degrade). `attention` (the "N of top-10" stat) is now **engage + mitigate only**
  (the removed supplier-concentration term is gone; Critical Spend is deliberately
  excluded so it doesn't pull in every top spender). `by_category` has 8 keys.
- **Tokens (`app/globals.css`, light+dark):** `--priority-steward` (cyan),
  `--priority-consolidate` (teal), `--priority-slowstage` (indigo — NOT improve's
  blue; they share the Process group). Types: `RecommendationCategory`/`Action` +3
  each; new optional `Recommendation` fields (`abc_class` / `avg_days` /
  `cycle_share_pct` / `tail_*`). Reports render the new cats **generically**
  (`ALL_REC_CATEGORIES` + `REC_CATEGORY_LABELS` + `ACTION_VERB` extended). ⚠️
  reports still show "Impact N" — known follow-up, no report redesign this batch.
- **View = instrument-panel dashboard grid** (`components/ActionDashboardView.tsx`,
  full rewrite; **`ActionRecommendationCard.tsx` DELETED**). 3 bands (accent header
  + tagline + "N flagged" + one computed finding) over a 3-col tile grid. Tile
  kinds (lightweight inline SVG/CSS, tokens only): **donut** (Concentration share),
  **list** (Critical Spend / Engage / Promote / Mitigate — top-4 + "+N more" inline
  expand, drill-through rows), **stat** (Tail spend; Match compliance = the
  worst-quadrant failure %, which IS `process_improvement.impact_score`), **bar**
  (P2P stages — slowest accented, others dimmed, an 8-day flag line). Advice is
  stated **ONCE per tile** (small-caps action verb + the existing `CATEGORY_NUDGE`,
  de-"Suggested:"d) — NOT per row. Fits ~1 screen.
- **⚠️ The P2P bar tile reads the CACHED `cycle_time` analysis** (all three
  internal `stage_breakdown.*.mean`) — `recommendations` alone only carries FLAGGED
  stages. Plumbed with NO compute change: the page loads
  `getAnalysisResult(period,"cycle_time")` in cached mode and `RangeCompute` passes
  `state.data.cycle_time` in range mode → `ActionDashboardView` gets an optional
  `cycleTime` prop.
- **Drill-through preserved** (supplier_id → `/supplier-classification?supplier=`;
  concentration-category → `/spend-overview`). Graceful degradation: no stage
  clears 8d → bars all "balanced" + no streamline advice; empty category → neutral
  tile.
- **Compute + `AnalysisResult` SHAPE unchanged by the view rebuild.** When the 3
  categories were ADDED, the cache was recomputed once via the safe recipe
  (per-period `--period-id` ×3 + clear the `periodId IS NULL` range rows); source
  data untouched. ⚠️ **VERIFIED numbers:** 2024 slow_stage = Invoice→Payment ~17.9d
  (range ~12.2d); **2025 & 2026 have NO slow_stage** (no internal stage clears 8d →
  Process band shows "balanced"). Critical Spend counts = A-tier (2024/25/26 =
  8/10/4). Both compute modes render; dark-mode token-safe; no hardcoded hex.

**Follow-up (later 2026-07-09) — INSIGHT LAYER + IN-PLACE CENTERED SUPPLIER
MODAL.** Two presentation/interaction additions to Action Priorities; compute +
`AnalysisResult` shape unchanged.
- **Insight layer (light):** a computed synthesis headline below the intro (from
  `summary_stats.narrative` — `top10_in_attention` + top-category share) plus one
  interpretive takeaway line per band (Spend concentration / supplier attention /
  slowest stage), replacing the bare per-band finding. Tiles untouched, page not
  re-bloated.
- **In-place supplier detail — the `?supplier=` REDIRECT IS GONE.** Clicking a
  supplier row (Critical Spend / Engage / Promote / Mitigate) now opens
  `SupplierClassificationDetailPanel` as a **centered modal** over the dashboard
  (URL stays `/action-dashboard`; Esc / close / click-outside returns; the user
  stays on Action Priorities). The panel is **REUSED AS-IS** — it's self-contained
  (fetches its own spend-detail + evolution) and already renders as a centered
  `Dialog`, so **no change to the shared Dialog primitive or the panel**. It only
  needs `perf` + `kraljic` + the period span, which `page.tsx` loads in cached mode
  (`getAnalysisResult` + `getDateRangeFromSelection`) and `RangeCompute` passes
  from `state.data` in range mode (no new fetch). *(A right-slide-over variant was
  explored first, then dropped for the centered default.)*
- The **concentration-category donut keeps its `/spend-overview` link** (a category
  has no supplier panel); Tail spend, the P2P bars, and the stat tiles stay
  non-clickable. Both modes render; single-year degradation preserved; dark-mode
  token-safe.

**Follow-up (later 2026-07-09) — UNIFIED SUPPLIER DETAIL MODAL (3 analysis tabs).**
The Action Priorities supplier click now opens ONE centered modal
(`components/UnifiedSupplierDetailModal.tsx`, NEW) with three top-level tabs —
**Classification / Spend / Process** — replacing the single Classification panel.
Presentation/interaction only; compute + the 3 source pages unchanged.
- **⚠️ BODY EXTRACTION — the reuse mechanism.** Each of the three page panels was
  split into its **shell** (Dialog + own fetch + identity header) and a
  **presentational body**, both exported from the SAME file:
  `SpendDetailBody` (`SpendDecompositionPanel.tsx`), `ClassificationDetailBody`
  (`SupplierClassificationDetailPanel.tsx`), `ProcessDetailBody`
  (`CycleTimeSupplierDetailPanel.tsx`). The bodies are presentational — they take
  the fetched data + loading/error as PROPS and own only their sub-tab state; the
  shells keep their fetch + header and render `Dialog(header + <XBody>)`. **The
  three own pages (Supplier Classification, Spend Overview, Process Health) render
  byte-identically** (the JSX moved into a child at the same position) — verified:
  each page's panel still opens with its own header + sub-tabs and NO top-level
  analysis tabs. Do NOT re-inline the bodies.
- **Shared/deduped fetch:** the modal fetches `spend-detail` + `evolution` ONCE
  (its own useEffects, keyed on supplier) and feeds BOTH the Classification and
  Spend bodies as props → opening Classification then Spend does **not** re-fetch
  (verified: spend-detail=1 / evolution=1). The header identity is sourced from
  `spend-detail.supplier` (same fields the Spend panel header uses).
- **Process = FULL FIDELITY, lazy.** The Process tab fetches
  `/api/cycle-time/breakdown` (span roster) + the per-supplier
  `cycle-time/supplier-detail` **only on first open** (verified: cycle-time fired
  0× until Process opened), then derives `iqrCutoff = 1.5·median(roster.iqr)`,
  `inconsistent`, `stageDominatedPoIds = Set(stageAnomalies.po_id)`, and
  `portfolio` (`{…cycleTime.distribution median/p25/p75, supplierMedians, iqrCutoff}`)
  — the SAME derivation `CycleTimeClient` + `CycleSupplierSection` do — so the tab
  shows the speed-rank gauge, portfolio deltas, inconsistency flag, and
  stage-dominated PO flags identically to the Process Health panel. `cycleTime` is
  already on Action Priorities (P2P tile) and is passed into the modal.
- **Wiring:** `ActionDashboardView` mounts `UnifiedSupplierDetailModal`
  (perf/kraljic/cycleTime/dates already available). Peer-supplier links inside the
  Classification body re-target the modal (resets to the Classification tab).
  Concentration-category donut keeps `/spend-overview`; other tiles non-clickable.
  Both AP modes; dark-mode safe; no compute change.

### MOST RECENT SESSION (2026-07-06, later) — FILTER-LIVE COMPOSITE

**The performance composite is now FILTER-LIVE** — recomputed from the POs in the
current time filter (single-year = that year's POs; range = all POs in the span)
instead of being read as a frozen per-period / latest-snapshot value. ONE engine;
the TS duplicate is deleted. Staged in 4 stages, **held for commit** (not yet in
`git log`). Touches `python/scores.py`, `python/compute_analyses.py`,
`app/api/suppliers/[id]/spend-detail/route.ts`; **deletes** `lib/score-methodology.ts`.

- **Engine (Stage 1):** `scores.build_window_metrics(metrics, purchases, roster)`
  aggregates delivery/process over ANY filtered PO set (period dimension
  collapsed) then `compute_scores` → the 6 scores. Shares the aggregation helper
  `_aggregate_purchase_group` with `build_period_metrics` (behavior-preserving).
  **Proven byte-identical** to the per-year computation for 2024/2025/2026
  (`test_scores.test_window_matches_period`). Camel/snake boundary =
  `scores.rename_purchase_columns` (DB Purchase camelCase → engine snake_case).
- **Compute swap (Stage 2):** `compute_analyses.main()` builds `_LIVE_COMPOSITE_MAP`
  once from the filtered POs (`build_live_composite_map`, joins `country` from the
  Supplier frame — SupplierMetric has none); the three `perf_of` fns
  (performance_spend zones, kraljic avg_performance, recommendations) read it
  instead of stored `SupplierMetric.compositeScore` (stored kept as fallback).
- **⚠️ ONLY 0.45 of the composite is filter-dependent:** delivery (0.25) + process
  (0.20) re-aggregate over the filtered POs; quality/service/risk (0.55) are
  per-supplier soft-survey constants. The composite responds to the filter, but
  ~55% is pinned.
- **VERIFIED numbers.** SINGLE-YEAR is **byte-identical to the prior stored**
  composite: 2024 **17/9/9/18** (med 74.18), 2025 **19/6/6/19** (79.24), 2026
  **6/4/4/6** (82.96) — 0 composite diffs. RANGE moved from the latest-snapshot
  **18/9/9/19** to the true span-aggregate **19/8/8/20** (perf_median **80.01 →
  77.47**; 49/55 composites changed). ⚠️ **Range is the DEFAULT landing**, so the
  default performance zones changed.
- **ABC + Kraljic QUADRANT ASSIGNMENT unchanged** everywhere (composite-independent
  — spend × supply-risk). Only composite-derived zones / avg_performance / recs
  move, and only in range/multi-year.
- **Panels unified (Stage 3):** `lib/score-methodology.ts` (the stale **pre-D9** TS
  range calculator — it still used `single_source_risk*100`) DELETED. The
  spend-detail range `performance.score` now reads the filter-live
  `performance_spend` analysis (same source as the zone chip + the Classification
  page) → the panel and the page AGREE (the pre-D9 divergence is resolved by
  elimination). `SpendDetail.subScores` + `storedSubScores` removed (never
  rendered — the Classification panel reads per-year evolution sub-scores instead).

**Also this session — `product_description` DROPPED, `unit` KEPT.** The ghost sweep
found `product_description` (Suppliers + SupplierMetrics sheets) unconsumed →
dropped from zod (`SuppliersRow`/`SupplierMetricsRow`), the route supplier mapping,
`scores.IDENTITY_COLS`, `lib/python.ts`, both sheets of
`data/raw/procurement_data_raw.xlsx`, and `Supplier.productDescription` (migration
`20260706120000_drop_product_description`, **held/unapplied** — DB still has the
column). ⚠️ **`unit` is KEPT** (Purchases sheet + `Purchase.unit` + spend-detail
plumbing) and `single_source_risk` is KEPT (feeds the AD bottleneck "Single-source"
string; no longer feeds any composite — D9 uses roster concentration). Sample file
now **Suppliers 4 / Purchases 21 / SupplierMetrics 9**; imports byte-identically
for the staying columns.

### MOST RECENT SESSION (2026-07-06) — read this FIRST

**BACKEND-SCORING REBUILD, Stages 1–3 — LIVE. Import now takes RAW data only; the
backend computes all 6 scores server-side.** Commits: `b34c40a` (Stage 1),
`1f507fa` (Stage 2), `af1152d` (Stage 3, live).
- **Architecture change (the big one):** the import route
  (`app/api/imports/upload/route.ts`) no longer reads pre-computed score columns
  from the xlsx. `SupplierMetricsRow` zod is now **raw-only**, one row per
  supplier: `supplier_id, supplier_name, country, category, product_description`
  (identity) + `defect_rate_pct, complaint_count_annual, rfx_response_rate_pct,
  avg_response_time_days, single_source_risk` (soft-survey). **NO `period`, NO 6
  score columns, NO operational aggregates** (all computed server-side). ⚠️
  `country` + `product_description` ARE required (the engine's
  `build_period_metrics` sources supplier identity from these rows); zod strips
  any extra columns. Flow: **parse+validate raw → `runImportCompute` (Python
  bridge, `lib/python.ts`, fail-before-write) → atomic `$transaction` write →
  `compute_analyses` per period → clear range cache.** Compute runs **before** the
  write (a Python failure → 500, no partial state). `sample-data` now serves
  `data/raw/procurement_data_raw.xlsx` (raw), not the enriched one.
- **`python/scores.py` is the single source of truth** for the 6 formulas (D9
  baked in): `norm_high/low`, `country_distance_score`, `concentration_0_100` +
  `_CONC_POINTS`, `roster_category_counts`, `build_period_metrics`,
  `compute_scores`. `scripts/transform_dataset.py` was refactored to import from
  it (behavior-preserving, byte-identical output — proven) and is now
  **offline-transformer-only** (it still writes the enriched xlsx for offline use;
  the app never reads that file anymore). Tests: `python/test_scores.py`,
  `python/test_import_compute.py` lock formula-exactness + the rebucket invariants.

> ✅ **RESOLVED — the D9-REVERT LANDMINE is DEAD (Stage 3).** The uploaded file no
> longer carries composites, so there is nothing to revert to — the route
> recomputes all scores from raw (D9 in `scores.py`) on **every** import. Verified
> live: **two consecutive imports produced byte-identical scores.** Re-importing is
> safe and deterministic. (Supersedes the 2026-07-04 landmine warning below.)

> ✅ **DONE — the deferred SupplierMetric invoice→payment rebucket landed.** The
> live import wrote **payment-year-bucketed** SupplierMetric rows: row-set is now
> **53 / 50 / 20** (was 54/50/16 invoice-bucketed; S054 2024→2026, S002/S003/S020
> gained 2026). D9 composites are regenerated from source (raw) — the two deferred
> items converged in this one live import, exactly as planned. (Supersedes the
> 2026-07-04 "DEFERRED" note below.)

⚠️ **VERIFIED CURRENT NUMBERS (post-Stage-3, computedAt 2026-07-06) — supersede any
older doc.** SupplierMetric **payment-bucketed 53/50/20**. Only performance zones
moved (they read the composite); everything spend/risk-based is unchanged.
- **2025:** zones still **19 / 6 / 6 / 19** but with 2 rebucket swaps (**S054
  Stars→Critical, S061 Critical→Stars**; perf_median 79.70→79.24). UNCHANGED:
  Kraljic **10/15/15/10**, ABC **10/9/31**, risk split 25/25, control **$42.47M**,
  313 POs, $283,596,813.69.
- **2024:** zones **17/9/9/18** (2 swaps S008 Stars→Critical, S005 Critical→Stars);
  Kraljic 12/14/15/12, ABC 8/10/35, control $83.82M — unchanged.
- **2026:** zones now **6 / 4 / 4 / 6** (row-set grew 16→20; 7 movers as the 4
  boundary suppliers gain a 2026 composite); Kraljic 5/5/5/5, ABC 4/3/13, control
  $7.45M — unchanged.
- Whole-portfolio SupplierMetric means: composite **77.40**, risk **68.42**.
- ⚠️ **`defense.md` zone numbers need a light update** (2025 zone swaps + 2026
  now 6/4/4/6). **Kraljic 10/15/15/10 is still current** (A1/B5, purchase/roster-
  based, unaffected by the rebucket).

**⚠️ PENDING — NEXT TASK: sample-data reconcile + update.** The sample file
(`data/raw/procurement_data_raw.xlsx`, served by `app/api/sample-data/route.ts`)
may NOT match the current **raw-only** import schema — it likely still carries a
`tier` column and stale per-supplier operational-aggregate columns
(`total_spend_usd`, `num_pos`, otd%, 3wm%, etc.) that the raw-only schema doesn't
expect. zod strips extras so an import still SUCCEEDS, but the sample should be
clean. Do a **read-only reconcile first**: compare what the raw file's
SupplierMetrics sheet actually contains vs the raw-only `SupplierMetricsRow`
schema (identity `supplier_id/supplier_name/country/category/product_description`
+ soft `defect_rate_pct/complaint_count_annual/rfx_response_rate_pct/
avg_response_time_days/single_source_risk` ONLY), report the exact mismatch, THEN
update the sample to match the CURRENT Stage-3 schema (drop period/scores/computed
aggregates; keep identity + soft). **Match the current schema, not any old column
list.** Suppliers + Purchases sheets are already raw and fine.

**Session state / restore nets (this session's scratch, gitignored — outside the
repo).** Pre-Stage-3 DB snapshot: `…/scratchpad/db_snapshot_prestage3_<ts>.sql`
(pg_dump, ~810KB — restore net if the payment-bucketed state ever needs reverting;
path also in `…/scratchpad/last_snapshot_path.txt`). Baseline score dump:
`…/scratchpad/baseline_supplier_scores.csv` (the 120-row invoice-bucketed
pre-rebuild scores the Stage-1/2 tests verify against, via `$BASELINE_CSV`).
`…/scratchpad/baseline_aggregates.json` = pre-rebuild 2024/25/26 aggregates.

**Non-issue seen this session (don't chase):** Spend Overview "won't open" was a
**stale/zombie dev server** on :3000 (404'd even `/api/auth/login`), NOT an
import/data bug — verified 200 + full render on a clean server. The import clears
the range cache (`AnalysisResult periodId IS NULL`), so the FIRST range-mode load
after ANY import recomputes Mode B (~2s) and self-caches — normal, non-fatal. Fix
= restart ONE clean dev server (kill any zombie squatting on :3000).

### SESSION (2026-07-04)

**Supplier Classification supply-risk fixes — A1 + B5 + D9 (`07c2e5c`), recomputed +
verified fresh DB.** Also an earlier frontend-only commit this session (`96b4b2f`:
E11 synthesis `<=` to match the Python zone convention, E10 self-omit guard on the
"All Strategic" line, F14 portfolio-size denominator = kraljic roster sum).
- **A1** — `compute_supply_risk` supply_concentration now counts the **FULL category
  roster** (all known suppliers, active or not — an inactive-but-qualified supplier is
  still an available alternative), NOT just the period-active set. Loaded once in
  `main()` via `load_roster_category_counts(conn)` (DB `Supplier` master table) into a
  module global `_ROSTER_CAT_COUNTS`; falls back to period-scoped size if unset.
  cost_premium + import_friction stay active-only (correct). Trace: S114 50→35,
  Local-Steel S104/S100/S101 22→5, **10 suppliers corrected in 2025**.
- **B5** — Kraljic risk-axis median split `>` → **`>=`** (discrete tie-heavy risk score;
  strict `>` dumped all tied-at-median suppliers into low-risk). Spend axis keeps `>`
  (continuous, no ties) — asymmetry intentional. 2025 risk split **24/26 → 25/25**.
- **D9** — composite `risk_score` concentration term: dropped `single_source_risk*100`,
  now the **same roster concentration** A1 uses, scaled ×2 onto the composite's 0-100
  axis (`concentration_0_100`, `_CONC_POINTS` in `transform_dataset.py`; single-source→100
  preserves the old endpoint). So composite + Kraljic share ONE concentration signal.

> ✅ **SUPERSEDED / RESOLVED by Stage 3 (2026-07-06) — see the top session block.**
> The D9-revert landmine is DEAD: the import now computes scores from raw (no scores
> in the uploaded file), and the DB is now payment-bucketed 53/50/20. The historical
> warning below is kept for context. ⚠️ **D9 IS IN THE DB BUT NOT IN THE COMMITTED
> XLSX (LANDMINE).** D9 was applied **in-place** to the DB's `SupplierMetric` rows
> (recomputed `riskScore` + `compositeScore` on the existing 120 rows via the
> transformer's exact D9 functions, keeping the other 4 sub-scores + the row set) AND
> to `transform_dataset.py` source — but **NOT baked into
> `data/raw/procurement_data.xlsx`** (deliberately restored, to avoid bundling the
> out-of-scope invoice→payment rebucketing). **CONSEQUENCE: a full re-import of the
> current committed xlsx would REVERT D9 in the DB.** Do **NOT** re-import the xlsx
> outside the planned rebucket+reimport batch.

> ✅ **SUPERSEDED / DONE by Stage 3 (2026-07-06).** The rebucket + D9-from-source
> convergence landed via the live raw import (row-set now 53/50/20). Historical note:
> **DEFERRED — SupplierMetric rebucket + reimport.** `transform_dataset.py` now holds
> the D9 edit as source-of-truth, but re-running the transformer ALSO rebuckets
> per-period `SupplierMetric` rows **invoice-year → payment-year** (a separate deferred
> fix; observed as row-set drift 54/50/16 → 53/50/20, S054 2024→2026, S002/S003/S020
> gain 2026). When that batch runs it will regenerate D9 composites from source AND fix
> the bucketing **together** — the intended convergence point. Until then the DB carries
> the correct D9 values via the in-place update.

**Recompute procedure (SAFE):** D9 in-place update (120 rows) → idempotent
`Purchase.periodId` re-tag by paymentDate (**0 rows**, already correct, 306/313/28) →
`compute_analyses.py --period-id` ×3 (6/6 each, computedAt **2026-07-04 20:26**) →
`DELETE FROM "AnalysisResult" WHERE "periodId" IS NULL` (30 range rows). NOT the
migrate-script. `.env` BOM → inject `DATABASE_URL` (`utf-8-sig`) for standalone Python.

⚠️ **VERIFIED CURRENT NUMBERS (2025) — supersede any older doc.** Kraljic
**10 / 15 / 15 / 10** (Strategic/Leverage/Bottleneck/Routine) — **was 8/17/16/9** before
A1/B5; risk split **25/25**; risk_median 24.71. Performance zones **Stars 19 / Critical 6
/ Hidden Gems 6 / Long Tail 19** (distribution UNCHANGED by D9 — 4 symmetric membership
swaps: S008 Critical→Stars, S031 LongTail→HiddenGems, S061 Stars→Critical, S070
HiddenGems→LongTail; perf_median 80.27→79.70). UNCHANGED: ABC 10/9/31, 313 POs,
$283,596,813.69, control exposure $42.47M. **Any doc still citing 8/17/16/9 (e.g.
`defense.md`) is KNOWN-STALE and needs updating.**

⚠️ **COMMIT-MESSAGE TOOLING NOTE.** In the Git Bash tool, write commit messages with a
**heredoc** (`git commit -F - <<'EOF' … EOF`) or a message file — **NOT** PowerShell
here-string syntax (`@'…'@`), which the POSIX shell passes literally and leaves a stray
`@` prefixing the subject line (has happened several times; had to amend).

### SESSION (2026-07-03)

**Insight-fragility audit — DONE (`47ffcd9` / `9c3df01` / `6fbdafc`).** 12 auto-generated
insight/narrative surfaces audited + fixed so every adjective/direction is data-driven
(guards / shape-detection / self-omit / drop) — see roadmap (a). Bundled the AD rec
reword (#6 "weakest match compliance") + AD stage-arrows "→"→"to", now LIVE.

**Recompute ran + verified (fresh DB).** `compute_analyses.py` edits (audit #6, AD stage
arrows "to") live (`46d6276`). SAFE procedure: idempotent `Purchase.periodId` re-tag
(already paymentDate-correct, distribution **306/313/28**) → `compute_analyses.py
--period-id` ×3 (computedAt 10:49) → `DELETE FROM "AnalysisResult" WHERE "periodId" IS
NULL`. ⚠️ Aggregates **byte-identical** (2025: 313 POs / $283,596,813.69 / 50 suppliers /
control $42.47M) — only rec strings changed. ⚠️ `.env` has a UTF-8 BOM → standalone
Python must read `DATABASE_URL` with `encoding="utf-8-sig"` (Node passes it in, so the
app path is unaffected).

**Process Health supplier-card overhaul (`267926e` + `44c904c`) — DISPLAY-ONLY, no
recompute.** The cycle-time drill-down (`CycleTimeSupplierDetailPanel`) was rebuilt:
- **PO block = ONE Table⇄Chart toggle** (shared `components/ViewToggle.tsx`, extracted
  from `SpendDecompositionPanel`; default **Table**). TABLE = the 5-milestone date table
  (PR·PO·Delivery·Invoice·Payment). CHART = the cycle-consistency line chart.
- **Consistency line chart:** cycle days per PO, x = **order sequence by payment date**
  (integer axis, not calendar). ⚠️ **WHOLE-LINE colour = the supplier's Inconsistent flag
  verdict** (black = flagged, blue = consistent). A prior **windowed-IQR segmenting was
  BROKEN + REMOVED** — it tested a 4-order-window IQR against a full-history-calibrated
  threshold (**scope mismatch**), so flagged suppliers whose spread came from gradual
  drift showed an all-blue line under their own flag. **Do NOT reintroduce
  windowed-vs-full-history.** Unified anomaly dot (red = Outlier and/or Stage-dom, blue =
  normal; hover reveals which); rich tooltip (PO id, order #, badges, cycle, slowest, 5
  dates); own-median ref line; <3-PO "not enough POs" degradation.
- **`FLAG_TOOLTIP`** (cycle-time-types) explains the 3 flags on roster pills / anomaly
  cards / a supplier-level "Flagged Inconsistent" note above the chart.
- **Cycle stats restyled to the Supplier-Classification aesthetic** (soft `rounded-xl
  bg-card ring-1 ring-foreground/10` cards): median **delta badge with INVERTED colours**
  (slower = red/↑, faster = green/↓ vs the **population** median), a **spread chip driven
  by the Inconsistent flag** (never contradicts it), and a **speed-rank gauge**. Portfolio
  context (`CyclePortfolioContext` = population median/p25/p75 + roster medians) plumbed
  CycleTimeClient → CycleSupplierSection → panel.

⚠️ **Inconsistent flag = supplier-level, client-side, NO recompute.** In `CycleTimeClient`
(~L124): `iqrCutoff = 1.5 × median(all suppliers' full-history IQRs)`; `inconsistent =
supplier's full-history IQR > iqrCutoff`. The consistency line colour, the "Flagged
Inconsistent" note, AND the spread chip are all driven by this one `inconsistent` value,
so they cannot contradict each other. Roadmap (a)–(e) all complete; no major pending items.

### PRIOR SESSION (`3d79e24` → `a96c38e`)

**Period tagging: invoiceDate → paymentDate app-wide (`462a5ef`).** The date that
tags a PO to a period is now **`COALESCE(paymentDate, prDate)`** (was invoiceDate),
consistently across: Python `load_frames` + BOTH monthly-trend bucketings,
`transform_dataset.py` per-period metric bucketing, upload route (`periodId` write
+ year detection), `spend-overview` aggregate, all cycle-time routes
(breakdown / stage-occupancy / supplier-detail), `spend-detail` (both filters),
`evolution` bucketing, and `migrate-period-tags.ts` (default `--by` now `payment`,
`--by=pr` kept). paymentDate is non-null on all 647 POs → the `prDate` fallback
never fires. **Left untouched (not tags):** display-value `invoiceDate` returns +
the stage-occupancy stage-math boundary. Calc logic (medians, composite weights,
ABC 80/95, Kraljic median splits, `total_cycle_days = paymentDate − prDate`) is
UNCHANGED — only the per-period population shifted.
- ⚠️ **DO NOT run `migrate-period-tags.ts`** against the current per-period model —
  its `supplierMetric.updateMany({ periodId: maxYear })` collapses all per-period
  `SupplierMetric` rows onto the latest period (corrupts per-period metrics). The
  re-tag was done via a **targeted `Purchase.periodId` UPDATE** (Purchase only) +
  `python compute_analyses.py --period-id <id>` per period +
  `DELETE FROM "AnalysisResult" WHERE "periodId" IS NULL` (range-cache clear).
  (`compute_analyses.py` reads metrics by the period's date bounds, not by
  `Purchase.periodId`, so it doesn't depend on that column.)
- **Recomputed + verified (2025, paymentDate basis):** 313 POs · $283.6M · 50
  active suppliers (55 roster) · ABC A10/B9/C31 · Kraljic Strategic8 / Leverage17 /
  Bottleneck16 / Routine9 · zones Stars19 / Critical6 / HiddenGems6 / LongTail19 ·
  **control exposure $42.47M / 15.0% / 41 POs / 24 suppliers** · cycle median 31.0 /
  mean 32.58 / typical range 25–39. ⚠️ Do NOT trust Ruby's separate/larger dataset
  numbers ($30.34M / 314 POs / 54) — that's a DIFFERENT dataset in another env, not
  this DB.
- ⚠️ **`SupplierMetric` per-period rows are still invoice-year bucketed** (the
  transformer was NOT re-run — needs the enriched xlsx closed in Excel + a
  re-import). Only affects the composite basis feeding Performance zones;
  everything Purchase-derived is fully paymentDate-correct.

**Pipeline chart = whole-integer stage-occupancy + Payment series (`a0d3a2f`).**
Route `/api/cycle-time/stage-occupancy` is **LIVE** (queries Purchase per request,
NOT cached). Supervisor's rule: each of the 4 stage-gaps (PR→PO, PO→Delivery,
Delivery→Invoice, Invoice→Payment) counts a whole **+1 in EVERY window month its
span touches** (occupancy), PLUS a 5th **Payment** series (terminal milestone,
+1 in its own payment month). `StageOccupancyRow` = `pr_active / po_active /
delivery_active / invoice_active / payment`. Worked example (PR Jan1, PO Jan10,
Del Feb5, Inv Mar4, Pay Mar8) → Jan: PR,PO · Feb: PO,Delivery · Mar:
Delivery,Invoice,Payment. ⚠️ This REPLACED a brief **uncommitted "milestone
point-events" experiment that was discarded** (git restore) — the rule is
occupancy, not point-events. Labels: series "PR active … Invoice active, Payment",
y-axis "POs active", heading "…(POs active per stage, plus payments)". Population =
payment-tagged POs, so single-year has year-boundary undercount on early
milestones (range mode is clean); occupancy series exceed the PO count by design.

**Spend Overview panel "All invoices over time" → paymentDate (`420cebc`).** The
decomposition panel's PO time-chart + table now bucket money by **paymentDate**
(cash-basis, rule B); table header "Payment date". `SpendDetail.pos` gained
`paymentDate`. (This was the ONE money view still on invoiceDate.)

**Stage/tenure/date arrows "→" → "to" (`bd5f59e`, `a96c38e`).** Process Health stage
names (bd5f59e); Reports `STAGE_LABELS`, Classification card (quadrant-tenure trail
+ "Moved X to Y" + activity date range), methodology stage-stats line (a96c38e) —
all "to". ⚠️ **Value-transition arrows KEPT as "→"** (report `median A → B`,
`PerformanceTrajectory` score before→after, methodology `benchmark → neutral`,
`+8% → 5`). ✅ **RESOLVED (recompute ran 2026-07-03) — both Python recommendation
edits are now LIVE** in the cached `recommendations` (verified from a fresh DB read):
1. **Stage arrows** (`compute_analyses.py` ~L1060) → "to" (`46d6276`). Now emits
   `scope: "Stage: Invoice to Payment"` (the arrow fix only surfaces where a stage
   rec fires — Invoice→Payment mean >8 — i.e. 2024 + the full range; 2025/2026
   single-year emit no stage rec, unchanged).
2. **Audit #6 (`47ffcd9`) — `compute_analyses.py:1052`** "concentrated process
   compliance issue" → "the weakest match compliance among quadrants" (removes the
   claim that contradicted the softened dashboard control-exposure insight).
Recompute procedure used (the SAFE one — NOT the migrate-script SupplierMetric
clobber): idempotent `Purchase.periodId` re-tag (0 rows — already paymentDate-correct,
distribution **306/313/28**) → `compute_analyses.py --period-id` for all 3 periods
(exit 0, 6/6 upserted each, `computedAt` 2026-07-03 10:49) → `DELETE FROM
"AnalysisResult" WHERE "periodId" IS NULL` (24 range rows cleared; regenerates lazily
via Mode B, which also emits the new strings). ⚠️ **Aggregates byte-identical
before↔after** (same paymentDate population): **313 POs / $283,596,813.69 / 50
suppliers / ABC 10-9-31 / Kraljic 8-17-16-9 / control $42.47M (14.98%, 41 POs, 24
suppliers)** — only the recommendation strings changed. ⚠️ The `.env` has a UTF-8 BOM
on line 1, so standalone Python must load `DATABASE_URL` with `encoding="utf-8-sig"`
(or have it passed in the env, as Node does when it spawns the script).

**Process Health rename (`3d79e24`).** "Cycle Time" → **Process Health Monitoring**;
URL **`/cycle-time` → `/process-health`** (permanent redirect in `next.config.ts`).
⚠️ **`/api/cycle-time/*` API paths UNCHANGED** (only the page URL moved).

**Roster table + 3 supplier cards (`1c32b51` → `693ec16`).**
- Roster columns: **# · Supplier · Median · POs · Slowest stage · ABC · Exposure ·
  Performance · Anomalies**. Added **# rank** (unsortable, reflects current sort) +
  sortable **Slowest stage** chip; CUT the Typical-range column + the "Cycle Time
  by Supplier" bar chart (redundant with the sortable Median column; empty-state
  moved onto the table guard).
- **"Flags" renamed "Anomalies" page-wide** (`aa28fbd`/`40196ec`/`fd3c580`) — roster
  column, panel PO-table column, anomaly-cards section title + copy. Outlier /
  Stage-dom pills kept; flagged PO rows get a faint amber (`--warning` 9%) row tint.
- **Panel PO table** merged the old "flagged POs" section into the main table (one
  "Anomalies" column, no triangle icon); per-stage bars are **MEAN** (`spend_mean`/
  `portfolio_mean` from `supplier-detail`); "Exposure" label added to the quadrant
  chip.
- **All 3 supplier detail cards now share ONE identity-header pattern:**
  `name` → subline `category · ABC · Exposure(Kraljic) · Performance zone ·
  country + CountryFlag` → "Showing {period}". The **Performance positioning zone**
  (Stars / Critical Issues / Hidden Gems / Long Tail, `ZONE_COLORS`) was added to
  all three sublines — Classification (`4b37eca`, from the `perf` prop), Spend
  Overview (`68c93ef`, via new `SpendDetail.zone` populated in BOTH spend-detail
  branches), Process Health (`693ec16`, via new `CycleSupplierDetail.zone`; also
  DELETED that card's separate "Classification context" section + added
  `CountryFlag`). ⚠️ `CycleSupplierDetail.composite` is now populated-but-unrendered
  (dead — the raw perf score was intentionally dropped from that card).

### ROADMAP — all items (a)–(e) COMPLETE
- (a) ✅ **DONE — Insight-fragility audit** (`47ffcd9` / `9c3df01` / `6fbdafc`, 12
  insights fixed). Every insight/narrative surface was audited for hardcoded
  adjectives/directions that mislead on data shifts; fixed via guards /
  shape-detection / self-omit / drop. **Batch 1** (`47ffcd9`): stage-insight
  shape-detection + dropped occupancy claim, report basis label invoice→payment,
  control-exposure softened to facts-only, AD rec reword (⚠️ see recompute note
  below — #6 not yet live). **Batch 2** (`9c3df01`): cycle-glance downstream/internal
  now from live PR→PO share; spend-glance diversification cap bug (now reaches
  "broad") + "dominates" / "heavily concentrated" gated. **Batch 3** (`6fbdafc`):
  report-templates — skew direction, dropped uncomputed volatility claim, top-2
  co-dominance (single- vs two-market), concentration adjective scaled,
  value-at-risk self-omits when the critical zone is empty. Already-robust insights
  (distribution insight, classification-at-a-glance, anomaly cards, evolution
  insights, per-tab lines, ABC templates) were confirmed sound and left untouched.
- (b) ✅ **DONE (`47ffcd9`, batch 1)** — the shape-detection IS the flexible-template
  implementation (not partial). `StageInsight` (`StageBreakdownSection`) ¶2 now
  shape-detects **two-stage / single-dominant / even-spread**, ¶1's "dominates" is
  guarded, the unverified occupancy claim was dropped, ¶3 self-omits (gated on ≥2
  categories) and ¶4 branches on even-spread/external — so all four paragraphs are
  data-driven. This replaced the old fixed "one dominates, the other three are short
  and steady" story, which was the entire flexible-template goal.
- (c) ✅ **RESOLVED / N/A** — `defense.md` is a methodology doc and never contained a
  stage-duration narrative; the stale stage story was the DASHBOARD stage insight,
  fixed in (b). No doc edit needed.
- (d) ✅ **DONE (`d9b7f83`)** — the Process Health supplier-card PO table now shows all
  5 milestone dates (PR · PO · Delivery · Invoice · Payment, compact "Feb 3 '25";
  Slowest-stage column dropped for width; reconciles with cycle days).
- (e) ✅ **DONE (`46d6276` + recompute 2026-07-03)** — Action Dashboard stage arrows
  → "to" (`compute_analyses.py` ~L1060) AND the bundled audit-#6 reword
  (`:1052`, `47ffcd9`) are both LIVE after the recompute. Verified from a fresh DB
  read (computedAt 10:49, new strings present, aggregates byte-identical — see the
  "RESOLVED" recompute note above for the full procedure + numbers).

### Cycle Time page overhaul (`a919b7a` → `5c8c930`)
The Cycle Time (Process Health) **dashboard** was substantially rebuilt. ⚠️
`CycleTimeView` is **SHARED** with reports + range-compute (`ReportDocument`,
`RangeCompute`); every dashboard-only change is gated by a `showX`/prop so
**reports/range-compute pass none → render the ORIGINAL layout unchanged**. The
gates on `CycleTimeView`: `showAnomaliesTable`, `showMonthlyTrend`, `showStatGrid`,
`showStageDecomposition` (all default **true** = reports keep it), plus opt-in
`showDistributionInsight` (default false), `controlExposure`, `onOutlierClick`.

- **Naming/jargon (`a919b7a`, `42a4bbb`, `32c5323`):** "Slow POs"→**Outlier POs**;
  "Stage anomalies"→**Stage-dominated POs**; "Supplier Type"→Kraljic quadrant;
  Kraljic/Perf-vs-spend tabs + labels → **Exposure positioning / Performance
  positioning** (Kraljic cited as the framework in descriptions only; methodology
  keeps formal "Kraljic"); **IQR → "Typical range"**, **Mean → "Average"**, dropped
  the σ and `n =` stat sublabels. `useTableSort` fixed so nulls sort last + numeric
  columns stay numeric. Methodology §3.4 now documents Typical range/IQR (linear
  quantiles) + the 3 supplier flags.
- **Glance = narrative (`eaef83d`, `c8e5d15`):** "Cycle at a glance" is prose
  (lead + "Where the time goes" + "Worth noting" bullets + hint); its old KPI row
  was removed (duplicated the stat grid + flags).
- **Anomaly section (`85ed1a3`):** the 3 flag cards are **supplier-level** (Has
  outlier POs / Inconsistent / Has stage-dominated POs, muted cards) that filter
  the SINGLE roster (synced with roster filter chips; chart+table filter together);
  a **Flags** column replaced "slowest stage"; the two PO tables collapsed — PO
  detail lives in the drill-down's "flagged POs" section. Reports keep the Outlier
  POs table via `showAnomaliesTable`.
- **Stat grid + interactions (`c8e5d15`):** extracted **`CycleStatGrid`** (Median /
  Typical range / Average / Range + optional 5th **Slowest stage** card via
  `includeSlowest`, dashboard-only); flipped so the stat grid sits ABOVE the anomaly
  flags; **box-plot outlier dots are clickable** → open the same supplier detail
  panel as roster rows (`onOutlierClick`; lifted `selectedSupplierId` in
  `CycleTimeClient`).
- **Distribution insight (`67f88a2`):** dashboard-only shape lines under the box
  plot (slow-skew + one-directional-outliers, self-omitting) via
  `showDistributionInsight`; box-plot **x-axis clamped to 0** (everywhere).
- (a) **Stage breakdown merged section (`11ee645`, + `df1b2b8`/`4c000ec`):** ONE
  dashboard-only "Stage breakdown" card = **pipeline chart** (row 1) + 50/50 row of
  **decomposition table + a self-omitting 4-paragraph stage insight** (left) and
  **category stacked bars** (right). The decomposition table is **gated out of the
  dashboard's `CycleTimeView` via `showStageDecomposition={false}`** but kept in
  reports. The **pipeline chart** (`StageOccupancyChart`, route
  `/api/cycle-time/stage-occupancy`) replaced the Monthly Cycle Time Trend on the
  dashboard (trend kept in reports via `showMonthlyTrend`); it is **whole-integer
  "POs active" per stage per month on the 303 invoiceDate-tagged population** (was
  fractional/339 lifecycle-overlap — ⚠️ boundary-month undercounting ACCEPTED
  pending a supervisor decision on the 303-vs-339 population; fractional/339 version
  preserved in a spec doc). New files: `StageBreakdownSection`,
  `StageDecompositionTable` (extracted from CycleTimeView),
  `StageByCategoryChart`, `StageOccupancyChart`, `CycleStatGrid`; **deleted**
  `StageOccupancySection`.
- (b) **Period-vs-Period Comparison REMOVED (`6fc1339`):** the interactive
  date-picker widget + `ComparisonResult` + the `/api/analyses/cycle-compare` route
  + `runCycleCompare` (`lib/python.ts`) + the `--comparison-*` Python CLI path are
  all **deleted** (dashboard + reports). ⚠️ **KEPT:** `_comparison_block` + the
  default midpoint-split `period_comparison` emit + the `PeriodComparison` type —
  they still feed the **glance stability sentence** and the **report cycle-time
  narrative prose**. Cycle-time now always does the midpoint split (no CLI override).
- (c) **3-Way Match → "Control Exposure" reframe (`5c8c930`, dashboard-only):** the
  bare pass-rate table became a **spend-at-risk** card — headline **$37.1M /
  13.6% of spend / 38 POs across 22 suppliers** + a data-honest "diffuse, not
  concentrated" insight (explicitly: failures are NOT tied to payment time, supplier
  quality, or PO size — all tested null) + the quadrant pass-rate table **demoted**
  below. Powered by a new **`controlExposure` aggregate on `/api/cycle-time/breakdown`**
  (added `threeWayMatchPass` + `totalValueUsd` to its select), passed via a **gated
  optional `controlExposure` prop**; reports pass nothing → **keep the bare
  pass-rate table**.
- (d) **Mean-based "% of cycle" (`11ee645`):** the slowest-stage share is now
  `stage_mean ÷ Σ(4 stage means)` = **49%** consistently across the **glance**,
  the **Slowest-stage stat card**, and the **Stage-breakdown insight** (was
  median-based 47% on the glance/card).

### Recent work (post-Batch-6, through `3d0757a`)
- **Cycle Time modernization** (`478fc69`, `39c73b2`, `6da0708`, `ff46c9a`,
  `48366b3`): data-driven "Cycle at a glance" panel replacing the generic intro;
  3 anomaly action cards (Slow POs / Inconsistent suppliers / Stage anomalies) that
  filter + smooth-scroll to the Anomalies table or supplier roster; per-supplier
  drill-down panel with classification context; sort arrows, StatBlock density,
  card elevation, styled header; theme-aware chart colours. Thresholds: **stage
  anomaly = one stage > 60% of total cycle**; **inconsistent supplier = IQR > 1.5×
  portfolio-median IQR (Tukey)**. Stage Decomposition + per-quadrant tables at 2dp.
- **Detail-panel period-aware fixes** (`7009df1`): sub-score sparklines sliced to
  the selected year (range = all years); zero-delta renders "stable" (not "0.00 vs
  prev"); classification history is the compact TABLE on BOTH panels
  (`HistoryTimeline` DELETED); inactive-but-has-history suppliers show the
  trajectory + a `PerformanceInactiveNote` instead of "No data".
- **Spend Overview detail-panel restructure** (`45b0812`, `788fcfc`): the
  performance expand is REMOVED from this panel (performance depth lives on the
  Classification panel); 4-card KPI grid (Total spend / Invoices / Avg invoice /
  period composite, compact currency); "Spend insights" section (portfolio-rank +
  YoY-change cards, green ↑ / red ↓); identity header = plain-text classification +
  SVG `CountryFlag` (`components/CountryFlag.tsx`, `country-flag-icons`) after the
  country code; "Activity period" + "Spend detail" tabs; Annual breakdown
  deduplicated (classification arrows + perf chart dropped; spend-only insights).
- **Supplier Classification page fixes** (`3d0757a`): Recharts scatter legends
  `verticalAlign="top"` (no collision with the bottom axis label); quadrant + zone
  tables Avg performance at 2dp; `routine_risk` synthesis card harmonized to blue
  to match `--quadrant-routine`.

### Next / parked
- **Supplier Classification detail-panel parity** (next): port the rich Spend
  Overview treatment onto it — identity-header parity (plain-text ABC/Kraljic +
  `CountryFlag`), classification-specific insight cards, and the 4-card KPI grid /
  "Spend insights" / "Activity period" formatting. Data is already in scope (the
  panel fetches the same `spend-detail` + `evolution`), so it is a pure
  presentation port — no API/data change.
- **Action Dashboard period-awareness** — separate batch; do not retrofit ad-hoc.
- **Phase 10 polish → v1.0**: loading states, error boundaries, mobile responsive,
  README, smoke test.

### Spend Overview redesign + polish + Supplier Evolution + ABC merge
- **`/` and `/abc-analysis` both redirect to `/spend-overview`** (renamed from
  "Overview"; ABC Analysis page deleted and merged in). Nav lost both "Overview"
  (renamed) and "ABC Analysis" entries.
- **The page is client-fetched in BOTH cached + range modes.** Server
  `spend-overview/page.tsx` resolves the period/range to a date span and renders
  `SpendOverviewClient`, which POSTs `/api/spend-overview {startDate,endDate}` →
  `{ spend_overview, abc, ranking }` (charts + ABC card + 54-row ranking). No
  server-cached fast path; brief loading spinner (same pattern as the editor).
- **Ranking data is a server-side `Purchase` aggregate** (spend / invoice count /
  avg over the span) merged with ABC class + Kraljic quadrant from the analyses +
  category — period/range-accurate. ⚠️ NOT from `spend_overview.top_suppliers`
  (which is top-10 only and lacks counts).
- **KPIs are dashboard-only** (Total spend, Total invoices, Active suppliers, Avg
  invoice value — no "Total POs", no "Avg cycle time"). They live in
  `SpendOverviewClient`, NOT in the shared `OverviewCharts` (which the report
  editor still uses unchanged; only `TopSuppliersCard` was exported from it).
- **`formatCompactCurrency()` in `lib/utils.ts`** ("$25.6M"/"$1.2K"/"$487") —
  used in the ranking table; KPIs already compact (not double-shortened); exact
  values live in tooltips + the panel.
- **Invoice-based labels** ("Invoices", "Avg invoice") everywhere in Spend
  Overview; numbers equal PO counts (invoiceDate is 1:1 non-null). `PO ID`
  columns/identifiers are NOT renamed.
- **ABC content = `AbcParetoCard`** (between Top 10 and the ranking table):
  Class A/B/C summary blocks + the reused `ParetoChart` (bars by class colour +
  cumulative-% line + 80/95 reference lines) + methodology footer. ⚠️ `AbcView`
  and `ParetoChart` are RETAINED — still imported by the shared `RangeCompute`
  (its `kind="abc"` branch is now unreachable but harmless).
- **Spend decomposition panel** (`SpendDecompositionPanel`) is a **centered
  floating card** (not a docked sidebar) — refactored onto the shadcn/base-ui
  `Dialog`/`DialogContent` primitive (`components/ui/dialog.tsx`), which owns the
  dim backdrop, fade-in + zoom-in animation, focus trap, scroll lock, and the ESC
  / backdrop-click close paths. Open is controlled by `open={!!supplierId}` +
  `onOpenChange`→`onClose` (parent always mounts it). Widened to ~680px
  (`sm:max-w-[680px]`, `max-h-[85vh]` with internal scroll) to accommodate the
  chart-driven content; header X button + DialogTitle (supplier name) retained,
  the primitive's built-in close button is suppressed (`showCloseButton={false}`).
  It is CHART-DRIVEN: Tab 1 "Spend by item" = horizontal bar chart (top 15 + Others);
  Tab 2 "All POs" = time-series bar chart; both have a "View as table" toggle
  (chart default). Tabs 1+2 are **period-scoped** via
  `/api/suppliers/[id]/spend-detail?start&end` (optional params; omit = all-time,
  backward compat) — panel totals reconcile with the clicked ranking row.
- **Evolution tab** (`/api/suppliers/[id]/evolution`, NOT period-scoped — all
  years): classification chips (ABC/Kraljic per year) + spend line + performance
  line + product-mix stacked bars + auto insights. Gap years (supplier inactive)
  render as zero/null gracefully.
- ⚠️ **RETIRED — "Performance trajectory is flat by design" is FALSE now.** The
  backend rebuild made `SupplierMetric.compositeScore` per-payment-year (delivery/
  process vary per year), and the FILTER-LIVE composite change (top session block)
  makes the displayed composite recompute per time filter. Single-year is
  byte-identical to the stored per-year value; range is a true span-aggregate. The
  composite is no longer a flat per-supplier snapshot.
- **Panel ABC/Kraljic chips** ⚠️ **SUPERSEDED** — were latest-period; now
  **period-scoped** (see "Panel consistency + data integrity batch" below). The
  Evolution tab still shows the full per-year trajectory.
- **Report editor unchanged**: it keeps its own ABC section and `OverviewCharts`;
  dashboard→report propagation is deferred (`dashboard_report_propagation.md`).

### Spend Overview design unification + insights panel
- **`StatBlock` primitive (`components/ui/stat-block.tsx`)** — the single stat
  callout (`Card` container, sentence-case `label`, `font-semibold` value,
  optional `sublabel`, `accent` left-border, `size` default/`lg`). Replaced THREE
  divergent patterns: KPI cards (now `lg`), ABC class boxes (`accent`
  destructive/warning/success), and the panel header stats. Lives in
  `components/ui/` for reuse on future merges (e.g. Supplier Classification).
- **Chart colours are CSS vars (Approach A).** `lib/chart-colors.ts` now holds
  `var(--chart-1..8)` / `var(--abc-*)` / `var(--quadrant-*)` / `var(--zone-*)`
  instead of hex; the tokens are defined in `app/globals.css` for **both** light
  (values preserve the prior hardcoded hex — light mode unchanged) and dark
  (brightened ≈Tailwind *-400). ⚠️ Recharts resolves `var()` in `fill`/`stroke`
  (verified in-browser). Charts now adapt to dark mode app-wide. The Pareto
  cumulative line uses `var(--chart-line)` (was `#334155`).
- ⚠️ **Hex-alpha concatenation (`${color}22`) breaks with CSS vars** — replaced
  with `color-mix(in srgb, ${color} 13%, transparent)` at the badge tints in
  `SpendDecompositionPanel` AND (compat-only, appearance-preserving) the report
  editor's `SupplierDetailPanel` `Pill`. This is the one report-editor file the
  batch touched, and only to keep it rendering identically after the constant
  migration.
- **Number formatting — "tooltips local" (user ruling).** Dashboard-only surfaces
  (KPIs, `InsightsPanel`, ranking) use `formatCompactCurrency` (the canonical
  compact formatter); the duplicate `Intl` `usdCompact` was removed from
  `SpendOverviewClient`. ⚠️ The **shared chart components keep `usdCompact`** so
  report tooltips stay byte-identical (they render in `ReportDocument`); the
  decomposition panel keeps `usd0` (exact) since it's the exact-values surface.
  *(Deferred: when the report editor is synced, reconcile report-chart tooltips —
  the intended report convention is FULL numbers. There is no
  `dashboard_report_propagation.md` file in the repo yet; this note records it.)*
- ⚠️ **html2canvas + `var()` caveat (untested here):** report PDF export
  rasterizes Recharts SVG; html2canvas's CSS-var support is historically partial.
  PDF export was NOT modified or re-verified in this batch — confirm chart colours
  survive PDF export when the report-sync batch runs.
- **`InsightsPanel` (`components/SpendOverview/InsightsPanel.tsx`)** — consolidated
  analytical summary at the TOP of the page (below title, above KPIs), in a `Card`
  titled "Spend at a glance". Three sections (scale+concentration paragraph,
  "Where the money goes" category/top-supplier paragraph, "Patterns worth noting"
  bullets) + an italic closing hint. Computed CLIENT-SIDE from already-loaded
  `spend_overview` + `abc` + `ranking` (no new API/Python). **Period-aware**:
  `periodPhrase()` renders "from 2024 to 2026" (range) vs "in 2026" (single year),
  threaded via new `periodLabel`/`isRangeMode` props from `page.tsx`
  (`isRangeMode = source.kind === "range"`). Top-supplier invoice count is joined
  from `ranking` by `supplier_id` (not in `top_suppliers`). ⚠️ The "supplier
  consistency across periods" idea from the spec was **replaced with an in-span
  spend-concentration bullet** (suppliers to reach 50%/80%) — per-period
  decomposition isn't in the loaded aggregate and new fetches were out of scope.
  Gated on `data.abc` (skips gracefully in any abc-less mode).
- **Per-section card descriptions REMOVED** (Monthly Spend Trend, Pareto/ABC, All
  Suppliers) — the InsightsPanel now carries all context. Spend-by-Category and
  Top-10 already had none.
- **Typography unified**: panel `DialogTitle` uses `CardTitle` styling
  (`font-heading font-medium`, not the old `font-semibold` override); all
  `uppercase tracking-wide` labels (panel header stats + Evolution-tab headers)
  are now sentence case.

### Spend Overview visual polish (follow-up)
- **`StatBlock` density + coherence.** It now sets explicit padding (`p-3`
  default / `p-4` `lg`) — `Card` only applies `py`, so without this the content
  was flush to the horizontal edges. Tight top-aligned stack (no
  `justify-between`); `lg` is the same component a notch larger. KPI cards carry
  period-aware **sublabels** ("from 2024 to 2026" / "in 2026", "N.N per supplier",
  "across N categories", "per invoice") via `periodPhrase()` in
  `SpendOverviewClient` (mirrors `InsightsPanel`'s).
- **Category colours are a SEPARATE family.** `CATEGORY_COLORS` (`var(--category-1..8)`,
  defined in `app/globals.css` light+dark) — deliberately blues/violets/cyans/
  magentas with **no** red/amber/lime/green, so the Spend-by-Category donut never
  collides with `--abc-*` (Class C lime) or `--quadrant-*`. ⚠️ Only
  `SpendByCategoryChart` uses it; `CHART_COLORS` is unchanged and still used by the
  other series (Top 10, trends, panel). The panel's product-mix stacked bars still
  cycle `CHART_COLORS` (left as-is — not the donut).
- **Top 10 supplier labels are theme-aware.** `TopSuppliersChart` uses a custom
  `SupplierNameTick` (`fill="var(--foreground)"`) instead of Recharts' hardcoded
  `#666` (which didn't adapt to dark mode). The **pinned** supplier's label is
  highlighted (`var(--primary)` + weight 600) so the cross-chart pin reads on the
  label, not just the bar. (No actual "pink labels" bug was found in `0820996`;
  this applied the decision's stated remedy — theme-aware default + distinct
  pinned — which also fixes dark-mode legibility.)

### Supplier ranking table polish (follow-up)
- **No internal scroll** — the `max-h-[640px] overflow-y-auto` wrapper was removed;
  all 54 rows render at natural height and the page scrolls.
- **Page-sticky column header** — `sticky top-0 z-10` is on the `<th>` cells (with
  `bg-card` + `border-b`). ⚠️ The card must be `overflow-visible`: the `Card`
  primitive's default `overflow-hidden` establishes a scroll-container that would
  trap `position: sticky`. The page `Header` is NOT sticky (it scrolls away), so
  `top-0` pins to the viewport — no header offset needed.
- **ABC + Kraljic are `color-mix` chips** (`rounded-md px-2 py-0.5 text-xs`,
  `var(--abc-*)` / `var(--quadrant-*)` tint at 12% + full-intensity text) instead
  of bare colored letters/words. ABC chip = just "A"/"B"/"C"; Kraljic chip = full
  quadrant name.
- **Row-click only** (no per-cell handlers exist) — every cell opens the panel via
  the `<tr>` onClick. Categorical cells are plain `--foreground` text (Category was
  `text-muted-foreground`) with NO link affordance; `py-3` rows, `hover:bg-muted/40`,
  selected row keeps `ring-inset`. Numeric columns were already right-aligned.

### Supplier ranking + detail panel + sidebar (follow-up)
- **Kraljic + Tier columns removed** from the ranking table → 7 cols (`# ·
  Supplier · Category · Total spend · Invoices · Avg invoice · ABC`). `kraljic_quadrant`
  stays in the row data, just unrendered; the `SortKey` member + `QUADRANT_COLORS`
  import were dropped from the table.
- **Detail-panel header is now a 3-section supplier profile** — each a `border-b
  p-4` block with a sentence-case `text-sm font-medium text-muted-foreground`
  subheader: **"Spend at a glance"** (3 StatBlocks) · **"Performance &
  classification"** (Performance-score StatBlock + ALWAYS-on ABC + Kraljic chips
  via a shared `Chip` helper — `rounded-md` color-mix 12% tint, null → muted "—"
  placeholder) · **"Activity"**. The old single stats+chips block is gone.
  ⚠️ The tier-mismatch badge that once lived here was **REMOVED** (data-integrity
  batch); the perf StatBlock is labeled "out of 100 · latest snapshot".
- ⚠️ **`spend-detail` route** — `performanceScore` (= `SupplierMetric.compositeScore`)
  in `SpendDetail.supplier`; ABC/Kraljic are **period-scoped** via
  `getRangeAnalyses(start,end)` (NOT latest-period — superseded). `calculatedTier`
  / `tierMismatch` were removed from the SELECT and the type.
- **Sidebar is collapsible** (`components/Sidebar.tsx`): chevron toggle at top,
  `w-60`↔`w-16`, `transition-[width] duration-200`, labels hidden when collapsed,
  `title`-attribute tooltips (no `Tooltip` primitive exists in the repo). State
  persists in `localStorage["dashboard_sidebar_collapsed"]`, read via
  **`useSyncExternalStore`** (server snapshot = expanded) — this both avoids the
  lint-banned set-state-in-effect and stays hydration-safe. Content area
  auto-expands (sidebar is `shrink-0`, `<main>` is `flex-1` — no `ml` math).
  ⚠️ The width transition is throttled in hidden preview tabs (measure with
  transition disabled to verify the 240/64 px target).

### Score Methodology Architecture (methodology rebuild)
- **All five sub-scores are code-derived in `scripts/transform_dataset.py`**
  from raw operational inputs — the transformer (not the xlsx) is the source of
  truth for every derived value. It is **fully deterministic — no `rng` / no
  Gaussian noise anywhere**.
- ⚠️ **Two-file schema (xlsx cleanup).** The dataset is split into two committed
  workbooks under `data/raw/`:
  `procurement_data_raw.xlsx` = **input**, operational measurements only (NO
  derived score columns), the source of truth for raw data; and
  `procurement_data.xlsx` = **output**, raw columns + the 8 computed scores,
  **regenerated each transformer run** and the file the import route reads.
  **Flow: raw xlsx → transformer → enriched xlsx → import → DB.** The transformer
  reads `RAW_XLSX`, **strictly rejects** any of the 8 derived columns in the raw
  input (`DERIVED_COLS`, clear abort message), computes, and writes `XLSX`. The
  import zod schema still requires the derived columns, so it reads the enriched
  output — unchanged.
- ⚠️ **CURRENT COMPOSITE MODEL (`aca864c`) — this supersedes the pre-`aca864c`
  formulas/stats in this section. `python/scores.py` is the source of truth.**
  Composite = **`0.30·Quality + 0.30·Delivery + 0.22·Process + 0.18·Risk`** (4
  dimensions — the **Service dimension was DROPPED**; its 15% redistributed
  proportionally, priorities unchanged). All 2dp.
  - `quality  = (norm_low(defect_rate_pct,0,10) + norm_low(complaint_rate_pct,0,100))/2`
    — **per-PO derived + filter-live**: defect_rate = Σdefect_count/Σqty·100,
    complaint_rate = orders-with-≥1-complaint / num_pos·100 (0–100). NOT survey
    constants.
  - `delivery = (norm_high(on_time_delivery_pct,0,100) + norm_low(avg_lead_time_days,0,60))/2`
  - `process  = norm_high(three_way_match_pct,0,100)`
  - `risk     = 100 − (0.6·country_distance + 0.4·roster_concentration)` — **purely
    STRUCTURAL, higher = SAFER**. country_distance = ID 0 / ASEAN 30 / Asia-Pacific
    60 / other 100. **NO complaint term** (dropped — double-counted Quality), **NO
    single_source flag** (replaced by the continuous roster-concentration measure,
    the same signal Kraljic's supply_concentration uses, scaled 0–100).
- **Fixed industry bounds** (NOT population min/max) so scores are stable when data
  changes; `norm_high/norm_low` clamp to [0,100]. ⚠️ **The formulas + rebuild stats
  BELOW are the PRE-`aca864c` transform_dataset.py-era model (5 dims incl. Service,
  single_source in risk, weights 0.25/0.25/0.15/0.20/0.15) — kept as history, NOT
  current.** On the old model: `risk_score` fix corrected a polarity bug and the
  rebuild shifted composites (mean ~68→76). `calculated_tier` + `tier_mismatch` were
  REMOVED (data-integrity batch); the transformer no longer computes them.
- **`scripts/transform_dataset.py` logs an old-vs-new diff** (summary + buckets +
  top-5/score + tier crossings + mismatch flips) and saves the full diff to
  `scripts/score_rebuild_diff.json` (**gitignored**, intermediate). ⚠️ The diff
  baseline is the **PREVIOUS enriched output** (`procurement_data.xlsx` read
  before overwrite), not the raw input — on a first run with no prior output the
  diff is skipped. It prompts before overwrite when interactive; auto-proceeds
  when stdin is piped.
- ⚠️ **The transformer writes the xlsx only — the DB is refreshed by re-importing
  via `/api/imports/upload`** (admin), which re-runs the Python analyses. ABC /
  Kraljic are spend-based → unchanged; Performance-vs-Spend zones + Action recs
  recompute from the new composite (expected).

### Panel consistency + data integrity batch
- **Tier mismatch REMOVED entirely** (unreliable: 45% fire rate, uncorrelated
  with composite). Dropped from: Prisma `SupplierMetric` (migration
  `remove_tier_mismatch` drops `calculatedTier` + `tierMismatch`), the transformer
  (no compute; `DERIVED_COLS` now 6), the enriched xlsx, the upload zod, the
  `SpendDetail` type, the detail panel badge, the methodology page, and these docs.
- **ABC + Kraljic chips are now PERIOD-SCOPED** (revises the old "latest-period"
  Decision F). `spend-detail` sources them via **`getRangeAnalyses(start,end)`** —
  the SAME function the ranking uses — so the panel chips and the ranking table's
  ABC column always agree for the selected period. Absent from the period → `null`
  → "—". (No-span fallback: latest period, backward-compat.)
- **Performance score stays a single snapshot** (`SupplierMetric.compositeScore`,
  tagged latest period) — labeled **"out of 100 · latest snapshot"** in the panel
  so its non-period scope is explicit (true per-period perf needs per-period
  operational metrics, deferred).
- **The ranking table lists ALL suppliers** (`SupplierMetric` roster, not just
  in-period ones). Suppliers with no period activity get `inactive: true`, render
  **muted (`opacity-50`)** with "—" for spend/invoices/avg, ABC "—", ranked last
  (sort by spend desc). Still clickable → panel shows the honest absent view.
  ⚠️ `InsightsPanel` concentration math filters to `!inactive` so $0 rows don't
  inflate the long-tail count.
- **Absent-supplier detail panel:** spend stats "—", Activity "No activity in this
  period", chips "—", Spend-by-item/All-POs tabs show empty states; Evolution
  (all-years) still renders. `spend-detail` returns **200 with zeroed stats** for
  an existing-but-inactive supplier (404 only for a genuinely unknown id) — the old
  misleading "Supplier not found" no longer fires for real suppliers.
- **PT Gunung Raja Paksi (S101) is no longer a phantom** — 7 reconciled Local-Steel
  POs added to `procurement_data_raw.xlsx` (spread 2024–2026); its SupplierMetric
  operational aggregates (otd/twm/lead/cycle/spend/npos/avg) are DERIVED from those
  POs (preserving the "aggregates == purchase-derived rates" invariant), soft
  metrics (defect/complaints/rfx/response/single-source) set to spec values.

### Cycle Time reframe (Batch 5)
- **`automation_period` column NO LONGER EXISTS** — dropped from the xlsx,
  `transform_dataset.py`, Prisma schema, DB (migration
  `remove_automation_period`), upload route, and Python. The synthetic data's
  one-time pre/post automation label was analytically brittle over time.
- **Cycle Time is ONE analysis type, renamed `hypothesis` → `cycle_time`.** It
  emits process-health monitoring (monthly trend + trailing 3-mo rolling avg,
  median/IQR distribution, stage decomposition, Z-score anomalies at **> 2σ above
  the mean**, per-quadrant cycle descriptives, 3-way-match pass rates) **plus** a
  default midpoint-split `period_comparison` (two-sided Mann-Whitney U +
  rank-biserial r). Metric = **`total_cycle_days`** (was invoice-to-payment).
- **`/api/analyses/cycle-compare`** computes custom date-range comparisons
  on-demand (Mode B + `--comparison-*` flags via `runCycleCompare`); **not
  cached**, returns only the `period_comparison` block.
- **`cycle_by_quadrant` + `three_way_match_by_quadrant` are single-population
  descriptives** (pre/post split dropped). 3-way match now reports
  `pass_rate_pct` + `is_worst` (was `fail_rate_pct`).
- **6 statistical methods**: time-series descriptives, distribution/IQR, stage
  descriptives, Z-score anomalies, Mann-Whitney U, rank-biserial r.
- Box plot is **hand-composed SVG** (`CycleTimeBoxPlot`, single-population +
  outlier dots) — Recharts has no native box plot, matching the codebase's
  existing approach. Deleted dead charts: `CycleTimeHistogram`,
  `StageBreakdownChart`, `CycleByQuadrantChart`.

### Chart interactions (Batch 6b)
- **`supplier_id` is the stable cross-chart identity key.** Python now emits it
  in `cycle_time.anomalies`, `spend_overview.top_suppliers`, **and**
  `spend_overview.top_suppliers_by_category` (`CycleAnomaly.supplier_id` +
  `TopSupplier` types, both required). ⚠️ **Any emitter output-shape change
  requires the full Python-first workflow**: recompute Mode A for every period
  THEN `DELETE FROM "AnalysisResult" WHERE "periodId" IS NULL` (clear the range
  cache) — otherwise the editor serves stale cached rows without the new field
  and interactions break silently.
- **Single cross-chart pin** lifted into `ReportEditor` (`pinnedSupplierId`),
  shared via an **OPTIONAL** React context `components/Reports/PinContext.tsx`
  (no-op defaults). Only `ReportEditor` mounts the `PinProvider`; charts read it
  via `usePin()`/`useIsPinned()`, so the standalone dashboard pages (which mount
  no provider) render exactly as before. Pin clears on period change (render-time
  `spanKey` compare, NOT an effect — the eslint config bans both
  set-state-in-effect AND ref-access-during-render).
- **Tooltip = HYBRID, by design.** Recharts charts keep their **native** Recharts
  `<Tooltip>` (HTML overlay, not SVG-clipped); only the hand-composed SVG box
  plot uses a cursor-following body-portal tooltip
  (`components/charts/PortalTooltip.tsx`). A single unified global tooltip was
  rejected because the chart components are shared with provider-less dashboard
  pages — routing tooltips through a context `showTooltip` would make them vanish
  there. Native tooltips satisfy the no-SVG-clipping intent everywhere.
- **Detail panel** = `SupplierDetailPanel` right-side slideout (~320px) over the
  report area only (left settings sidebar stays usable). Content assembled by the
  pure `lib/supplier-detail.ts` `buildSupplierDetail()` from loaded analyses +
  `supplierCategory` + `getSupplierDirectory()` (country + numPos snapshot).
  Anomaly-dot click reuses this panel (no separate modal).
- **Cross-chart highlight is REPORT-SCOPED.** It works across the charts/tables
  actually present in the report document: Top Suppliers bars, cycle box-plot
  anomaly dots, ABC table rows, Action Dashboard recommendation cards. ⚠️ The
  **Kraljic scatter, Performance scatter, and Pareto charts are NOT in the
  report** (it renders TABLES for those analyses) — those chart components are
  wired for pinning but **DORMANT** (they live only on standalone dashboard
  pages). Making "pin in Kraljic → ring in Performance" real is a future-batch
  task (embed those charts in `ReportDocument`, or add a provider to the
  dashboard pages). `/reports/[id]` (persisted reports) has no provider → no
  interactivity, unchanged (backward compat).

### Navigation polish (Batch 6c)
- **Sparkline data comes from the monthly_trend emitters.** Python now emits
  `po_count` in `spend_overview.monthly_trend` and `median_cycle_days` in
  `cycle_time.monthly_trend` (both **optional** types for pre-6c cached rows).
  ⚠️ Adding these required the full Python-first workflow (recompute Mode A for
  every period THEN clear the range cache — see [[batch6b-supplier-id-emitters]]).
- **PDF tab/collapse reveal is JS, NOT CSS.** A `.report-exporting` CSS-class
  approach was tried and **abandoned** — under Tailwind v4's cascade the rule
  never won over the `hidden` attribute's `display:none` (verified in-browser).
  Instead `DownloadPdfButton` strips the `hidden` attribute from every
  `.export-reveal` element, waits a double `requestAnimationFrame`, runs the
  html2canvas capture, then restores `hidden`. This also preserves each
  element's natural `flex`/`block` display (better than forcing `block`).
- **`.export-reveal` marks hideable content** — inactive Spend-Overview tab
  panels + collapsible section bodies. It is only a JS selector hook (no CSS).
- **`ReportDocument` is keyed by `spanKey` in `ReportEditor`** so it remounts on
  period change, resetting all per-session local UI state (section collapse,
  active Spend-Overview tab, TOC active section). No reset effect needed.
- **All 6c chrome is gated on the `embedded` prop** (TOC, sticky headers,
  collapse chevrons, KPI sparklines, tab switcher). `/reports/[id]`
  renders `ReportDocument` without `embedded` → static immutable view, unchanged.
- **Sticky stack:** `ReportTOC` is `sticky top-0`; section headers are
  `sticky top-9` (below the TOC). TOC active section uses an IntersectionObserver
  scroll-spy. Sidebar width animates via `transition-[width] duration-150`.
- ⚠️ **Environment artifact (testing note):** CSS transitions and
  IntersectionObserver are throttled in hidden/headless preview tabs
  (`document.visibilityState === "hidden"`). Frame-dependent behavior (sidebar
  slide, TOC scroll-spy highlight) is correct but only observable in a VISIBLE
  browser — don't mistake the throttling for a bug.

### Architecture facts (current as of 11F)
- **Period tagging uses invoice date** with PR-date fallback, i.e.
  `(invoiceDate ?? prDate).year`. Python `load_frames` filters by
  `COALESCE(invoiceDate, prDate)`. This surfaces a **2026** period.
- **Default landing is Range mode (all years)**, not single-year latest
  (`getCurrentPeriodSelection` fallback in `lib/period.ts`).
- **`AnalysisResult` has nullable `periodId` + `rangeStartDate` + `rangeEndDate`.**
  Single-year rows set `periodId`; range cache rows set the dates. **Two separate
  unique constraints** (`[periodId, analysisType]` and `[rangeStartDate,
  rangeEndDate, analysisType]`), NOT one 4-column — a single nullable 4-col
  unique would not enforce uniqueness (Postgres NULLs are distinct).
- **Range results are cached** in `AnalysisResult` (computed once, then read);
  the range cache (`periodId IS NULL` rows) is **invalidated on re-upload**.
- **Reports use `ReportConfig`** (`lib/report-config.ts`): 5 customization layers
  (period, sections, recommendation filters, detail level, category filter
  with per-section scope) + **3 tones** (executive/operational/analytical).
- **Filter philosophy = visibility-only**: filters hide rows; narratives stay
  full-population with a caveat (no recompute). **Tone variants are applied at
  RENDER time** (`ReportDocument` picks `TEMPLATES[tone][section]`), not baked.
- **Single-year reports persist** (`ExecutiveSummary` + `/api/reports/generate`);
  **range reports are in-memory** (`/api/reports/generate-ephemeral` →
  `/reports/preview`, never saved).
- **`generate_dataset.py` does NOT exist in this repo.** The synthetic dataset
  was generated externally; **`scripts/transform_dataset.py`** is the
  deterministic transformer (seed 42) that produced the current
  `data/raw/procurement_data.xlsx` (risk_score/single_source fixes).

### Kraljic decisions (from Phase 11)
- **Supply Risk Score** (reworked `57097d7`) = `supply_concentration(≤50) + cost_premium(≤25) + import_friction(≤25)`, caps sum to 100 (clip is a no-op). Replaced the old `single_source(30)+category_competition(30)+country_distance(20)+switching_cost(20)`.
  - **supply_concentration** (≤50): roster-derived step on the # of OTHER suppliers in the same period-scoped category — `0→50, 1→35, 2→22, 3→12, 4→5, ≥5→0`. MERGES the former single_source flag + category_competition (the stored single-source flag contradicted the roster for ~91% of flagged suppliers AND double-counted with competition).
  - **cost_premium** (≤25): period-scoped item-price premium. Per item, benchmark = spend-weighted avg unit price across ALL its suppliers; supplier premium = its spend-weighted avg unit price / item_avg − 1, counted ONLY when supplier×item ≥2 POs AND the item has ≥2 suppliers (single-source items → neutral); `clip(premium × 62.5, 0, 25)`; at/below market → 0.
  - **import_friction** (≤25): Indonesia trade-agreement coverage (NOT geographic distance) — `ID→0 / AFTA→8 / RCEP-non-ASEAN (JP,KR,CN,AU,NZ)→16 / else→25` (explicit safe default).
  - ⚠️ Emitted as `risk_components` per `quadrant_assignment` (each 2dp; total == `supply_risk_score`, reconciles with the detail-panel breakdown bars). ⚠️ DISTINCT from the **performance composite's `risk_score` sub-score** (`scores.py`, now `100 − (0.6·country_distance + 0.4·roster_concentration)` — structural only, NO complaints, NO single_source; changed in `aca864c`) — same word "risk", different metric; don't conflate. Both share the roster-concentration signal.
- **Kraljic quadrants** = median split on `log_spend` × `supply_risk_score` (Strategic = hi/hi, Leverage = hi-spend/lo-risk, Bottleneck = lo-spend/hi-risk, Routine = lo/lo).
- **Performance score** = the composite. ⚠️ **UPDATED — now filter-live** (see the
  top session block): `compute_analyses` recomputes it from the filtered POs via
  `scores.build_window_metrics` per period/range (was: read `SupplierMetric.compositeScore`
  as-is, latest-snapshot for range). Single-year is byte-identical to the stored value.
- Per-period quadrant data lives in `AnalysisResult.kraljic`; `SupplierMetric.kraljicQuadrant` is a last-period-wins convenience snapshot (not period-accurate).
- **Quadrant colours** (anti-drift — resolved from `app/globals.css`, light / dark):
  Strategic `#ef4444` / `#f87171` (red), Leverage `#10b981` / `#34d399` (green),
  Bottleneck `#f59e0b` / `#fbbf24` (amber), Routine `#3b82f6` / `#60a5fa` (blue).
  ⚠️ The `routine_risk` synthesis card (`lib/supplier-classification.ts`, Tailwind
  classes) matches `--quadrant-routine` (blue) as of `3d0757a` — the other 3
  synthesis cards already echo their quadrant hues; keep all four aligned.

### Key files added in 11F
- `scripts/transform_dataset.py` — one-off dataset transformer (DQ fixes, seed 42).
- `scripts/migrate-period-tags.ts` — re-tag purchases by invoice year (reversible: `--by=pr`).
- `lib/report-config.ts` — `ReportConfig` type, defaults, filter helpers.
- `lib/range-analyses.ts` — `getRangeAnalyses()` cache-or-compute helper.
- `lib/suppliers.ts` — `getSupplierCategoryMap()` / `getCategories()`.
- `components/Reports/ReportDocument.tsx` — shared config + tone-driven report renderer.
- `components/Reports/CustomizeReportModal.tsx` — 5-layer + tone customization modal.
- `components/Reports/ReportGenerator.tsx` — modal launcher (single→persist, range→preview).
- `app/api/reports/generate-ephemeral/route.ts` — in-memory range report endpoint.
- `app/(dashboard)/reports/preview/page.tsx` — in-memory range report viewer.
- `prisma/migrations/.../add_range_cache_columns/` — nullable periodId + range columns.

### Critical gotchas
- **Manually-added suppliers are replaced by a full re-import (Batch 2).** The
  add-supplier card (`POST /api/suppliers`, one INSERT tagged to the LATEST
  period, no analyses recompute) writes a `Supplier` row that the bulk import's
  per-period delete-then-insert will wipe on the next re-import of that period.
  Inherent to delete-then-insert; manual adds are supplementary, the bulk import
  is the source of truth. Single-create reuses the shared
  validation/id-gen/mapper in `lib/supplier-import.ts`.
- **Manually-added purchases don't feed the cached scorecards until a reimport
  (Batch 3).** The add-purchase card (`POST /api/purchases`, one INSERT tagged to
  the PAYMENT-year period, no analyses recompute + no range-cache clear) writes a
  `Purchase` row so cached scores stay byte-identical. The new PO shows only in
  Purchase-derived LIVE views (Spend-Overview ranking spend, the supplier's
  spend-detail "All invoices") until a full reimport of its period recomputes the
  scorecards. ⚠️ The bulk import reads `total_value_usd` + all `*_days` verbatim
  from the file (the synthetic total is deliberately NOT qty×price); a manual add
  COMPUTES them via `lib/purchase-import.computeDerivedFields`
  (`total = round(qty×price, 2)`, cycle-days = exact date diffs).
- **Supplier edit/delete recomputes via `lib/recompute.ts`, but stored
  `SupplierMetric` scores lag until a reimport (Batch A).** `PATCH`/`DELETE
  /api/suppliers/[id]` + `POST /api/suppliers/batch-delete` mutate the `Supplier`
  row (edit also syncs denormalized `supplierName`/`category` on `Purchase` +
  `SupplierMetric`) then call `recomputeAllPeriods()` (the import recipe:
  `runComputeAnalyses` per period + clear the range cache — NOT the migrate-tags
  script). That refreshes the `AnalysisResult` cache and the pages' LIVE composite,
  so Spend/Classification/Process-Health/Action-Dashboard show correct new numbers.
  ⚠️ It does NOT rewrite the stored per-period `SupplierMetric` rows (only a full
  import does), so the two surfaces that read them — the evolution tab's sub-score
  sparklines and the spend-detail single-year "performance snapshot" — lag a
  country/category edit until a reimport. A name-only edit skips recompute
  (labels only). Delete is blocked if the supplier has any purchases (no orphans).
- **Purchase edit/delete recomputes globally — a supplier re-point moves BOTH
  suppliers automatically (Batch B).** `PATCH`/`DELETE /api/purchases/[id]` +
  `POST /api/purchases/batch-delete` mutate the `Purchase` row then call
  `recomputeAllPeriods()`. Because `compute_analyses` groups all purchases by
  `supplierExternalId` across every supplier, changing a purchase's supplier
  reattributes its spend/OTD/cycle/defect in one pass — the OLD supplier drops it,
  the NEW gains it, no per-supplier logic. Edit RECOMPUTES the derived fields
  (`total_value` + 5 cycle-days) via the shared `computeDerivedFields`, enforces
  date-ordering (no negative cycle days), and re-tags the payment-year period (a
  payment-date edit can move the PO across years — compute buckets by payment date
  regardless). Same stored-`SupplierMetric` lag as the supplier CRUD. The import
  page's Purchases table is client-side filtered + paginated (all 647 rows loaded,
  one page in the DOM). No delete block (a purchase can't orphan anything).
- **"Strategic" is now ONLY a Kraljic quadrant name** — the declared tier that
  also carried the name was removed entirely in `158849b`.
- **Prisma 7 `migrate dev` is interactive** (fails in non-interactive shells).
  Use `prisma migrate diff --from-config-datasource --to-schema ... --script` to
  author the SQL, then `prisma migrate deploy`.
- **The customization modal's focus-trap blocks browser automation** (eval/
  screenshot hang while open) — not a user-facing bug. Verify report flows via
  direct API fetch + `sessionStorage` + the preview page.
- **Old reports (pre-3c) without `config` in `metricsJson`** default to
  `standard` detail + all sections + `operational` tone (backward compat).
- **Old reports (pre-Batch-5) lack `cycle_framing: "monitoring"` in
  `metricsJson`.** Reports re-render from LIVE analyses, so the report detail
  page (`reports/[id]`) detects the missing marker and passes the stored
  `narratives.cycle_time` (legacy pre/post prose) as `legacyCycle` to
  `ReportDocument`, which renders it + a "legacy framing" note instead of the
  live monitoring view. Old reports are preserved as history, not back-filled.
- **Known synthetic-data note:** risk_score and single_source_risk were
  saturated until 3a; the transformer fixed them (risk ~19–90, ~20% single-source).

## Tech stack
- Next.js 16 (App Router) + TypeScript
- Prisma 7 + PostgreSQL (local)
- Tailwind v4 + shadcn/ui
- Recharts for charts
- bcrypt + iron-session for auth
- Python script computes analyses post-import

## Note on shadcn components
- `toast` was removed upstream; we use `sonner` for notifications instead
- `form` was pulled from the `new-york` style (base-nova ships an empty placeholder)
- All other components are standard shadcn defaults with Slate base color

## Architecture
- /app — Next.js pages and API routes (App Router)
- /lib — utilities (prisma.ts client singleton, session.ts edge-safe iron-session config, auth.ts helpers, calculation helpers)
- /components — reusable React components
- /hooks — React hooks
- /types — shared TypeScript types
- /prisma — schema and migrations
- /python — analysis compute scripts (called from API after import)
- /data/raw — original CSVs for seed/sample data

## Reference documents (read these as needed)
- `nextjs_build_plan.md` — full architecture, schema, phase-by-phase build plan
- `procurement_analytics_gameplan_technical.md` — analytical methodology (Parts 2-6 only; Part 1 is OBSOLETE Streamlit content, ignore it)
- `dataset_type_explainer.md` — data field meanings and provenance

## Auth pattern
- Hardcoded seeded users (admin + viewer roles)
- bcrypt for passwords, iron-session for sessions
- `proxy.ts` (Next.js 16 proxy convention — replaces the deprecated `middleware.ts`) protects all routes except /login, /api/auth/*, and static assets
- Admin: full access (import, generate reports, manage periods)
- Viewer: read-only access to dashboards and reports

### Auth architecture (Phase 4)
- `lib/prisma.ts` — shared PrismaClient singleton using the pg driver adapter (`new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) })`) with a `globalThis` HMR guard. Always import the generated client from `@/lib/generated/prisma/client`.
- `lib/session.ts` — edge-safe iron-session config: the `SessionData` type + `sessionOptions` only. NO Prisma import, so `proxy.ts` (Edge runtime) can import it safely.
- `lib/auth.ts` — Node-side auth helpers that DO use Prisma (`getSession`, `createSession`, `destroySession`, `requireAuth`, `requireAdmin`); re-exports `SessionData` from `lib/session.ts`.

## Critical scope rules — DO NOT VIOLATE
- ALL analyses use FIXED methodology — no parameter sliders
- ABC thresholds FIXED at 80%/95%
- Hypothesis test FIXED to Mann-Whitney U (now within `cycle_time`'s `period_comparison`)
- 2-decimal precision on ALL scores EVERYWHERE (composite, sub-scores, quadrant/zone table averages)
- Theme-aware tokens only — NO hardcoded hex; tints via `color-mix()`
- Period selector behavior preserved — period-scoped surfaces stay period-scoped across Range / 2024 / 2025 / 2026
- Reporting periods are metadata; data is filterable but analyses don't change
- Single organization (no multi-tenancy)
- No signup flow — all accounts seeded

## Conventions
- All API routes use Prisma with type-safe queries
- Use shadcn/ui components consistently
- Charts use Recharts (NOT matplotlib, chart.js, or d3)
- Forms use react-hook-form + zod
- Server Components by default; "use client" only when needed
- All routes auth-guarded except /login
- TypeScript strict mode
- Use cuid() for IDs (not uuid)

## Data flow for imports
1. User uploads ONE Excel file (.xlsx) via /import page
2. The Excel file must contain 3 sheets: "Suppliers", "Purchases", "SupplierMetrics"
3. Next.js API parses the file with the `xlsx` library, validates sheet structure with zod
4. Saves each sheet's rows to the corresponding Postgres table
5. After successful insert, API spawns Python script via child_process
6. Python reads data from Postgres, computes analyses
7. Python writes AnalysisResult rows back to Postgres (6 types: spend_overview, abc, performance_spend, kraljic, recommendations, cycle_time)
8. Frontend pages read AnalysisResult and display via Recharts

## Excel file schema
Single .xlsx with 3 sheets:
- Sheet "Suppliers": supplier_id, supplier_name, country, category, product_description  *(`tier` removed in `158849b`)*
- Sheet "Purchases": po_id, supplier_id, supplier_name, category, item_description, unit, quantity, unit_price_usd, total_value_usd, pr_date, po_date, delivery_date, invoice_date, payment_date, pr_to_po_days, po_to_delivery_days, delivery_to_invoice_days, invoice_to_payment_days, total_cycle_days, on_time_delivery, three_way_match_pass  *(`automation_period` removed in Batch 5)*
- Sheet "SupplierMetrics" (ENRICHED output): supplier_id, supplier_name, category, total_spend_usd, num_pos, avg_po_value_usd, avg_lead_time_days, avg_cycle_time_days, on_time_delivery_pct, three_way_match_pct, defect_rate_pct, complaint_count_annual, rfx_response_rate_pct, avg_response_time_days, single_source_risk, quality_score, delivery_score, service_score, process_score, risk_score, composite_score  *(`calculated_tier` + `tier_mismatch` removed; the raw input file drops the 6 score columns too)*

Sample data file: `data/raw/procurement_data.xlsx` (use for testing)

See `dataset_type_explainer.md` for type definitions and provenance.

## When uncertain
Default to the simpler implementation. Don't add features I didn't request.
Don't add real-time features. Don't add multi-org logic. Don't add charts I didn't ask for.
If you're about to make an architectural decision, ASK ME FIRST.
