/**
 * One-time migration: re-tag Purchase rows (and the catalog Supplier /
 * SupplierMetric rows) to reporting periods keyed by PAYMENT date instead of
 * PR date. Mirrors the upload route's tagging logic so a migrated database
 * matches a fresh import.
 *
 * Usage:
 *   npx tsx scripts/migrate-period-tags.ts            # tag by payment date (default)
 *   npx tsx scripts/migrate-period-tags.ts --by=pr    # REVERT: tag by PR date
 *
 * Reversibility: the mapping is deterministic from each row's own dates, so
 * re-running with `--by=pr` restores the previous (PR-date) tagging exactly.
 * Periods are upserted by name; nothing is deleted. Idempotent.
 */
import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

type By = "payment" | "pr";

function parseArgs(): By {
  const arg = process.argv.find((a) => a.startsWith("--by="));
  const by = arg?.split("=")[1];
  if (by === "pr") return "pr";
  if (by === "payment" || by === undefined) return "payment";
  throw new Error(`Unknown --by value: ${by} (expected "payment" or "pr")`);
}

async function ensurePeriod(year: number): Promise<string> {
  const rp = await prisma.reportingPeriod.upsert({
    where: { name: String(year) },
    create: {
      name: String(year),
      startDate: new Date(Date.UTC(year, 0, 1)),
      endDate: new Date(Date.UTC(year, 11, 31, 23, 59, 59)),
    },
    update: {}, // never mutate an existing period
  });
  return rp.id;
}

async function main() {
  const by = parseArgs();
  console.log(`Re-tagging periods by ${by.toUpperCase()} date...`);

  const purchases = await prisma.purchase.findMany({
    select: { id: true, prDate: true, paymentDate: true },
  });
  if (purchases.length === 0) {
    console.log("No purchases found; nothing to migrate.");
    return;
  }

  // Bucket purchase ids by target year.
  const idsByYear = new Map<number, string[]>();
  for (const p of purchases) {
    const ref =
      by === "payment" ? (p.paymentDate ?? p.prDate) : p.prDate;
    const year = ref.getUTCFullYear();
    if (!idsByYear.has(year)) idsByYear.set(year, []);
    idsByYear.get(year)!.push(p.id);
  }

  const years = [...idsByYear.keys()].sort((a, b) => a - b);
  console.log(`Detected years: ${years.join(", ")}`);

  // Upsert all periods first, then re-tag inside one transaction.
  const yearToPeriodId = new Map<number, string>();
  for (const y of years) yearToPeriodId.set(y, await ensurePeriod(y));
  const maxYearPeriodId = yearToPeriodId.get(years[years.length - 1])!;

  await prisma.$transaction(
    async (tx) => {
      for (const y of years) {
        const ids = idsByYear.get(y)!;
        await tx.purchase.updateMany({
          where: { id: { in: ids } },
          data: { periodId: yearToPeriodId.get(y)! },
        });
      }
      // Catalog rows aren't year-specific (analyses derive suppliers from the
      // filtered purchases, never from this tag). Keep them on the max year,
      // matching the upload route's "max year wins" behaviour.
      await tx.supplier.updateMany({ data: { periodId: maxYearPeriodId } });
      await tx.supplierMetric.updateMany({ data: { periodId: maxYearPeriodId } });
    },
    { timeout: 30000 },
  );

  for (const y of years) {
    console.log(`  ${y}: ${idsByYear.get(y)!.length} purchases`);
  }
  console.log(
    `Done. Suppliers + metrics tagged to ${years[years.length - 1]}.`,
  );
}

main()
  .catch((err) => {
    console.error("Migration failed:", err);
    process.exitCode = 1;
  })
  .finally(() => prisma.$disconnect());
