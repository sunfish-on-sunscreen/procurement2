# Procurement Analytics

A Next.js web app presenting mining procurement analytics over a synthetic dataset.
Multi-user with auth, single organization, fixed analytical methodology (no parameter
tuning — the formulas are locked so results are comparable across periods).

## Data model

A **normalized 12-table document model** mirroring a real procure-to-pay chain:

```
suppliers ── frameworks
     │
requisitions ── sourcing_events ── responses
     │
purchase_orders ── po_lines
     │      │
     │      ├── goods_receipts ── grn_lines
     │      └── invoices ── invoice_lines ── payments
```

Sheets and tables hold **raw facts only** — no `*_days`, no `total_value_usd`, no
`three_way_match_pass`, no scores. Everything derived is reconstructed at read time by
the **`EnrichedPurchase` Postgres view**, which flattens the chain back to one row per
purchase order (spend, cycle-time segments, on-time delivery, three-way-match result,
defects). Both the TypeScript read routes and the Python compute layer consume that view,
so they cannot disagree about what a purchase order "is".

Notable derivations: `deliveryDate = MAX(receiptDate)` — an order may have several goods
receipts, at different sites and dates, so delivery is judged on the final one.

### Buying methods

`buying_method` is one of **`rfq | tender | spot_buy | call_off | direct`**.

- **`rfq` and `tender` are competitively sourced** — each order carries its own
  `sourcing_event` with invited-supplier count, bid `responses`, and an award. They are
  peer methods, not one method with a type: a tender differs in scope, sealed bidding,
  public bid opening and formality. Sourcing-event ids are prefixed per method
  (`RFQ-<year>-0001` / `TND-<year>-0001`) on independent sequences.
- **`call_off`** draws on a framework agreement, **`direct`** requires a justification,
  **`spot_buy`** carries none of them. None of these three has a sourcing event.

## Analytics (locked methodology)

- **Performance composite** = `0.30·Quality + 0.30·Delivery + 0.22·Process + 0.18·Risk`.
  Quality is per-PO (defect rate + complaint rate); Delivery is on-time % + lead time;
  Process is the three-way-match rate; Risk is structural (country distance + roster
  concentration).
- **Three-way match** tests the *invoice* against the PO and the receipts: per line,
  billed quantity == accepted quantity (received − rejected) **and** invoice price == PO
  price. It is a payment-controls test, not a quality test — a correctly-billed partial
  delivery passes.
- **ABC** classification at fixed 80% / 95% spend thresholds.
- **Kraljic** positioning on spend × supply risk (concentration, cost premium, import
  friction).
- **Cycle time** across the PR → PO → delivery → invoice → payment stages, with
  outlier and stage-dominance detection.

Reporting period = **order year** (`poDate`).

**Current dataset baseline** — any change should be checked against it:

| metric | value |
|---|---|
| Total spend | $707,687,316.20 |
| Purchase orders | 647 (2024: 240 · 2025: 250 · 2026: 157) |
| Three-way match | 566 pass / 81 fail |
| Suppliers · categories | 55 · 14 |

## Write capabilities

- **Supplier CRUD** — add / edit / deactivate, every change recorded in an append-only
  `SupplierChangeLog` (who, when, field, before → after). Suppliers are never deleted;
  retirement is a status flag, and it deliberately changes no analytics number.
- **Dataset import (replace-all)** — a 12-sheet workbook, fully validated (required
  columns, primary-key uniqueness, foreign-key closure, controlled vocabularies) before
  anything is written, then applied in one transaction.
- **Bulk append** — suppliers (upsert by `supplier_id`) and transactions (insert-only,
  complete chains). Both support a preview mode that validates and reports the plan
  without writing.
- **Transaction create** — records a complete document chain (requisition → PO + lines →
  one or more goods receipts + lines → invoice + lines → payment) in one atomic write,
  then recomputes. Receiving is per receipt, so a delivery can be split across dates and
  sites.
- **Corrections** — posted transactional records are **immutable** (enforced by Postgres
  `BEFORE UPDATE` triggers). A mistake is fixed by appending a signed correction entry
  linked to the original, under a `Correction` audit header — quantity, price, or defect.

A generated import template is available at `GET /api/imports/template`.

## Tech stack

Next.js 16 (App Router) · React 19 · TypeScript 5 · Prisma 7 · PostgreSQL · Tailwind v4 ·
shadcn/ui · Recharts 3 · zod 4 · bcrypt + iron-session · Python 3.12 (pandas, numpy,
scipy, scikit-learn) for the analysis compute.

## Local setup

### Prerequisites
- Node.js 20+
- PostgreSQL 17+ running locally
- Python 3.12

### Installation

```bash
npm install

# Create the database (one-time)
psql -U postgres -c "CREATE DATABASE procurement_analytics;"

# Configure environment
cp .env.example .env
# Edit .env: set DATABASE_URL, SESSION_SECRET (32+ chars), NODE_ENV

# Generate the Prisma client (required after every clone)
npx prisma generate

# Apply migrations
npx prisma migrate deploy
```

> `migrate deploy` is used rather than `migrate dev` because Prisma 7's `migrate dev` is
> interactive and fails in a non-interactive shell. To author a *new* migration, use
> `prisma migrate diff --from-config-datasource --to-schema prisma/schema.prisma --script`
> and then `migrate deploy`.

### Python environment

```bash
python -m venv python/.venv

# Activate (Windows PowerShell)
python\.venv\Scripts\Activate.ps1
# Or (macOS/Linux)
source python/.venv/bin/activate

pip install -r python/requirements.txt
```

### Load the data

Seeding and computing are two steps — the seed loads the document tables, then the
compute pass derives supplier metrics and the cached analyses:

```bash
npx prisma db seed
cd python && .venv/Scripts/python seed_compute.py
```

### Start the dev server

```bash
npm run dev
```

### Seeded test users
- Admin: `admin@mail.com` / `admin123`
- Viewer: `viewer@mail.com` / `viewer123`

## Project structure
- `app/` — Next.js pages and API routes (App Router)
- `app/(dashboard)/` — authenticated routes (sidebar + header)
- `app/login/` — authentication
- `app/api/` — API endpoints
- `components/` — shared React components (UI primitives + custom)
- `lib/` — server utilities (prisma, auth, session, period, import/append, compute helpers)
- `prisma/` — schema, migrations, seed
- `python/` — analysis compute (`seed_compute.py`, `compute_analyses.py`, `scores.py`)
- `scripts/` — one-off offline maintenance scripts, not part of the app runtime
- `data/raw/` — the dataset workbook

## Dataset

The dataset is **synthetic**. It ships as a single 12-sheet workbook,
`data/raw/procurement_dataset_full.xlsx`, which `prisma db seed` loads through the same
validation and row-mapping library the admin upload route uses — so a re-import can never
drift from the seed.

⚠️ The generator that produces the workbook is **maintained outside this repository**;
only its output is committed here. `scripts/transform_dataset.py` is a legacy offline
transformer retained for reference and is **not** part of the app's runtime path — the
app reads the workbook directly.

See `dataset_type_explainer.md` for field-level provenance.

## Reference docs
- `CLAUDE.md` — architecture of record, current state, and project rules
- `docs/architecture/` — detailed architecture maps (inventory, topology, pages, compute)
- `methodology_defense_doc.md` — defence of the analytical methodology
- `procurement_analytics_gameplan_technical.md` — analytical methodology
- `dataset_type_explainer.md` — data field definitions and provenance
- `nextjs_build_plan.md` — original architecture and phase-by-phase build plan (historical)
