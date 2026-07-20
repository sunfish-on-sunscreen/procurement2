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

# ARCHITECTURE MAP §0–§1 — Repo Topology & Data Layer

> Evidence-backed. Every behavioural claim cites `path/file.ext:line` and quotes the real code.
> Scope: the 38 files assigned to this section (config, entry points, auth wiring, Prisma client,
> Python boundary, period/range model, full schema + all 11 migrations, seed, migrate-tags,
> `lib/analysis-types.ts`). Deep Python formulas belong to §6 — here we cite only the compute boundary.

---

## §0 REPO TOPOLOGY

### 0.1 Source directory tree (top-level source dirs)

| Dir | What lives there (one line) |
|---|---|
| `app/` | Next.js 16 App Router. Route groups: `app/(dashboard)/*` (auth-guarded analytical pages + `layout.tsx`), `app/login/*` (public sign-in), `app/api/*` (route handlers). Root `app/layout.tsx` + `app/globals.css`. |
| `lib/` | Server + client utilities: `prisma.ts` (client singleton), `session.ts`/`auth.ts` (auth), `python.ts` (Node→Python spawn), `recompute.ts`, `range-analyses.ts`, `period.ts`/`period-constants.ts`, `suppliers.ts`, `countries.ts`, `analysis-types.ts` (the `resultJson` shapes), plus `lib/generated/prisma/` (generated client — see `schema.prisma:6` `output = "../lib/generated/prisma"`). |
| `components/` | Reusable React components (Sidebar, Header, Reports/*, SpendOverview/*, SupplierClassification/*, charts, ui/*). Consumed by `app/(dashboard)/layout.tsx:3-5`. (Not assigned to this section — referenced only.) |
| `python/` | Analysis compute scripts spawned from Node: `compute_analyses.py` (Mode A per-period + Mode B range → `AnalysisResult`), `import_compute.py` (raw rows → per-period `SupplierMetric`), `scores.py`, tests. ESLint-ignored (`eslint.config.mjs:16`). |
| `prisma/` | `schema.prisma` (10 models, 2 enums), `migrations/` (11 dirs), `seed.ts`. |
| `scripts/` | One-off maintenance TS: `migrate-period-tags.ts` (re-tag purchases by payment/PR year), plus `transform_dataset.py` etc. (only `migrate-period-tags.ts` assigned here). |
| `data/raw/` | Source `.xlsx` workbooks for seed/sample import (per CLAUDE.md; not assigned). |

### 0.2 Entry points — how the app boots

**Root layout** `app/layout.tsx:20-33` — the single `<html>`/`<body>` shell, wraps every route (login + dashboard):
```
export default function RootLayout({ children }: Readonly<{ children: React.ReactNode; }>) {
  return (
    <html lang="en" className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}>
      <body className="min-h-full flex flex-col">{children}</body>
```
Also exports page metadata `app/layout.tsx:15-18` (`title: "Procurement Analytics"`). Fonts: Geist + Geist_Mono via `next/font/google` (`:5-13`).

**Dashboard layout** `app/(dashboard)/layout.tsx:7-37` — an `async` server component that gates access and builds the chrome:
```
const session = await requireAuth();            // :12 — redirect to /login if unauth
const periods = await getAllPeriods();          // :13
const selection = await getCurrentPeriodSelection(); // :14
```
Renders `<Sidebar role={session.role} />` (`:23`), `<Header user periods selection />` (`:25-29`), and `<main>{children}</main>` (`:30-32`) plus `<Toaster />` (`:34`). So EVERY `(dashboard)` page is server-side auth-guarded before render, independent of `proxy.ts`.

**Login route group** — `app/login/layout.tsx:6-10` is a bare centering shell (`flex min-h-screen ... items-center justify-center bg-muted`), no auth. `app/login/page.tsx:27-115` is a `"use client"` form (react-hook-form + zodResolver, schema `email`+`password≥6` at `:20-23`). On submit it POSTs `/api/auth/login` (`:43-47`); on `res.ok` it `router.push("/")` + `router.refresh()` (`:50-51`) — landing on `/` which redirects to `/spend-overview` (see §0.7). Server errors surfaced via `setServerError` (`:55-56`).

### 0.3 Auth wiring

**`proxy.ts`** (Next 16 proxy convention, replaces `middleware.ts`) — edge-runtime route protection:
```
export async function proxy(request: NextRequest) {           // :6
  const response = NextResponse.next();
  const session = await getIronSession<SessionData>(request, response, sessionOptions); // :8-12
  if (!session.userId) {                                       // :14
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    return NextResponse.redirect(loginUrl);                    // :17
  }
  return response;
}
```
Protected-route matcher `proxy.ts:26-28`:
```
matcher: [ "/((?!login|api/auth|_next/static|_next/image|favicon.ico|.*\\..*).*)" ],
```
→ protects everything EXCEPT `/login`, `/api/auth/*`, Next internals, `favicon.ico`, and any path with a dot (static assets). NOTE the negative lookahead only excludes `api/auth`; other `/api/*` routes ARE matched by proxy (redirected to `/login` when unauth). Only the `userId` presence is checked here — role is NOT enforced in proxy (role gating is in `requireAdmin`, §0.3 below).

**`lib/session.ts`** — edge-safe iron-session config, NO Prisma import (so proxy's Edge runtime can import it). Session shape `session.ts:7-12`:
```
export interface SessionData { userId: string; email: string; name: string; role: "ADMIN" | "VIEWER"; }
```
Cookie config `session.ts:14-24`: `cookieName: "procurement_session"`, `password: process.env.SESSION_SECRET`, `httpOnly:true`, `secure: process.env.NODE_ENV !== "development"` (`:20` — false in dev over http), `sameSite:"lax"`, `maxAge: 60*60*24*7` (7 days).

**`lib/auth.ts`** — Node-side helpers (DO import Prisma):
| Fn | Line | Behaviour |
|---|---|---|
| `getSession()` | `:13-27` | Reads iron-session cookie; returns `null` if no `session.userId` (`:17`), else the 4-field payload. |
| `createSession(userId)` | `:33-51` | Verifies user exists (`:34-37`), inserts a `Session` row with 7-day `expiresAt` (`:39-41`), then writes the encrypted cookie fields + `session.save()` (`:44-50`). |
| `destroySession()` | `:57-66` | `prisma.session.deleteMany({ where: { userId } })` (`:62`) then `session.destroy()` (`:65`). |
| `requireAuth()` | `:71-77` | `redirect("/login")` if no session (`:73-74`); else returns `SessionData`. Used by dashboard layout. |
| `requireAdmin()` | `:82-88` | `requireAuth()` then `redirect("/")` if `role !== "ADMIN"` (`:84-85`). |

**Login flow (end-to-end):** `app/api/auth/login/route.ts:12-46` — zod-validate body (`loginSchema` `:7-10`, invalid → 400 `:18`), `prisma.user.findUnique({where:{email}})` (`:23`, missing → 401 `:25-28`), `bcrypt.compare(password, user.passwordHash)` (`:31`, mismatch → 401 `:33-36`), then `await createSession(user.id)` (`:39`) → 200 `{success:true}`. Errors → 500 `:42-44`.

**Logout flow:** `app/api/auth/logout/route.ts:4-12` — `POST` calls `destroySession()` (`:6`) → `{success:true}`; error → 500 `:9-10`. (No body/CSRF token; relies on the httpOnly cookie.)

### 0.4 Prisma client instantiation

`lib/prisma.ts` — single client via the pg driver adapter with a `globalThis` HMR guard:
```
const globalForPrisma = globalThis as unknown as { prisma: PrismaClient | undefined }; // :4-6
function createPrismaClient(): PrismaClient {
  const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });        // :9-11
  return new PrismaClient({ adapter });                                                // :12
}
export const prisma = globalForPrisma.prisma ?? createPrismaClient();                  // :15
if (process.env.NODE_ENV !== "production") { globalForPrisma.prisma = prisma; }        // :17-19
```
`PrismaClient` imported from the generated path `@/lib/generated/prisma/client` (`:2`), matching `schema.prisma:4-7` (`generator client { provider = "prisma-client"; output = "../lib/generated/prisma" }`). The HMR guard caches on `globalThis` only in non-production so dev hot-reload doesn't leak connections.

`prisma.config.ts:6-15` — `defineConfig({ schema: "prisma/schema.prisma", migrations: { path, seed: "tsx prisma/seed.ts" }, datasource: { url: process.env["DATABASE_URL"] } })`, with `import "dotenv/config"` (`:3`) loading `.env`. `datasource db` in `schema.prisma:9-11` declares `provider = "postgresql"` with NO inline `url` — the URL comes from `prisma.config.ts` (CLI) and from `PrismaPg` at runtime (`lib/prisma.ts:10`).

### 0.5 Python invocation boundary (`lib/python.ts`)

Node spawns Python via `child_process.spawn` (`:1`). Interpreter resolution `python.ts:15-25`: prefer project venv `python/.venv/Scripts/python.exe` (Windows) or `.../bin/python` (else) if it exists, otherwise `"python"` (Win) / `"python3"`.

Generic spawn `runScript(args, timeoutMs?)` `python.ts:27-58` runs `python/compute_analyses.py`:
```
const script = path.join(root, "python", "compute_analyses.py");                 // :30
const child = spawn(resolvePythonExecutable(), [script, ...args], { cwd: root, detached: false, stdio: "pipe" }); // :31-35
```
Optional timeout kills the child and appends `[python killed after Nms timeout]` to stderr (`:40-45`). Resolves `{code, stdout, stderr}` on close (`:53-57`); `code:-1` on spawn error (`:49-52`). **No explicit env is passed** — the child inherits `process.cwd()`-scoped env from Node (so `DATABASE_URL` reaches Python via the parent process environment, NOT an explicit `env:` option). [INFERRED: DATABASE_URL reaches Python by process inheritance — confirm by reading `python/compute_analyses.py`'s env read; CLAUDE.md notes standalone Python must read `DATABASE_URL` with `encoding="utf-8-sig"` due to a `.env` BOM, but Node-spawned runs get it from the inherited environment.]

Exported spawn wrappers:
| Export | Line | Args passed | Timeout |
|---|---|---|---|
| `runComputeAnalyses(periodId, timeoutMs?)` | `:66-68` | `["--period-id", periodId]` (Mode A: compute+upsert per-period `AnalysisResult`) | caller-supplied (import omits it) |
| `runComputeRange(startDate, endDate, timeoutMs=30000)` | `:71-77` | `["--start-date", startDate, "--end-date", endDate]` (Mode B: range JSON on stdout) | default 30s |
| `runImportCompute(payload, timeoutMs=60000)` | `:112-157` | spawns `python/import_compute.py` (`:118`), pipes `{suppliers,purchases}` JSON on **stdin** (`:154-155`), reads `ComputedMetricRow[]` JSON on stdout (`:148`) | default 60s |

`runImportCompute` returns `{code, rows: ComputedMetricRow[] | null, stderr}`; `rows:null` with non-zero `code` on ANY failure (Python error, timeout, or JSON parse fail `:143-151`) so the caller aborts the import BEFORE any DB write. `ComputedMetricRow` shape declared `python.ts:84-102` (18 fields: identity `supplier_id/supplier_name/country/category/period` + aggregates + 5 scores + `composite_score`).

> DIVERGENCE (code-vs-task): the task brief names `runCycleCompare` as a spawn to document. **It does NOT exist in `lib/python.ts`** — the only exports are `runComputeAnalyses`, `runComputeRange`, `runImportCompute`. CLAUDE.md confirms `runCycleCompare` + `/api/analyses/cycle-compare` were DELETED (Cycle Time overhaul, "Period-vs-Period Comparison REMOVED (`6fc1339`)"). No cycle-compare spawn remains. [Verified by full read of `lib/python.ts` — no such symbol.]

**`lib/recompute.ts`** — `recomputeAllPeriods()` `:26-49`, the ONLY sanctioned recompute path after a data change. `RECOMPUTE_PERIOD_TIMEOUT_MS = 60_000` (`:6`). It finds every `reportingPeriod` (`:30`), runs `runComputeAnalyses(period.id, RECOMPUTE_PERIOD_TIMEOUT_MS)` SEQUENTIALLY (`:33-39`), collecting failures by name. Only on full success does it clear the range cache:
```
if (failedPeriods.length === 0) { await prisma.analysisResult.deleteMany({ where: { periodId: null } }); } // :44-46
return { ok: failedPeriods.length === 0, failedPeriods };                                                   // :48
```
On partial failure the range cache is deliberately NOT cleared (docstring `:22-24`), so range views keep serving the last good cache.

**`lib/range-analyses.ts`** — `getRangeAnalyses(startDate, endDate)` `:21-80`, cache-or-compute for the six range analyses. `RANGE_TYPES` (6) at `:7-14` (`spend_overview, abc, cycle_time, performance_spend, kraljic, recommendations`). Cache read `:28-39`: query `analysisResult.findMany({ where: { rangeStartDate, rangeEndDate } })`, return the map if all 6 present (`:32-38`). On miss → `runComputeRange(startDate, endDate, 30000)` (`:41`), fail → log+`null` (`:42-45`), non-JSON stdout → `null` (`:46-52`), then `upsert` each present type into the range cache via the `rangeStartDate_rangeEndDate_analysisType` unique key (`:54-77`) and return the parsed data (`:79`).

### 0.6 Period / range model

**`lib/period-constants.ts`** (client-safe, no server imports `:1-4`): `PERIOD_COOKIE = "period_selection"` (`:5`), `type PeriodMode = "single" | "range"` (`:7`), `type PeriodSelection = { mode; singleId; fromId; toId }` (`:9-14`).

**`lib/period.ts`**:
| Fn | Line | Behaviour |
|---|---|---|
| `getAllPeriods()` | `:10-14` | `reportingPeriod.findMany({ orderBy: { startDate: "desc" } })` — most-recent-first. |
| `getCurrentPeriodSelection()` | `:26-59` | **Default landing = RANGE over all years.** Fallback `:33-38`: `{ mode:"range", singleId:latest, fromId:oldest, toId:latest }`; `if (!raw) return fallback` (`:42`) when no cookie. Malformed/stale cookie → fallback (`:47-50`); valid ids re-validated against the period set (`:52-58`). |
| `getDateRangeFromSelection(selection)` | `:65-81` | single → that period's `{startDate,endDate}` (`:71-73`); range → the chronological span of `from`/`to` (`:76-80`), `null` if referenced periods missing. |
| `resolveAnalysisSource(selection)` | `:97-128` | Returns `AnalysisSource` (`:83-86`): `{kind:"empty"}` when no periods (`:101`); single OR range-with-`from===to` → `{kind:"cached", periodId, periodLabel}` (`:104-119`); range with distinct ends → `{kind:"range", startDate, endDate, periodLabel:"A–B"}` (`:121-127`, dates via `toIsoDate` `:88-90` = UTC `YYYY-MM-DD`). |

Quoted default-landing fallback (`period.ts:33-38`):
```
const fallback: PeriodSelection = { mode: "range", singleId: latest, fromId: oldest, toId: latest };
```

**`lib/suppliers.ts`**:
| Fn | Line | Query |
|---|---|---|
| `getSupplierCategoryMap()` | `:8-15` | `supplier.findMany({ select:{externalId,category} })` → `Record<externalId,category>`. |
| `getSupplierDirectory()` | `:28-53` | `Promise.all([ supplier.findMany({select:{externalId,country}, distinct:["externalId"], orderBy:{periodId:"desc"}}), purchase.groupBy({by:["supplierExternalId"], _count:{_all:true}}) ])` → `{country, num_pos}`. ⚠ `num_pos` is ALL-TIME from `Purchase` (docstring `:22-27` — `SupplierMetric.numPos` is now per-period so it would understate). |
| `getCategories()` | `:56-63` | `supplier.findMany({select:{category}, distinct:["category"], orderBy:{category:"asc"}})`. |

**`lib/countries.ts`** — `countryName(code)` `:9-18`: lazy `Intl.DisplayNames(["en"], {type:"region"})` (`:13`), pinned to `"en"` for hydration-safe SSR/client parity; returns the uppercased code for unknown/blank (`:10`, `:14`, `:16`).

### 0.7 Redirect pages & the redirect reconciliation

- `app/(dashboard)/page.tsx:4-6` — `export default function Home() { redirect("/spend-overview"); }` (root `/` → Spend Overview).
- `app/(dashboard)/abc-analysis/page.tsx:5-7` — `export default function AbcAnalysisPage() { redirect("/spend-overview"); }` (ABC merged into Spend Overview).
- `next.config.ts:8-14` — the ONLY config-level redirect: `{ source:"/cycle-time", destination:"/process-health", permanent:true }`.

> RECONCILED: the `/` and `/abc-analysis` redirects live in **App Router pages** (`redirect()` calls), NOT in `next.config.ts`. `next.config.ts` holds only `/cycle-time → /process-health`. Comment `next.config.ts:6-8` explicitly notes the source matches the page URL exactly so it does NOT shadow `/api/cycle-time/*` routes. No overlap/conflict between the two mechanisms.

### 0.8 Config files (dense)

| File | Configures | Notable rule (quoted) |
|---|---|---|
| `next.config.ts` | Next.js config; async `redirects()` | `{ source:"/cycle-time", destination:"/process-health", permanent:true }` (`:9-13`). No other keys. |
| `prisma.config.ts` | Prisma CLI config | `schema: "prisma/schema.prisma"`, `migrations.seed: "tsx prisma/seed.ts"` (`:9-10`), `datasource.url: process.env["DATABASE_URL"]` (`:13`); `import "dotenv/config"` (`:3`). |
| `eslint.config.mjs` | Flat ESLint config | Spreads `nextVitals` + `nextTs` (`:6-7`), then `globalIgnores([".next/**","out/**","build/**","next-env.d.ts","python/**"])` (`:9-17`) — `python/**` ignored (incl. venv JS). NOTE: the CLAUDE.md-referenced "set-state-in-effect ban" is NOT a rule declared in this file — it comes from the spread `eslint-config-next` presets, not an explicit local rule. [INFERRED: the ban originates in `next/core-web-vitals` / `next/typescript` presets — confirm by inspecting `eslint-config-next` package.] |
| `postcss.config.mjs` | PostCSS/Tailwind v4 | `plugins: { "@tailwindcss/postcss": {} }` (`:2-4`) — sole plugin. |

---

## §1 DATA LAYER

Source of truth: `prisma/schema.prisma`. 10 models, 2 enums. **Field census: 97 scalar + 18 relation (verified by enumeration below).**

### 1.1 Enums

| Enum | Line | Members |
|---|---|---|
| `Role` | `schema.prisma:28-31` | `ADMIN`, `VIEWER` (User default `VIEWER` `:20`). |
| `ImportStatus` | `schema.prisma:158-163` | `PENDING`, `PROCESSING`, `SUCCESS`, `FAILED` (Import.status `:149`). |

### 1.2 Model-by-model field census

Consumers below are the pages/routes that read the field. Where a consumer is outside the assigned file set it is named from grep evidence and tagged accordingly.

#### User (`schema.prisma:15-26`) — 6 scalar + 3 relation
| Field | Type + modifiers (line) | Purpose | Consumed by |
|---|---|---|---|
| `id` | `String @id @default(cuid())` (`:16`) | PK | `login/route.ts:39` (`createSession(user.id)`), `auth.ts:34,40` |
| `email` | `String @unique` (`:17`) | login key | `login/route.ts:23` (`findUnique({where:{email}})`), `seed.ts:31` |
| `passwordHash` | `String` (`:18`) | bcrypt hash | `login/route.ts:31` (`bcrypt.compare`), `seed.ts` |
| `name` | `String` (`:19`) | display name | `auth.ts:48` (→ session), `seed.ts` |
| `role` | `Role @default(VIEWER)` (`:20`) | ADMIN/VIEWER gate | `auth.ts:49,84` (`requireAdmin`), dashboard `layout.tsx:23` |
| `createdAt` | `DateTime @default(now())` (`:21`) | audit | — (unread) |
| `sessions` | `Session[]` (relation `:23`) | back-relation | `auth.ts:62` (`deleteMany`) |
| `imports` | `Import[]` (relation `:24`) | back-relation | Import route [INFERRED] |
| `reports` | `ExecutiveSummary[]` (relation `:25`) | back-relation | Reports routes [INFERRED] |

#### Session (`schema.prisma:33-39`) — 4 scalar + 1 relation
| Field | Type + modifiers (line) | Purpose | Consumed by |
|---|---|---|---|
| `id` | `String @id @default(cuid())` (`:34`) | PK | — |
| `userId` | `String` (`:35`) | FK to User | `auth.ts:40,62` |
| `user` | `User @relation(fields:[userId], references:[id], onDelete: Cascade)` (`:36`) | owner | — |
| `expiresAt` | `DateTime` (`:37`) | 7-day expiry | `auth.ts:39-40` (set); no read/cleanup found [INFERRED: no expiry sweep — DB session rows accumulate] |
| `createdAt` | `DateTime @default(now())` (`:38`) | audit | — |

#### ReportingPeriod (`schema.prisma:43-57`) — 6 scalar + 6 relation
| Field | Type + modifiers (line) | Purpose | Consumed by |
|---|---|---|---|
| `id` | `String @id @default(cuid())` (`:44`) | PK | `period.ts` throughout, `recompute.ts:30`, `migrate-period-tags.ts:42` |
| `name` | `String @unique` (`:45`) | "2024"/"FY 2024" | `period.ts:109,116,126`, `migrate-period-tags.ts:34` (upsert by name) |
| `startDate` | `DateTime` (`:46`) | period start | `period.ts:11,73,79-80,121` (span resolution) |
| `endDate` | `DateTime` (`:47`) | period end | `period.ts:73,80` |
| `isLocked` | `Boolean @default(false)` (`:48`) | lock flag | — (declared, no reader found) [INFERRED unused] |
| `createdAt` | `DateTime @default(now())` (`:49`) | audit | — |
| `suppliers` | `Supplier[]` (`:51`) | back-relation | — |
| `purchases` | `Purchase[]` (`:52`) | back-relation | — |
| `metrics` | `SupplierMetric[]` (`:53`) | back-relation | — |
| `imports` | `Import[]` (`:54`) | back-relation | — |
| `analysisResults` | `AnalysisResult[]` (`:55`) | back-relation | — |
| `executiveSummaries` | `ExecutiveSummary[]` (`:56`) | back-relation | — |

#### Supplier (`schema.prisma:61-73`) — 6 scalar + 1 relation
| Field | Type + modifiers (line) | Purpose | Consumed by |
|---|---|---|---|
| `id` | `String @id @default(cuid())` (`:62`) | PK | supplier CRUD routes [grep] |
| `externalId` | `String` (`:63`) | "S001" catalog id | `suppliers.ts:10,33,57` |
| `supplierName` | `String` (`:64`) | name | supplier routes |
| `country` | `String` (`:65`) | ISO country | `suppliers.ts:34,48`; `countries.ts` renders it |
| `category` | `String` (`:66`) | procurement category | `suppliers.ts:10,58,61` |
| `periodId` | `String` (`:67`) | FK; catalog tagged to latest period | `suppliers.ts:36` (orderBy), `migrate-period-tags.ts:87` |
| `period` | `ReportingPeriod @relation(..., onDelete: Cascade)` (`:68`) | owner | — |
| _constraints_ | `@@unique([externalId, periodId])` (`:70`), `@@index([periodId])` (`:71`), `@@index([category])` (`:72`) | | |

#### Purchase (`schema.prisma:75-106`) — 25 scalar + 1 relation
| Field | Type + modifiers (line) | Purpose | Consumed by |
|---|---|---|---|
| `id` | `String @id @default(cuid())` (`:76`) | PK | `migrate-period-tags.ts:50,80` |
| `poId` | `String` (`:77`) | PO number | purchase routes |
| `supplierExternalId` | `String` (`:78`) | supplier link | `suppliers.ts:38-40` (groupBy) |
| `supplierName` | `String` (`:79`) | denormalized name | — |
| `category` | `String` (`:80`) | denormalized category | — |
| `itemName` | `String` (`:81`) | line item (renamed from `itemDescription` mig `20260707000000`) | spend-detail routes |
| `unit` | `String` (`:82`) | unit of measure | spend-detail |
| `quantity` | `Float` (`:83`) | qty | Python compute |
| `unitPriceUsd` | `Float` (`:84`) | unit price | Python compute |
| `totalValueUsd` | `Float` (`:85`) | line total | spend aggregates (Python + TS) |
| `prDate` | `DateTime` (`:86`) | requisition date | `migrate-period-tags.ts:50,61` (PR-tag fallback) |
| `poDate` | `DateTime` (`:87`) | PO date | cycle stages |
| `deliveryDate` | `DateTime` (`:88`) | delivery date | cycle stages |
| `invoiceDate` | `DateTime` (`:89`) | invoice date | cycle/anomaly display |
| `paymentDate` | `DateTime` (`:90`) | payment date → period tag basis | `migrate-period-tags.ts:61` (`paymentDate ?? prDate`) |
| `prToPoDays` | `Int` (`:91`) | stage duration | cycle_time |
| `poToDeliveryDays` | `Int` (`:92`) | stage duration | cycle_time |
| `deliveryToInvoiceDays` | `Int` (`:93`) | stage duration | cycle_time |
| `invoiceToPaymentDays` | `Int` (`:94`) | stage duration | cycle_time |
| `totalCycleDays` | `Int` (`:95`) | full cycle | cycle_time metric |
| `onTimeDelivery` | `Boolean` (`:96`) | OTD flag | delivery score |
| `threeWayMatchPass` | `Boolean` (`:97`) | 3WM flag | process score, control exposure |
| `defectCount` | `Int` (`:98`) | per-PO defects (mig `20260706130000`) | per-PO quality (Python) |
| `complaintCount` | `Int` (`:99`) | per-PO complaints (mig `20260706130000`) | per-PO quality (Python) |
| `periodId` | `String` (`:100`) | FK; payment-year tag | `migrate-period-tags.ts:81` |
| `period` | `ReportingPeriod @relation(..., onDelete: Cascade)` (`:101`) | owner | — |
| _constraints_ | `@@unique([poId, periodId])` (`:103`), `@@index([periodId])` (`:104`), `@@index([supplierExternalId, periodId])` (`:105`) | | |

#### SupplierMetric (`schema.prisma:108-136`) — 20 scalar + 1 relation
| Field | Type + modifiers (line) | Purpose | Consumed by |
|---|---|---|---|
| `id` | `String @id @default(cuid())` (`:109`) | PK | — |
| `supplierExternalId` | `String` (`:110`) | supplier link | delete routes (grep `route.ts:52`, `batch-delete:64`), spend-overview roster |
| `supplierName` | `String` (`:111`) | name | — |
| `category` | `String` (`:112`) | category | — |
| `totalSpendUsd` | `Float` (`:113`) | per-period spend | metrics readers |
| `numPos` | `Int` (`:114`) | per-period PO count (was all-time — see `suppliers.ts:22-27`) | — |
| `avgPoValueUsd` | `Float` (`:115`) | avg PO value | — |
| `avgLeadTimeDays` | `Float` (`:116`) | avg lead time | delivery score input |
| `avgCycleTimeDays` | `Float` (`:117`) | avg cycle | — |
| `onTimeDeliveryPct` | `Float` (`:118`) | OTD % | delivery score |
| `threeWayMatchPct` | `Float` (`:119`) | 3WM % | process score |
| `qualityScore` | `Float` (`:120`) | Quality sub-score | composite |
| `deliveryScore` | `Float` (`:121`) | Delivery sub-score | composite |
| `processScore` | `Float` (`:122`) | Process sub-score | composite |
| `riskScore` | `Float` (`:123`) | Risk sub-score | composite |
| `compositeScore` | `Float` (`:124`) | composite performance | performance zones, spend-detail snapshot |
| `supplyRiskScore` | `Float? @db.Real` (`:127`) | 0-100 Kraljic supply-risk (nullable) | written by Python `compute_analyses.py:1383` |
| `kraljicQuadrant` | `String? @db.VarChar(30)` (`:128`) | last-period-wins quadrant snapshot | written by Python `compute_analyses.py:1383` |
| `categoryCompetition` | `Int?` (`:129`) | count of other suppliers in category | ⚠ written by Python `compute_analyses.py:1383`, **read by NO TS code** (grep confirms) |
| `periodId` | `String` (`:131`) | FK | delete routes |
| `period` | `ReportingPeriod @relation(..., onDelete: Cascade)` (`:132`) | owner | — |
| _constraints_ | `@@unique([supplierExternalId, periodId])` (`:134`), `@@index([periodId])` (`:135`) | | |

#### Import (`schema.prisma:140-156`) — 10 scalar + 2 relation
| Field | Type + modifiers (line) | Purpose | Consumed by |
|---|---|---|---|
| `id` | `String @id @default(cuid())` (`:141`) | PK | import route |
| `userId` | `String` (`:142`) | uploader FK | import route |
| `user` | `User @relation(fields:[userId], references:[id])` (`:143`) — **no onDelete (RESTRICT)** | uploader | — |
| `periodId` | `String` (`:144`) | period FK | import route |
| `period` | `ReportingPeriod @relation(fields:[periodId], references:[id])` (`:145`) — **RESTRICT** | period | — |
| `filename` | `String` (`:146`) | uploaded filename | import UI |
| `fileType` | `String` (`:147`) | 'suppliers' \| 'purchases' \| 'supplier_metrics' | import route |
| `rowCount` | `Int` (`:148`) | rows parsed | import route |
| `status` | `ImportStatus` (`:149`) | PENDING…FAILED | import route |
| `errorMessage` | `String?` (`:150`) | failure reason | import route |
| `uploadedAt` | `DateTime @default(now())` (`:151`) | audit | `@@index` |
| `processedAt` | `DateTime?` (`:152`) | completion time | import route |
| _constraints_ | `@@index([periodId])` (`:154`), `@@index([uploadedAt])` (`:155`) | | |

#### AnalysisResult (`schema.prisma:167-187`) — 7 scalar + 1 relation
| Field | Type + modifiers (line) | Purpose | Consumed by |
|---|---|---|---|
| `id` | `String @id @default(cuid())` (`:168`) | PK | — |
| `periodId` | `String?` (`:171`) — nullable (mig `20260618120000`) | single-year rows set it | `analysis-types.ts:338-340` (`getAnalysisResult`), `recompute.ts:45` (`periodId:null` clear) |
| `period` | `ReportingPeriod? @relation(..., onDelete: Cascade)` (`:172`) | period | — |
| `rangeStartDate` | `DateTime?` (`:174`) | range cache key | `range-analyses.ts:29,58,71` |
| `rangeEndDate` | `DateTime?` (`:175`) | range cache key | `range-analyses.ts:29,59,72` |
| `analysisType` | `String` (`:177`) | one of the 6 types | `range-analyses.ts`, `analysis-types.ts:339` |
| `resultJson` | `Json` (`:178`) | the shaped payload (see §1.5) | all analysis readers |
| `computedAt` | `DateTime @default(now())` (`:179`) | cache timestamp | `range-analyses.ts:66,74` |
| _constraints_ | `@@unique([periodId, analysisType])` (`:183`), `@@unique([rangeStartDate, rangeEndDate, analysisType])` (`:184`), `@@index([periodId])` (`:185`), `@@index([rangeStartDate, rangeEndDate])` (`:186`) | two separate uniques so NULLs don't defeat uniqueness (comment `:181-182`) | |

#### ExecutiveSummary (`schema.prisma:191-203`) — 7 scalar + 2 relation
| Field | Type + modifiers (line) | Purpose | Consumed by |
|---|---|---|---|
| `id` | `String @id @default(cuid())` (`:192`) | PK | reports/[id] |
| `periodId` | `String` (`:193`) | period FK | reports route |
| `period` | `ReportingPeriod @relation(fields:[periodId], references:[id])` (`:194`) — **RESTRICT** | period | — |
| `title` | `String` (`:195`) | report title | reports UI |
| `narrative` | `String @db.Text` (`:196`) | stored prose (now a stub — reports render live per CLAUDE.md) | reports/[id] legacy path |
| `metricsJson` | `Json` (`:197`) | `{config, cycle_framing}` | reports render |
| `createdAt` | `DateTime @default(now())` (`:198`) | audit | reports list |
| `generatedBy` | `String` (`:199`) | author User id | reports route |
| `generatedByUser` | `User @relation(fields:[generatedBy], references:[id])` (`:200`) — **RESTRICT** | author | — |
| _constraints_ | `@@index([periodId])` (`:202`) | | |

#### ReportPreset (`schema.prisma:211-220`) — 6 scalar + 0 relation — **ORPHANED**
| Field | Type + modifiers (line) | Purpose | Consumed by |
|---|---|---|---|
| `id` | `String @id @default(cuid())` (`:212`) | PK | **NONE** |
| `name` | `String` (`:213`) | preset name | **NONE** |
| `config` | `Json` (`:214`) | saved ReportConfig | **NONE** |
| `createdBy` | `String?` (`:215`) | author id (no FK relation — comment `:207-210`) | **NONE** |
| `createdAt` | `DateTime @default(now())` (`:216`) | audit | **NONE** |
| `updatedAt` | `DateTime @updatedAt` (`:217`) | audit | **NONE** |
| _constraints_ | `@@index([createdBy])` (`:219`) | | |

> ORPHAN CONFIRMED: grep for the Prisma runtime accessor `prisma.reportPreset` / `.reportPreset.` → **"No matches found"**. `ReportPreset` (PascalCase) appears ONLY in `schema.prisma`, the migration SQL, `CLAUDE.md`, `ARCHITECTURE_MAP_00_INVENTORY.md`, and the stale `dashboard_audit_meeting_prep.md` — never in a `.ts/.tsx` code path. The model + its table survive (`add_report_preset` migration) but nothing reads or writes them; CLAUDE.md KNOWN OPEN ITEMS lists it as "NOT YET DROPPED; harmless". Matches the CLAUDE.md claim that the Saved-views UI + `/api/report-presets` routes were deleted in the report-panel rebuild.

**Field-count tally:** 6+4+6+6+25+20+10+7+7+6 = **97 scalar**; 3+1+6+1+1+1+2+1+2+0 = **18 relation**. Matches the spec.

### 1.3 Relation diagram (FKs + cascade)

```
User (1)───< Session          Session.userId → User.id            ON DELETE CASCADE   (schema:36 / init.sql:206)
User (1)───< Import           Import.userId → User.id             ON DELETE RESTRICT  (schema:143 / init.sql:218)
User (1)───< ExecutiveSummary ExecutiveSummary.generatedBy → User.id  ON DELETE RESTRICT (schema:200 / init.sql:230)

ReportingPeriod (1)───< Supplier        Supplier.periodId        → RP.id  CASCADE   (schema:68  / init.sql:209)
ReportingPeriod (1)───< Purchase        Purchase.periodId        → RP.id  CASCADE   (schema:101 / init.sql:212)
ReportingPeriod (1)───< SupplierMetric  SupplierMetric.periodId  → RP.id  CASCADE   (schema:132 / init.sql:215)
ReportingPeriod (1)───< Import          Import.periodId          → RP.id  RESTRICT  (schema:145 / init.sql:221)
ReportingPeriod (1)───< AnalysisResult  AnalysisResult.periodId? → RP.id  CASCADE   (schema:172 / init.sql:224)
ReportingPeriod (1)───< ExecutiveSummary ExecutiveSummary.periodId → RP.id RESTRICT (schema:194 / init.sql:227)

ReportPreset : NO relations (createdBy is a bare nullable String, no FK — schema:207-215)
```
Cascade summary: deleting a User cascades its Sessions but is BLOCKED (RESTRICT) if it has Imports or ExecutiveSummaries. Deleting a ReportingPeriod cascades Supplier/Purchase/SupplierMetric/AnalysisResult but is BLOCKED if Imports or ExecutiveSummaries reference it. (All FK `ON UPDATE CASCADE` per `init.sql`.)

### 1.4 Migrations in date order (11 dirs)

| # | Migration | Key DDL (quoted) | Net effect |
|---|---|---|---|
| 1 | `20260609073556_init` | `CREATE TYPE "Role"...`, `CREATE TYPE "ImportStatus"...`, 8 `CREATE TABLE`s + FKs | Full initial schema. Supplier had `productDescription`+`tier` (`:48-49`); Purchase had `itemDescription`+`automationPeriod` (`:62,79`); SupplierMetric had `tier, defectRatePct, complaintCountAnnual, rfxResponseRatePct, avgResponseTimeDays, singleSourceRisk, serviceScore, calculatedTier, tierMismatch` (`:91,99-111`); AnalysisResult.periodId `NOT NULL` (`:136`), no range cols. |
| 2 | `20260610073918_drop_seeded_periods` | `TRUNCATE TABLE "Supplier","Purchase","SupplierMetric","Import","AnalysisResult","ReportingPeriod" RESTART IDENTITY CASCADE;` (`:5-12`) | Destructive wipe — periods now auto-created on import. |
| 3 | `20260612070717_add_kraljic_fields` | `ALTER TABLE "SupplierMetric" ADD COLUMN "categoryCompetition" INTEGER, ADD COLUMN "kraljicQuadrant" VARCHAR(30), ADD COLUMN "supplyRiskScore" REAL;` (`:2-4`) | Nullable Kraljic layer. |
| 4 | `20260618120000_add_range_cache_columns` | `ALTER TABLE "AnalysisResult" ADD COLUMN "rangeEndDate"..., ADD COLUMN "rangeStartDate"..., ALTER COLUMN "periodId" DROP NOT NULL;` (`:2-4`) + range unique/index (`:7,10`) | Enables range-cache rows (periodId null). |
| 5 | `20260619212920_remove_automation_period` | `DROP INDEX "Purchase_automationPeriod_idx";` (`:2`) + `ALTER TABLE "Purchase" DROP COLUMN "automationPeriod";` (`:5`) | Batch-5 cycle reframe. |
| 6 | `20260621120000_add_report_preset` | `CREATE TABLE "ReportPreset" (...)` (`:2-11`) + `CREATE INDEX "ReportPreset_createdBy_idx"` (`:14`) | **Orphaned table** (see §1.2). |
| 7 | `20260626000000_remove_tier_mismatch` | `ALTER TABLE "SupplierMetric" DROP COLUMN "calculatedTier"; ... DROP COLUMN "tierMismatch";` (`:2-3`) | Tier-mismatch rip-out. |
| 8 | `20260630000000_remove_tier` | `ALTER TABLE "Supplier" DROP COLUMN "tier"; ALTER TABLE "SupplierMetric" DROP COLUMN "tier";` (`:2-3`) | Declared tier removed entirely. |
| 9 | `20260706120000_drop_product_description` | `ALTER TABLE "Supplier" DROP COLUMN "productDescription";` (`:2`) | Ghost column dropped. |
| 10 | `20260706130000_perpo_quality_drop_service_soft` | `ALTER TABLE "Purchase" ADD COLUMN "defectCount"... DEFAULT 0 ... DROP DEFAULT;` + `ADD COLUMN "complaintCount"...`; then `DROP COLUMN` ×6 on SupplierMetric: `defectRatePct, complaintCountAnnual, rfxResponseRatePct, avgResponseTimeDays, singleSourceRisk, serviceScore` (`:4-15`) | Per-PO quality inputs added; Service dim + soft-survey inputs removed. |
| 11 | `20260707000000_rename_item_description_to_item_name` | `ALTER TABLE "Purchase" RENAME COLUMN "itemDescription" TO "itemName";` (`:4`) | Column rename (data-preserving). |

**Schema reflects the sum:** the current `schema.prisma` has NO `productDescription`, `tier`, `automationPeriod`, `itemDescription`, `serviceScore`, `defectRatePct`, `complaintCountAnnual`, `rfxResponseRatePct`, `avgResponseTimeDays`, `singleSourceRisk`, `calculatedTier`, `tierMismatch` (all dropped in mig 5,7,8,9,10,11); it HAS `itemName` (11), `defectCount`+`complaintCount` (10), nullable Kraljic trio (3), nullable AnalysisResult range cols (4). Consistent — the live schema = init + migs 2–11 applied.

### 1.5 `prisma/seed.ts` & `scripts/migrate-period-tags.ts`

**seed.ts** — seeds ONLY users (periods auto-created on import, comment `:9-10`). Two users `seed.ts:11-24`:
```
{ email:"admin@mail.com",  password:"admin123",  name:"Admin User",  role:"ADMIN" },   // :12-17
{ email:"viewer@mail.com", password:"viewer123", name:"Viewer User", role:"VIEWER" },  // :18-23
```
Upserted idempotently by `email`, `bcrypt.hash(password, 12)` (`:30-45`). Own PrismaClient via `PrismaPg` (`:6-7`), NOT the `lib/prisma.ts` singleton.

**migrate-period-tags.ts** — one-off re-tag by payment (default) or `--by=pr` (revert) `:24-30`. The DANGEROUS part is the catalog-row `updateMany` inside the transaction:
```
await tx.supplier.updateMany({ data: { periodId: maxYearPeriodId } });        // :87
await tx.supplierMetric.updateMany({ data: { periodId: maxYearPeriodId } });  // :88
```
This collapses ALL `SupplierMetric` rows onto the max-year period (no `where`) — CLAUDE.md flags it as clobbering per-period metrics; `recompute.ts` docstring (`:11-13`) explicitly says do NOT use this script for a data change. Purchases are re-tagged per-year via `updateMany({where:{id:{in:ids}}})` (`:79-82`). Periods upserted by name, never mutated (`ensurePeriod` `:32-43`, `update: {}`).

### 1.6 TS/SQL-vs-Python compute boundary

| Value | Written by | Boundary citation |
|---|---|---|
| `User`, `Session`, `ReportingPeriod`, `Import` rows | **TS** (routes) | `login/route.ts` / `auth.ts:40` / import route |
| `Supplier`, `Purchase` rows | **TS** (import route `$transaction`) | import route `upload/route.ts:386-387` region (per grep) |
| `SupplierMetric` rows (all aggregates + 5 scores + composite) | **Python** `import_compute.py` → returned to TS as `ComputedMetricRow[]`, TS writes them | `lib/python.ts:112-157` (`runImportCompute`); TS writer `upload/route.ts:386-387` `supplierMetric.deleteMany` + `createMany({data: metricData})` |
| `SupplierMetric.supplyRiskScore / kraljicQuadrant / categoryCompetition` | **Python** (raw SQL UPDATE, post-import) | `python/compute_analyses.py:1383` `'SET "supplyRiskScore"=%s, "kraljicQuadrant"=%s, "categoryCompetition"=%s ...'` |
| `AnalysisResult.resultJson` (all 6 types, per-period & range) | **Python** `compute_analyses.py` (Mode A upsert / Mode B stdout→TS cache) | Mode A: `lib/python.ts:66-68`; Mode B cache write: `lib/range-analyses.ts:54-77` |

So: TS owns raw transactional rows + orchestration + the range-cache upsert; Python owns every DERIVED number (per-supplier metrics/scores and every analysis payload). The raw→scores handoff is stdin/stdout JSON (`python.ts:154-155,148`); a Python failure returns `rows:null`/non-zero and aborts before any write (`python.ts:143-151`).

### 1.7 `lib/analysis-types.ts` — the `AnalysisResult.resultJson` shapes (all exports)

29 top-level exports. Each named type/interface shapes one analysis payload (or a sub-part):

| Export | Line | Shapes |
|---|---|---|
| `TopSupplier` | `:8-12` | one top-spend bar (`supplier_id, supplier_name, total`) |
| `SpendOverviewResult` | `:14-39` | `spend_overview` payload (totals, `total_categories?`, `by_category`, `top_suppliers`, `top_suppliers_by_category?`, `monthly_trend`) |
| `AbcClassification` | `:41-49` | one ABC-classified supplier row |
| `AbcResult` | `:51-59` | `abc` payload (`thresholds`, `classifications`, `summary.A/B/C`) |
| `CycleDescriptive` | `:66-73` | mean/median/IQR descriptive block |
| `CycleDistribution` | `:75-84` | box-plot distribution stats |
| `CycleStageBreakdown` | `:86-91` | 4 stage descriptives (pr_to_po…invoice_to_payment) |
| `CycleAnomaly` | `:93-101` | one outlier PO (z-score) |
| `EffectSizeLabel` | `:103` | `"negligible"\|"small"\|"medium"\|"large"` |
| `PeriodComparison` | `:105-115` | Mann-Whitney split comparison |
| `ThreeWayMatchQuadrant` | `:117-121` | per-quadrant 3WM pass rate |
| `CycleTimeResult` | `:123-140` | `cycle_time` payload (trend, distribution, stage_breakdown, anomalies, period_comparison, by-quadrant maps) |
| `LegacyHypothesisResult` | `:148-156` | legacy pre/post automation shape (report backward-compat only) |
| `KraljicQuadrant` | `:158` | `"Strategic"\|"Leverage"\|"Bottleneck"\|"Routine"` |
| `RiskComponents` | `:168-172` | 3 Kraljic supply-risk components |
| `QuadrantAssignment` | `:174-183` | one supplier's Kraljic point (+ optional `risk_components`) |
| `QuadrantProfile` | `:185-193` | per-quadrant rollup |
| `KraljicResult` | `:195-202` | `kraljic` payload (assignments, profiles, axis_thresholds) |
| `PerformanceZone` | `:204-208` | `"Stars"\|"Critical Issues"\|"Hidden Gems"\|"Long Tail"` |
| `PerformanceSpendSupplier` | `:210-218` | one supplier's perf-vs-spend point |
| `ZoneProfile` | `:220-226` | per-zone rollup |
| `PerformanceSpendResult` | `:228-238` | `performance_spend` payload (suppliers, zone_profiles, thresholds, tops, by-quadrant) |
| `RecommendationCategory` | `:240-248` | 8-value union of rec categories |
| `RecommendationAction` | `:250-258` | 8-value union of rec actions |
| `Recommendation` | `:262-292` | one recommendation (`type` alias to satisfy Prisma JSON index-signature, comment `:260-261`) |
| `RecommendationsNarrative` | `:295-305` | page-headline synthesis numbers |
| `RecommendationsResult` | `:307-318` | `recommendations` payload |
| `RangeAnalyses` | `:321-328` | the full Mode-B payload (all 6 analyses) — used by `range-analyses.ts:4` |
| `getAnalysisResult<T>(periodId, analysisType)` | `:334-344` | **function** — `analysisResult.findUnique({where:{periodId_analysisType}})` → `resultJson as T` or null |

Notable optional-field markers (backward compat for old cached rows): `SpendOverviewResult.total_categories?` (`:26`), `top_suppliers_by_category?` (`:35`), `monthly_trend[].po_count?` (`:38`); `CycleTimeResult.monthly_trend[].median_cycle_days?` (`:129`); `QuadrantAssignment.risk_components?` (`:181`); `RecommendationsResult.summary_stats.narrative?` (`:316`).

---

## Divergences & flags (consolidated)

1. **`runCycleCompare` does not exist** (task brief vs code): `lib/python.ts` exports only `runComputeAnalyses`/`runComputeRange`/`runImportCompute`. The cycle-compare spawn + route were deleted (CLAUDE.md `6fc1339`). [Verified by full read.]
2. ✅ **RESOLVED 2026-07-20 — column DROPPED.** **`SupplierMetric.categoryCompetition` was write-only**: written by Python `compute_analyses.py:1383` but read by ZERO TS/TSX code (grep `categoryCompetition` → only schema, migration, python). Dead-ish column.
3. **`ReportPreset` fully orphaned**: `prisma.reportPreset` has 0 call-sites (grep "No matches found"). Model + table + `add_report_preset` migration all live; nothing reads/writes them. Matches CLAUDE.md KNOWN OPEN ITEMS.
4. **`ReportingPeriod.isLocked` + `Session.expiresAt`** appear to have no runtime reader (no expiry sweep on `expiresAt` found). [INFERRED — would confirm with a repo-wide grep of `isLocked` / `expiresAt` outside auth.ts.]
5. **eslint "set-state-in-effect ban" not local**: `eslint.config.mjs` declares no custom rules; the ban comes from the spread `eslint-config-next` presets, not this file. [INFERRED.]
6. **DATABASE_URL to Python is by env inheritance**, not an explicit `env:` on `spawn` (`python.ts:31-35`, no `env` key). CLAUDE.md's `.env` BOM note applies to STANDALONE python runs, not Node-spawned ones. [INFERRED — confirm in `compute_analyses.py`.]
7. **Import.fileType comment lists `'supplier_metrics'`** (`schema.prisma:147`) but CLAUDE.md/current import flow dropped the SupplierMetrics sheet (metrics computed server-side). Stale comment value, harmless.

---

## A3 EXPORTS COMPLETENESS INDEX (auto-generated — every `export` in this doc's files, cited)

Guarantees one-to-one A3 coverage: each symbol below is defined at the cited line in a file this doc documents.

| Symbol | Kind | file:line |
|---|---|---|
| `TopSupplier` | type | `analysis-types.ts:8` |
| `SpendOverviewResult` | type | `analysis-types.ts:14` |
| `AbcClassification` | type | `analysis-types.ts:41` |
| `AbcResult` | type | `analysis-types.ts:51` |
| `CycleDescriptive` | type | `analysis-types.ts:67` |
| `CycleDistribution` | type | `analysis-types.ts:75` |
| `CycleStageBreakdown` | type | `analysis-types.ts:86` |
| `CycleAnomaly` | type | `analysis-types.ts:93` |
| `EffectSizeLabel` | type | `analysis-types.ts:103` |
| `PeriodComparison` | type | `analysis-types.ts:105` |
| `ThreeWayMatchQuadrant` | type | `analysis-types.ts:117` |
| `CycleTimeResult` | type | `analysis-types.ts:123` |
| `LegacyHypothesisResult` | type | `analysis-types.ts:148` |
| `KraljicQuadrant` | type | `analysis-types.ts:158` |
| `RiskComponents` | interface | `analysis-types.ts:168` |
| `QuadrantAssignment` | interface | `analysis-types.ts:174` |
| `QuadrantProfile` | interface | `analysis-types.ts:185` |
| `KraljicResult` | interface | `analysis-types.ts:195` |
| `PerformanceZone` | type | `analysis-types.ts:204` |
| `PerformanceSpendSupplier` | interface | `analysis-types.ts:210` |
| `ZoneProfile` | interface | `analysis-types.ts:220` |
| `PerformanceSpendResult` | interface | `analysis-types.ts:228` |
| `RecommendationCategory` | type | `analysis-types.ts:240` |
| `RecommendationAction` | type | `analysis-types.ts:250` |
| `Recommendation` | type | `analysis-types.ts:262` |
| `RecommendationsNarrative` | type | `analysis-types.ts:295` |
| `RecommendationsResult` | interface | `analysis-types.ts:307` |
| `RangeAnalyses` | type | `analysis-types.ts:321` |
| `getAnalysisResult` | fn | `analysis-types.ts:334` |
| `SessionData` | re-export | `auth.ts:7` |
| `getSession` | fn | `auth.ts:13` |
| `createSession` | fn | `auth.ts:33` |
| `destroySession` | fn | `auth.ts:57` |
| `requireAuth` | fn | `auth.ts:71` |
| `requireAdmin` | fn | `auth.ts:82` |
| `countryName` | fn | `countries.ts:9` |
| `LoginLayout` | default | `layout.tsx:1` |
| `(default)` | default | `layout.tsx:7` |
| `metadata` | const | `layout.tsx:15` |
| `RootLayout` | default | `layout.tsx:20` |
| `(default)` | default | `next.config.ts:18` |
| `Home` | default | `page.tsx:4` |
| `AbcAnalysisPage` | default | `page.tsx:5` |
| `LoginPage` | default | `page.tsx:27` |
| `PERIOD_COOKIE` | const | `period-constants.ts:5` |
| `PeriodMode` | type | `period-constants.ts:7` |
| `PeriodSelection` | type | `period-constants.ts:9` |
| `PERIOD_COOKIE` | re-export | `period.ts:5` |
| `getAllPeriods` | fn | `period.ts:10` |
| `getCurrentPeriodSelection` | fn | `period.ts:26` |
| `getDateRangeFromSelection` | fn | `period.ts:65` |
| `AnalysisSource` | type | `period.ts:83` |
| `resolveAnalysisSource` | fn | `period.ts:97` |
| `(default)` | default | `prisma.config.ts:6` |
| `prisma` | const | `prisma.ts:15` |
| `proxy` | fn | `proxy.ts:6` |
| `config` | const | `proxy.ts:23` |
| `PythonResult` | type | `python.ts:5` |
| `runComputeAnalyses` | fn | `python.ts:66` |
| `runComputeRange` | fn | `python.ts:71` |
| `ComputedMetricRow` | type | `python.ts:84` |
| `runImportCompute` | fn | `python.ts:112` |
| `RANGE_TYPES` | const | `range-analyses.ts:7` |
| `getRangeAnalyses` | fn | `range-analyses.ts:21` |
| `recomputeAllPeriods` | fn | `recompute.ts:26` |
| `POST` | fn | `route.ts:4` |
| `POST` | fn | `route.ts:12` |
| `SessionData` | interface | `session.ts:7` |
| `sessionOptions` | const | `session.ts:14` |
| `getSupplierCategoryMap` | fn | `suppliers.ts:8` |
| `getSupplierDirectory` | fn | `suppliers.ts:28` |
| `getCategories` | fn | `suppliers.ts:56` |

**Total distinct exports across this doc's files: 72.**
