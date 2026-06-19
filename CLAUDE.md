# Project: Procurement Analytics Web App

A full-stack Next.js web app for presenting mining procurement analytics from synthetic 
data. Multi-user with auth, single organization, fixed analyses (no parameter tweaking).

## Current Work

Phase 11 (Kraljic rebuild) and Phase 11F (UX refinements) are complete through
**Batch 3d**. **Phase 11F Batch 4 is next** (Top 10 category filter on Overview
page). Phase 10 polish follows. Latest commit: **3b2b0c2 (Batch 3d)**.

6 analytical pages live: Overview, ABC, Supplier Quadrant (Kraljic), Performance
vs Spend, Cycle Time, Action Dashboard (+ Reports, Methodology).

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
- Sheet "Purchases": po_id, supplier_id, supplier_name, category, item_description, unit, quantity, unit_price_usd, total_value_usd, pr_date, po_date, delivery_date, invoice_date, payment_date, pr_to_po_days, po_to_delivery_days, delivery_to_invoice_days, invoice_to_payment_days, total_cycle_days, on_time_delivery, three_way_match_pass, automation_period
- Sheet "SupplierMetrics": supplier_id, supplier_name, category, tier, total_spend_usd, num_pos, avg_po_value_usd, avg_lead_time_days, avg_cycle_time_days, on_time_delivery_pct, three_way_match_pct, defect_rate_pct, complaint_count_annual, rfx_response_rate_pct, avg_response_time_days, single_source_risk, quality_score, delivery_score, service_score, process_score, risk_score, composite_score, calculated_tier, tier_mismatch

Sample data file: `data/raw/procurement_data.xlsx` (use for testing)

See `dataset_type_explainer.md` for type definitions and provenance.

## When uncertain
Default to the simpler implementation. Don't add features I didn't request.
Don't add real-time features. Don't add multi-org logic. Don't add charts I didn't ask for.
If you're about to make an architectural decision, ASK ME FIRST.
