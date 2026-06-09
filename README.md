# Procurement Analytics

A Next.js web app for presenting mining procurement analytics from synthetic data.
Multi-user with auth, single organization, fixed analytical methodology.

## Tech stack
Next.js 16 (App Router), TypeScript, Prisma 7, PostgreSQL, Tailwind v4, shadcn/ui,
Recharts, bcrypt + iron-session, Python (for analysis compute scripts).

## Local setup

### Prerequisites
- Node.js 20+
- PostgreSQL 17+ running locally
- Python 3.10+

### Installation

```bash
# Clone and install
npm install

# Create the database (one-time)
psql -U postgres -c "CREATE DATABASE procurement_analytics;"

# Configure environment
cp .env.example .env
# Edit .env: set DATABASE_URL, SESSION_SECRET (32+ chars), NODE_ENV

# Generate Prisma client (required after every clone)
npx prisma generate

# Run migrations
npx prisma migrate dev

# Seed the database
npx prisma db seed

# Start dev server
npm run dev
```

### Seeded test users
- Admin: `admin@adaro.com` / `admin123`
- Viewer: `viewer@adaro.com` / `viewer123`

## Project structure
- `app/` — Next.js pages and API routes (App Router)
- `app/(dashboard)/` — Authenticated routes (sidebar + header)
- `app/login/` — Authentication
- `app/api/` — API endpoints
- `components/` — Shared React components (UI primitives + custom)
- `lib/` — Server utilities (prisma, auth, session, period)
- `prisma/` — Schema, migrations, seed
- `python/` — Analysis compute scripts (Phase 7+)
- `data/raw/` — Sample data for testing

## Reference docs
- `CLAUDE.md` — Project rules for AI assistance
- `nextjs_build_plan.md` — Full architecture and phase-by-phase build plan
- `procurement_analytics_gameplan_technical.md` — Analytical methodology
- `dataset_type_explainer.md` — Data field definitions and provenance
