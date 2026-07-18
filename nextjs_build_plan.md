# Procurement Analytics Web App — Full Build Plan

**Stack**: Next.js 15 + TypeScript + Prisma 7 + PostgreSQL + Tailwind + shadcn/ui + Recharts  
**Auth**: bcrypt + iron-session (admin + viewer roles)  
**Python**: Local script computes analyses, writes results to Postgres  
**Deployment**: Local development only (PostgreSQL on your machine)  
**Realistic timeline**: 5-7 days at 7 hrs/day with AI assistance

---

## ⚠️ Before you start

1. **Confirm supervisor scope** — make sure they want a full web app, not a Streamlit demo
2. **Block out your time** — you said 7 hrs/day; commit to it
3. **Don't pivot mid-build** — if you change scope partway, you'll spend more time re-planning than building

---

## Confirmed scope (what you picked)

| Decision | Your pick | Implication |
|---|---|---|
| Python integration | B: Local script writes to DB | One-time compute per import; simpler than FastAPI service |
| Auth | B: Multi-role (admin + viewer) | Slightly more complex; matches GHG pattern |
| Reporting periods | B: Metadata + filterable | All data shown together, filters change what's displayed |
| Executive summary | C: HTML + PDF | Render in-browser, also downloadable |
| Hosting | C: Local only | No Vercel/Neon setup; demo via screen-share |

---

## Architecture overview

```
┌────────────────────────────────────────────────┐
│  Next.js App (localhost:3000)                  │
│  ┌──────────────┐  ┌──────────────────────┐    │
│  │ Frontend     │  │ API Routes           │    │
│  │ (React +     │←→│ (Prisma queries,     │    │
│  │  Tailwind)   │  │  auth, imports)      │    │
│  └──────────────┘  └──────────────────────┘    │
└──────────────────────────┬─────────────────────┘
                           │
                           ▼
              ┌─────────────────────┐
              │  PostgreSQL         │
              │  (localhost:5432)   │
              └─────────────────────┘
                           ▲
                           │
              ┌─────────────────────┐
              │  Python script      │
              │  (compute_analyses) │
              │  Triggered after    │
              │  CSV import         │
              └─────────────────────┘
```

**Flow**: User uploads CSV → Next.js parses + saves raw data to Postgres → Triggers Python script → Python reads from Postgres, computes ABC/clustering/hypothesis/summary stats → Writes results back to Postgres → Frontend displays from Postgres.

---

## Database schema (Prisma)

This is what we'll build. ~8 tables, much simpler than GHG's 79.

```prisma
// schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

// ============= AUTH =============

model User {
  id           String    @id @default(cuid())
  email        String    @unique
  passwordHash String
  name         String
  role         Role      @default(VIEWER)
  createdAt    DateTime  @default(now())
  
  sessions     Session[]
  imports      Import[]
  reports      ExecutiveSummary[]
}

enum Role {
  ADMIN
  VIEWER
}

model Session {
  id        String   @id @default(cuid())
  userId    String
  user      User     @relation(fields: [userId], references: [id], onDelete: Cascade)
  expiresAt DateTime
  createdAt DateTime @default(now())
}

// ============= REPORTING PERIODS =============

model ReportingPeriod {
  id        String    @id @default(cuid())
  name      String    @unique  // "Q1 2024", "FY 2024", etc.
  startDate DateTime
  endDate   DateTime
  isLocked  Boolean   @default(false)
  createdAt DateTime  @default(now())
  
  suppliers          Supplier[]
  purchases          Purchase[]
  metrics            SupplierMetric[]
  imports            Import[]
  analysisResults    AnalysisResult[]
  executiveSummaries ExecutiveSummary[]
}

// ============= DATA =============

model Supplier {
  id                 String          @id @default(cuid())
  externalId         String          // S001, S002, etc.
  supplierName       String
  country            String
  category           String
  productDescription String
  tier               String          // Legacy tier
  periodId           String
  period             ReportingPeriod @relation(fields: [periodId], references: [id], onDelete: Cascade)
  
  purchases          Purchase[]
  metrics            SupplierMetric[]
  
  @@unique([externalId, periodId])
  @@index([periodId])
  @@index([category])
}

model Purchase {
  id                     String          @id @default(cuid())
  poId                   String
  supplierExternalId     String
  supplierName           String
  category               String
  itemDescription        String
  unit                   String
  quantity               Float
  unitPriceUsd           Float
  totalValueUsd          Float
  prDate                 DateTime
  poDate                 DateTime
  deliveryDate           DateTime
  invoiceDate            DateTime
  paymentDate            DateTime
  prToPoDays             Int
  poToDeliveryDays       Int
  deliveryToInvoiceDays  Int
  invoiceToPaymentDays   Int
  totalCycleDays         Int
  onTimeDelivery         Boolean
  threeWayMatchPass      Boolean
  automationPeriod       String          // "pre" or "post"
  periodId               String
  period                 ReportingPeriod @relation(fields: [periodId], references: [id], onDelete: Cascade)
  
  @@unique([poId, periodId])
  @@index([periodId])
  @@index([supplierExternalId, periodId])
  @@index([automationPeriod])
}

model SupplierMetric {
  id                    String          @id @default(cuid())
  supplierExternalId    String
  supplierName          String
  category              String
  tier                  String
  totalSpendUsd         Float
  numPos                Int
  avgPoValueUsd         Float
  avgLeadTimeDays       Float
  avgCycleTimeDays      Float
  onTimeDeliveryPct     Float
  threeWayMatchPct      Float
  defectRatePct         Float
  complaintCountAnnual  Int
  rfxResponseRatePct    Float
  avgResponseTimeDays   Float
  singleSourceRisk      Int
  qualityScore          Float
  deliveryScore         Float
  serviceScore          Float
  processScore          Float
  riskScore             Float
  compositeScore        Float
  calculatedTier        String
  tierMismatch          Boolean
  periodId              String
  period                ReportingPeriod @relation(fields: [periodId], references: [id], onDelete: Cascade)
  
  @@unique([supplierExternalId, periodId])
  @@index([periodId])
}

// ============= IMPORTS =============

model Import {
  id           String       @id @default(cuid())
  userId       String
  user         User         @relation(fields: [userId], references: [id])
  periodId     String
  period       ReportingPeriod @relation(fields: [periodId], references: [id])
  filename     String
  fileType     String       // 'suppliers' | 'purchases' | 'supplier_metrics'
  rowCount     Int
  status       ImportStatus
  errorMessage String?
  uploadedAt   DateTime     @default(now())
  processedAt  DateTime?
  
  @@index([periodId])
  @@index([uploadedAt])
}

enum ImportStatus {
  PENDING
  PROCESSING
  SUCCESS
  FAILED
}

// ============= PRE-COMPUTED ANALYSES =============

model AnalysisResult {
  id           String          @id @default(cuid())
  periodId     String
  period       ReportingPeriod @relation(fields: [periodId], references: [id], onDelete: Cascade)
  analysisType String          // 'abc' | 'clustering' | 'hypothesis' | 'spend_overview'
  resultJson   Json
  computedAt   DateTime        @default(now())
  
  @@unique([periodId, analysisType])
  @@index([periodId])
}

// ============= EXECUTIVE SUMMARIES =============

model ExecutiveSummary {
  id              String          @id @default(cuid())
  periodId        String
  period          ReportingPeriod @relation(fields: [periodId], references: [id])
  title           String
  narrative       String          @db.Text
  metricsJson     Json
  createdAt       DateTime        @default(now())
  generatedBy     String
  generatedByUser User            @relation(fields: [generatedBy], references: [id])
  
  @@index([periodId])
}
```

You'll get Claude Code to generate this in Phase 3.

---

## Phase-by-phase build

### Phase 0: Prerequisites (~30 min)

You already have Python, Git, and Claude Code. Add these:

**Install Node.js 20+** if you don't have it:
```bash
node --version
```
If missing or < 20, install from [nodejs.org](https://nodejs.org/).

**Install PostgreSQL locally**:
- **Windows**: Download from [postgresql.org/download/windows](https://www.postgresql.org/download/windows/)
- During install, set a password for the `postgres` user — **remember it**
- Default port: 5432

**Verify Postgres is running**:
```bash
psql --version
```

**Install pgAdmin** (visual database tool) — usually bundled with the Postgres installer on Windows.

### Phase 1: Project setup (~1 hour)

**Step 1.1**: Create project folder

```bash
cd Documents
mkdir procurement_analytics_app
cd procurement_analytics_app
```

**Step 1.2**: Open this folder in Claude Code Desktop.

**Step 1.3**: First prompt to Claude Code:

```
Initialize a Next.js 15 project with TypeScript, App Router, Tailwind CSS, and ESLint.
After creation:
1. Install these additional packages:
   - prisma + @prisma/client
   - bcrypt + @types/bcrypt
   - iron-session
   - zod
   - react-hook-form + @hookform/resolvers
   - recharts
   - lucide-react
   - papaparse + @types/papaparse
   - xlsx
   - jspdf
   - html2canvas
   - shadcn/ui via the shadcn-ui CLI initializer (use default options, slate as color)
2. Add shadcn/ui components: button, input, label, card, table, dialog, dropdown-menu, select, badge, alert, toast, tabs, form, separator
3. Initialize Prisma with PostgreSQL provider
4. Don't write logic yet, just set up the project skeleton.
```

**Step 1.4**: Create CLAUDE.md (after the project is initialized):

```
Create a CLAUDE.md file at the project root with the following content:

# Project: Procurement Analytics Web App

A full-stack Next.js web app for presenting mining procurement analytics from synthetic 
data. Multi-user with auth, single organization, fixed analyses (no parameter tweaking).

## Tech stack
- Next.js 15 (App Router) + TypeScript
- Prisma 7 + PostgreSQL (local)
- Tailwind + shadcn/ui
- Recharts for charts
- bcrypt + iron-session for auth
- Python script computes analyses post-import

## Architecture
- /app — Next.js pages and API routes (App Router)
- /lib — utilities (prisma client, auth, calculation helpers)
- /components — reusable React components
- /hooks — React hooks
- /types — shared TypeScript types
- /prisma — schema and migrations
- /python — analysis compute scripts (called from API after import)
- /data/raw — original CSVs for seed/sample data

## Auth pattern
- Hardcoded seeded users (admin + viewer roles)
- bcrypt for passwords, iron-session for sessions
- Middleware protects all routes except /login
- Admin: full access (import, generate reports, manage periods)
- Viewer: read-only access to dashboards and reports

## Critical scope rules
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
- Charts use Recharts
- Forms use react-hook-form + zod
- Server Components by default; "use client" only when needed
- All routes auth-guarded except /login
- TypeScript strict mode

## Data flow for imports
1. User uploads CSV (suppliers/purchases/supplier_metrics)
2. Next.js API parses and saves to Postgres
3. After successful insert, API spawns Python script
4. Python reads data from Postgres, computes analyses
5. Python writes AnalysisResult rows back to Postgres
6. Frontend pages read AnalysisResult and display

## When uncertain
Default to the simpler implementation. Don't add features I didn't request.
Don't add real-time features. Don't add multi-org logic.
```

**Verify Phase 1**:
- `npm run dev` starts the dev server
- Open http://localhost:3000 — see the Next.js default page
- `npx prisma --version` works

Commit:
```
git add . && git commit -m "Initial Next.js + Prisma + shadcn setup"
```

### Phase 2: PostgreSQL setup (~30 min)

**Step 2.1**: Create the database

Open pgAdmin or use psql:

```sql
CREATE DATABASE procurement_analytics;
```

**Step 2.2**: Create `.env` file in project root

```env
DATABASE_URL="postgresql://postgres:YOUR_PASSWORD@localhost:5432/procurement_analytics?schema=public"
SESSION_SECRET="generate_a_random_32_character_string_here_please"
NODE_ENV="development"
```

Replace `YOUR_PASSWORD` with your actual Postgres password.

Generate SESSION_SECRET — tell Claude Code:
```
Generate a random 32-character session secret and update the SESSION_SECRET 
line in .env.
```

**Step 2.3**: Verify connection

Tell Claude Code:
```
Run "npx prisma db pull" to verify the database connection works.
```

(It'll fail because there's nothing in the DB yet, but it should connect.)

Commit:
```
git add . && git commit -m "PostgreSQL local setup, env configured"
```

### Phase 3: Database schema (~1.5 hours)

**Step 3.1**: Build the Prisma schema

Tell Claude Code (paste the entire schema from the "Database schema (Prisma)" section above):

```
Update prisma/schema.prisma with the following schema:

[PASTE THE PRISMA SCHEMA HERE]

Then run "npx prisma migrate dev --name init" to create the initial migration 
and apply it to the database. After migration, run "npx prisma generate" to 
generate the Prisma client.
```

**Step 3.2**: Verify schema

Tell Claude Code:
```
Open pgAdmin or run "npx prisma studio" to verify all the tables exist.
List them out.
```

**Step 3.3**: Write the seed script

Tell Claude Code:
```
Create prisma/seed.ts that:

1. Seeds 3 reporting periods: "FY 2024", "FY 2025", "FY 2024-2025 Combined"
2. Seeds 2 users:
   - admin@adaro.com / password "admin123" / role ADMIN / name "Admin User"
   - viewer@adaro.com / password "viewer123" / role VIEWER / name "Viewer User"
3. Uses bcrypt to hash the passwords with 12 rounds
4. Includes proper error handling and a clean exit

Then update package.json with:
"prisma": { "seed": "tsx prisma/seed.ts" }

Install tsx as a dev dependency: npm i -D tsx

Run "npx prisma db seed" to execute it.
```

**Verify Phase 3**:
- Open Prisma Studio: `npx prisma studio` (opens browser)
- See your 2 users + 3 reporting periods

Commit.

### Phase 4: Authentication (~3-4 hours)

This is the most complex single phase. Don't rush it.

**Step 4.1**: Build the auth library

Tell Claude Code:
```
Create lib/auth.ts with:

1. getSession() — reads iron-session from cookies, returns user data or null
2. createSession(userId) — creates a session in DB and sets iron-session cookie
3. destroySession() — deletes DB session + clears cookie
4. requireAuth() — server component helper that redirects to /login if no session
5. requireAdmin() — server component helper that requires ADMIN role

Use iron-session with cookie name "procurement_session" and the SESSION_SECRET 
from env.

Also create lib/prisma.ts — singleton Prisma client.

Type the session data as: { userId: string; email: string; name: string; role: 'ADMIN' | 'VIEWER' }
```

**Step 4.2**: Create login page

Tell Claude Code:
```
Create app/login/page.tsx as a client component with a login form:
- Use react-hook-form + zod for validation
- Use shadcn/ui Card, Input, Label, Button, Alert components
- POST to /api/auth/login with email + password
- On success, redirect to /
- On failure, show error message

Also create app/login/layout.tsx that doesn't include any sidebar (auth-free layout).

Then create app/api/auth/login/route.ts:
- POST handler
- Look up user by email
- Verify password with bcrypt.compare
- If valid: call createSession from lib/auth, return success
- If invalid: return 401 with error message
- Use zod to validate request body
```

**Step 4.3**: Create logout endpoint

Tell Claude Code:
```
Create app/api/auth/logout/route.ts:
- POST handler
- Call destroySession from lib/auth
- Return success
```

**Step 4.4**: Create middleware

Tell Claude Code:
```
Create middleware.ts at project root that:
- Checks for valid iron-session on all routes except /login, /api/auth/*, and static assets
- If no session, redirect to /login
- Pass user info to API routes via header

Add the matcher config to exclude static files and Next internals.
```

**Step 4.5**: Build the authenticated layout

Tell Claude Code:
```
Create app/(dashboard)/layout.tsx as the authenticated app layout:
- Server component
- Uses requireAuth() — redirects to /login if not authenticated
- Sidebar with navigation: Overview, ABC Analysis, Supplier Segments, Cycle Time, 
  Import, Reports, Methodology
- Header with user name, role badge, period selector dropdown, logout button
- Children render in the main content area
- Use shadcn/ui DropdownMenu and Button

Also create components/Sidebar.tsx and components/Header.tsx as needed.

The period selector reads all ReportingPeriod from DB and shows them in a 
dropdown. Selected period is stored in a cookie or URL search param so it 
persists across pages.
```

**Step 4.6**: Test auth

Tell Claude Code:
```
Run "npm run dev". I'll go to localhost:3000 and:
1. Verify it redirects me to /login
2. Try logging in with admin@adaro.com / admin123
3. Verify I land on the dashboard (even if empty)
4. Try logout
5. Verify I'm back on /login

If anything doesn't work, fix it.
```

Once auth works, commit.

### Phase 5: Period selector + filtering context (~1.5 hours)

Tell Claude Code:
```
Build a period filtering context:

1. Create lib/period-context.tsx — React context that holds the current 
   selected reporting period
2. The period is stored in a cookie "selected_period_id" 
3. Default to the most recent period if none selected
4. The Header period selector dropdown changes this context
5. All dashboard pages can call useReportingPeriod() to get current period

Then update the header (from Phase 4) to use this context properly.
```

Verify by changing periods in the dropdown — the URL or cookie should update.

### Phase 6: CSV/XLSX import (~4-5 hours)

This phase has frontend + API + Python integration.

**Step 6.1**: Build the import UI

Tell Claude Code:
```
Create app/(dashboard)/import/page.tsx:

- Server component checks if user is ADMIN; if VIEWER, show "Access denied"
- Upload section with ONE file input that accepts .xlsx files
- The Excel file must have 3 sheets: "Suppliers", "Purchases", "SupplierMetrics"
- Select dropdown to choose which reporting period to import into
- Show a help text: "Upload a single Excel file with 3 sheets: Suppliers, Purchases, SupplierMetrics"
- Submit button that uploads the file
- Below upload form: table of recent imports (filename, period, sheets imported, total row count, 
  status, uploaded at, processed at) — read from Import model
- Use shadcn/ui Card, Input, Button, Select, Table, Badge components
- Show progress/status while import runs
- Provide a "Download sample data" link that downloads data/raw/procurement_data.xlsx

This is a client component for the upload form.
```

**Step 6.2**: Build the import API

Tell Claude Code:
```
Create app/api/imports/upload/route.ts:

- POST handler
- Auth check: must be ADMIN
- Parse multipart form data with the .xlsx file and a periodId
- Use the `xlsx` npm library to parse the workbook
- Validate the workbook has 3 sheets: "Suppliers", "Purchases", "SupplierMetrics"
- For each sheet:
  1. Create Import record with status PENDING (fileType = sheet name)
  2. Read sheet rows
  3. Validate columns match expected schema (use zod)
  4. Use Prisma transaction to:
     - Delete existing records for that period + sheet type (so re-import works)
     - Insert all rows from the sheet
  5. Update Import record to SUCCESS with rowCount, processedAt
  6. If error, update Import record to FAILED with errorMessage
- After all 3 sheets imported successfully in one transaction, trigger Python script (see Phase 7)
- Return summary of imports (rows per sheet)

Use streaming or transaction for large files. Handle date parsing for Purchases sheet date columns. 
Use the field names from the existing CSVs (pr_date, po_date, etc.) — Excel may convert dates to 
Excel serial numbers, so handle that case (use xlsx library's `cellDates: true` option).
```

### Phase 7: Python analysis integration (~2-3 hours)

**Step 7.1**: Set up Python script

Tell Claude Code:
```
Create python/ directory with:

1. python/compute_analyses.py — main script that:
   - Takes periodId as CLI arg: python compute_analyses.py <periodId>
   - Connects to Postgres using psycopg2 (read DATABASE_URL from env)
   - Loads suppliers, purchases, supplier_metrics from DB for that period
   - Computes:
     * Spend overview (totals, category breakdown, top 10 suppliers, monthly trend)
     * ABC classification with fixed 80/95 thresholds
     * K-means clustering with fixed k=4 and PCA projection
     * Mann-Whitney U test on invoice_to_payment_days pre/post automation
   - Writes results to AnalysisResult table (one row per analysis type, resultJson 
     contains the computed data)
   - Returns 0 on success, non-zero on failure
   - Logs progress to stdout

2. python/requirements.txt with: pandas, numpy, scikit-learn, scipy, psycopg2-binary, python-dotenv

3. python/.env-example explaining DATABASE_URL is read from project root .env

Make sure the script is robust — handles missing data, NaN values, edge cases.
Use the same formulas as our generate_dataset.py for the composite_score calculation.
Reference procurement_analytics_gameplan_technical.md for the analytical methodology.
```

**Step 7.2**: Trigger Python from Next.js

Tell Claude Code:
```
Add Python triggering to the import API:

After all 3 CSVs import successfully:
1. Use Node child_process to spawn: python python/compute_analyses.py <periodId>
2. Capture stdout and stderr
3. On exit code 0, mark Import records' Python step as success
4. On non-zero exit, log error and notify user

Create app/api/analyses/compute/route.ts as a separate endpoint too:
- POST to trigger recompute manually for a given period
- Auth: ADMIN only
- Same logic — spawn Python script, return result

Display Python script logs in the import UI as it runs (you can use polling for 
simplicity, or just refresh on completion).
```

**Verify Phase 7**:
- Upload the 3 sample CSVs as ADMIN
- See Python script run
- Check AnalysisResult table in Prisma Studio — should have 4 rows for that period

Commit.

### Phase 8: Dashboard pages (~8-12 hours total)

Each page reads from `AnalysisResult` table (pre-computed by Python).

**Step 8.1**: Overview page (~2 hours)

Tell Claude Code:
```
Create app/(dashboard)/page.tsx as the home dashboard:

- Server component
- Get current period from cookie
- Read AnalysisResult for type 'spend_overview' for that period
- Display:
  * 4 KPI cards: Total Spend, Total POs, Active Suppliers, Avg Cycle Time
  * Spend by Category donut chart (Recharts)
  * Top 10 Suppliers horizontal bar chart (Recharts)
  * Monthly Spend Trend line chart (Recharts)
  * Brief narrative paragraph
- If no data for period (analysis hasn't been computed), show friendly empty state 
  with link to import page
- Use shadcn/ui Card components for KPIs
- Loading state for charts
```

**Step 8.2**: ABC Analysis page (~2 hours)

Tell Claude Code:
```
Create app/(dashboard)/abc-analysis/page.tsx:

- Read AnalysisResult for type 'abc' for current period
- Display:
  * Method explanation card at top (always visible — no expander)
  * 3 KPI cards: A-class, B-class, C-class (count + % spend)
  * Pareto chart: ComposedChart from Recharts with Bar (colored by class) + Line (cumulative %)
  * Classification table: rank, supplier name, tier, ABC class, total, %, cumulative
    * Use shadcn/ui DataTable
    * Color-coded badges for A/B/C
    * Sortable, paginated
  * Tier vs ABC crosstab as a small table

NO sliders. NO threshold inputs. Just presentation.
```

**Step 8.3**: Supplier Segments page (~2-3 hours)

Tell Claude Code:
```
Create app/(dashboard)/supplier-segments/page.tsx:

- Read AnalysisResult for type 'clustering' for current period
- Display:
  * Method explanation card
  * PCA scatter plot using Recharts ScatterChart, colored by cluster
    * Tooltips show supplier name, tier, spend
  * Cluster profile table: mean of each feature per cluster + n_suppliers
  * Narrative section: 4 paragraphs identifying each cluster (Star Performers, 
    Strategic Underperformers, Reliable Specialists, Tail Spenders)
    * Match narrative to cluster based on profile means (server-side logic)
  * Tier vs Cluster crosstab

NO k slider. Fixed k=4.
```

**Step 8.4**: Cycle Time page (~2 hours)

Tell Claude Code:
```
Create app/(dashboard)/cycle-time/page.tsx:

- Read AnalysisResult for type 'hypothesis' for current period
- Display:
  * Method explanation
  * 2 metric cards: Pre-automation mean, Post-automation mean (with delta)
  * Statistical results panel: p-value, effect size, 95% CI (3 cards)
  * Success/warning banner based on p < 0.05
  * Side-by-side box plots (use Recharts or a custom SVG)
  * Overlaid histograms
  * Monthly trend line with vertical reference line at 2025-01-01
  * Interpretation paragraph

NO sensitivity sliders.
```

**Step 8.5**: Methodology page (~30 min)

Tell Claude Code:
```
Create app/(dashboard)/methodology/page.tsx as a static documentation page:

Use shadcn/ui Card components and good typography. Include:
- Project background
- Data sources (note synthetic + calibration sources: APQC, Hackett, CIPS, MOPS, AME)
- Three analyses with formulas
- Assumptions and limitations
- References

No charts, just well-formatted markdown-like content.
```

Verify each page renders correctly with the seeded data. Commit between pages.

### Phase 9: Executive Summary generation (~5-6 hours)

This is the heaviest custom feature.

**Step 9.1**: Generation logic

Tell Claude Code:
```
Create app/(dashboard)/reports/page.tsx:

- Server component
- List existing ExecutiveSummary records (filter by current period)
- "Generate New Summary" button (admin only)
- Each summary card shows: title, created date, generated by, "View" and "Download PDF" buttons
```

**Step 9.2**: Generation API

Tell Claude Code:
```
Create app/api/reports/generate/route.ts:

- POST handler, ADMIN only
- Read all AnalysisResult for current period
- Generate executive narrative text:
  * Opening: period summary
  * Key findings: top spend concentration, supplier segments insights, automation impact
  * Recommendations: tier reclassification candidates, etc.
  * Use template strings populated from analysis results
- Create ExecutiveSummary record with:
  * title: "Executive Summary - [Period Name] - [Date]"
  * narrative: generated text
  * metricsJson: snapshot of key metrics
  * generatedBy: current user ID
- Return the new summary ID

Use deterministic template generation, not LLM (we want reproducible output).
```

**Step 9.3**: View summary page

Tell Claude Code:
```
Create app/(dashboard)/reports/[id]/page.tsx:

- Server component, fetch ExecutiveSummary by ID
- Layout like a printable report:
  * Company header
  * Title and date
  * Executive narrative (formatted markdown)
  * Embedded charts (re-render from analysis results)
  * Page numbers, etc.
- "Download as PDF" button at top
- Print-friendly CSS (use @media print)
```

**Step 9.4**: PDF download

Tell Claude Code:
```
Add PDF download to the summary view page:

- Use html2canvas to capture the report DOM
- Use jspdf to convert to multi-page PDF
- Trigger download on button click
- Filename: "Executive_Summary_[Period]_[Date].pdf"

Test that PDF includes:
- Header
- All narrative text
- All charts (rasterized to images)
- Proper page breaks
```

This is finicky — expect 1-2 hours debugging.

### Phase 10: Polish + final test (~2-3 hours)

Tell Claude Code:
```
Final polish pass:

1. Add proper loading states to all pages (Skeleton components from shadcn)
2. Add error boundaries to dashboard pages
3. Toast notifications on successful actions (login, import, generate summary)
4. Confirm all routes are auth-guarded
5. Confirm VIEWER role can't access import or report generation
6. Add a friendly empty state when no data exists for a period
7. Mobile responsive check (test at 375px width)
8. Run "npm run build" to check for production build errors
9. Fix any TypeScript or ESLint warnings

Report any issues you can't fix yourself.
```

Manually test:
- [ ] Login as admin: full access works
- [ ] Logout works
- [ ] Login as viewer: can see all dashboards but not import/generate
- [ ] Period selector switches data across all pages
- [ ] Import works (upload 3 CSVs, Python runs, dashboards update)
- [ ] Generate executive summary
- [ ] Download PDF
- [ ] All charts render correctly
- [ ] No console errors

Commit, push to GitHub for safety (no deployment yet).

---

## Timeline summary

| Phase | What | Hours |
|---|---|---|
| 0 | Prerequisites | 0.5 |
| 1 | Project setup | 1 |
| 2 | PostgreSQL setup | 0.5 |
| 3 | Database schema + seed | 1.5 |
| 4 | Authentication | 3-4 |
| 5 | Period context | 1.5 |
| 6 | CSV/XLSX import | 4-5 |
| 7 | Python integration | 2-3 |
| 8 | Dashboard pages (4 pages) | 8-12 |
| 9 | Executive summary | 5-6 |
| 10 | Polish + final test | 2-3 |
| **Total** | | **30-40 hours** |

At 7 hrs/day: **5-6 days** if everything goes smoothly. Realistic: **7-10 days** with debugging.

---

## What to do RIGHT NOW

1. **Confirm scope with supervisor** in writing. "I'm building a full Next.js + Postgres web app with auth, import, and executive summary generation. Expected ~1-2 weeks. Confirm OK?"

2. **Once confirmed, start Phase 0 today** — install Node.js and PostgreSQL.

3. **Don't deviate from the plan.** If you start adding features mid-build, you'll burn weeks. Ship the plan as-is, add extras later.

4. **Stop and ask me** if something breaks badly. Don't fight a bug for 4 hours alone.

---

## Critical reminders

- **Read what Claude Code writes.** Even more important here than Streamlit — security, auth, and database queries are easy to get subtly wrong.
- **Test after every phase.** Don't power through 3 phases then debug.
- **Commit often.** After every working phase.
- **Don't rebuild GHG.** This is "GHG-Lite for Procurement." Resist scope creep.

Good luck. 🛠️
