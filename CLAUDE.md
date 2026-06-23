# Project: Procurement Analytics Web App

A full-stack Next.js web app for presenting mining procurement analytics from synthetic 
data. Multi-user with auth, single organization, fixed analyses (no parameter tweaking).

## Current Work

Phase 11F + Batch 6 (6a–6d: report editor sidebar, chart interactions,
navigation/section polish, pills + presets) are fully shipped. **On top of that:
Spend Overview redesign + polish + Supplier Evolution, and ABC merged into Spend
Overview.** **Next: Phase 10 polish** (loading states, error boundaries, mobile
responsive, README, smoke test) → **v1.0 tag**.

5 analytical pages live (ABC merged into Spend Overview): Spend Overview,
Supplier Quadrant (Kraljic), Performance vs Spend, Cycle Time (process-health
monitoring), Action Dashboard (+ Reports, Methodology). `/` → `/spend-overview`;
`/abc-analysis` → `/spend-overview` (both redirects).

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
  category/tier — period/range-accurate. ⚠️ NOT from `spend_overview.top_suppliers`
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
- ⚠️ **Performance trajectory is flat by design** — `performance_score` is
  `SupplierMetric.compositeScore`, a per-supplier snapshot that doesn't vary by
  period (e.g. 76.0 in both 2024 and 2025). The chart is ready for varying data.
- **Panel header badges (ABC class, Kraljic quadrant) are LATEST-period** — a
  stable strategic descriptor, intentionally NOT period-scoped; the Evolution tab
  shows the full per-year trajectory.
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
  collapse chevrons, KPI sparklines, tab switcher, tier chips). `/reports/[id]`
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
- **Tier names are `Core` / `Established` / `Standard`** (renamed in 3a from
  Strategic/Preferred/Approved). ⚠️ **"Strategic" still exists as a Kraljic
  QUADRANT name** — tier-Strategic and quadrant-Strategic are two distinct
  contexts; never conflate them in grep/replace.
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
  (period, sections, recommendation filters, detail level, tier/category filters
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
  `data/raw/procurement_data.xlsx` (tier rename + risk_score/single_source fixes).

### Kraljic decisions (from Phase 11)
- **Supply Risk Score** = `single_source(30) + category_competition(30) + country_distance(20) + switching_cost(20)`, clipped to 100.
- **Kraljic quadrants** = median split on `log_spend` × `supply_risk_score` (Strategic = hi/hi, Leverage = hi-spend/lo-risk, Bottleneck = lo-spend/hi-risk, Routine = lo/lo).
- **Performance score** = `SupplierMetric.compositeScore` (used as-is; not recomputed per range).
- Per-period quadrant data lives in `AnalysisResult.kraljic`; `SupplierMetric.kraljicQuadrant` is a last-period-wins convenience snapshot (not period-accurate).

### Key files added in 11F
- `scripts/transform_dataset.py` — one-off dataset transformer (tier rename + DQ fixes, seed 42).
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
- **"Strategic" = tier (now `Core`) AND Kraljic quadrant (unchanged).** Any
  grep/replace MUST distinguish context.
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
- Clustering k FIXED at 4
- Hypothesis test FIXED to Mann-Whitney U
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
7. Python writes AnalysisResult rows back to Postgres (4 rows: spend_overview, abc, clustering, hypothesis)
8. Frontend pages read AnalysisResult and display via Recharts

## Excel file schema
Single .xlsx with 3 sheets:
- Sheet "Suppliers": supplier_id, supplier_name, country, category, product_description, tier
- Sheet "Purchases": po_id, supplier_id, supplier_name, category, item_description, unit, quantity, unit_price_usd, total_value_usd, pr_date, po_date, delivery_date, invoice_date, payment_date, pr_to_po_days, po_to_delivery_days, delivery_to_invoice_days, invoice_to_payment_days, total_cycle_days, on_time_delivery, three_way_match_pass  *(`automation_period` removed in Batch 5)*
- Sheet "SupplierMetrics": supplier_id, supplier_name, category, tier, total_spend_usd, num_pos, avg_po_value_usd, avg_lead_time_days, avg_cycle_time_days, on_time_delivery_pct, three_way_match_pct, defect_rate_pct, complaint_count_annual, rfx_response_rate_pct, avg_response_time_days, single_source_risk, quality_score, delivery_score, service_score, process_score, risk_score, composite_score, calculated_tier, tier_mismatch

Sample data file: `data/raw/procurement_data.xlsx` (use for testing)

See `dataset_type_explainer.md` for type definitions and provenance.

## When uncertain
Default to the simpler implementation. Don't add features I didn't request.
Don't add real-time features. Don't add multi-org logic. Don't add charts I didn't ask for.
If you're about to make an architectural decision, ASK ME FIRST.
