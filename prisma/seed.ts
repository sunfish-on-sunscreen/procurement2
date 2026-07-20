import "dotenv/config";
import path from "node:path";
import fs from "node:fs";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import bcrypt from "bcrypt";
import {
  SHEET_NAMES,
  parseWorkbook,
  validateDataset,
  clearDataset,
  insertDataset,
  type SheetName,
} from "../lib/dataset-import";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const DATA_FILE = path.join(
  process.cwd(),
  "data",
  "raw",
  "procurement_dataset_full.xlsx",
);

// Reporting periods: order-year buckets with calendar-year bounds. Membership is
// by PurchaseOrder.period; these bounds drive the compute layer's Mode A window.
const PERIODS = ["2024", "2025", "2026"] as const;

async function seedUsers() {
  const users = [
    { email: "admin@mail.com", password: "admin123", name: "Admin User", role: "ADMIN" as const },
    { email: "viewer@mail.com", password: "viewer123", name: "Viewer User", role: "VIEWER" as const },
  ];
  for (const u of users) {
    const passwordHash = await bcrypt.hash(u.password, 12);
    await prisma.user.upsert({
      where: { email: u.email },
      update: { name: u.name, role: u.role, passwordHash },
      create: { email: u.email, name: u.name, role: u.role, passwordHash },
    });
  }
  console.log(`  users: ${await prisma.user.count()}`);
}

async function seedPeriods() {
  for (const name of PERIODS) {
    const y = Number(name);
    await prisma.reportingPeriod.upsert({
      where: { name },
      update: {},
      create: {
        name,
        startDate: new Date(Date.UTC(y, 0, 1, 0, 0, 0)),
        endDate: new Date(Date.UTC(y, 11, 31, 23, 59, 59)),
      },
    });
  }
  console.log(`  reportingPeriods: ${await prisma.reportingPeriod.count()}`);
}

async function main() {
  try {
    if (!fs.existsSync(DATA_FILE)) {
      throw new Error(`Dataset not found: ${DATA_FILE}`);
    }
    console.log(`Seeding from ${DATA_FILE}`);

    // Parse + validate via the SAME library the admin upload route uses, so the
    // seed and a re-import can never diverge.
    const dataset = parseWorkbook(new Uint8Array(fs.readFileSync(DATA_FILE)));
    const errors = validateDataset(dataset);
    if (errors.length > 0) {
      console.error("Dataset validation failed:");
      errors.forEach((e) => console.error(`  - ${e}`));
      throw new Error(`${errors.length} validation error(s) — nothing was written.`);
    }

    console.log("Auth + periods:");
    await seedUsers();
    await seedPeriods();

    console.log("Clearing transaction tables…");
    // Posted transactional tables are immutable (BEFORE UPDATE triggers). DELETE is
    // allowed, but the correction FKs use ON DELETE SET NULL and referential actions
    // fire triggers, so the wipe below needs the sanctioned bulk-import escape hatch.
    // Session-scoped here (the seed does not run inside one transaction).
    await prisma.$executeRawUnsafe("SET app.bulk_import = 'on'");
    // The seed replaces the supplier master outright, so master-data audit history
    // from a previous dataset is discarded. (The admin re-import instead preserves
    // what still resolves — see app/api/imports/upload.) SupplierChangeLog FKs
    // Supplier with ON DELETE RESTRICT, so this must precede the supplier wipe.
    await prisma.supplierChangeLog.deleteMany();
    // Correction FKs PurchaseOrder with RESTRICT, so correction headers must go
    // before the transaction wipe. A re-seed replaces the very lines they correct.
    await prisma.correction.deleteMany();
    await clearDataset(prisma);

    console.log("Inserting normalized transaction data (FK order):");
    await insertDataset(prisma, dataset, (sheet, n) =>
      console.log(`  ${sheet}: inserted ${n}`),
    );

    // --- CHECKPOINT: DB counts vs file row counts --------------------------
    const dbCounts: Record<SheetName, number> = {
      suppliers: await prisma.supplier.count(),
      frameworks: await prisma.framework.count(),
      requisitions: await prisma.requisition.count(),
      sourcing_events: await prisma.sourcingEvent.count(),
      responses: await prisma.response.count(),
      purchase_orders: await prisma.purchaseOrder.count(),
      po_lines: await prisma.poLine.count(),
      goods_receipts: await prisma.goodsReceipt.count(),
      grn_lines: await prisma.grnLine.count(),
      invoices: await prisma.invoice.count(),
      invoice_lines: await prisma.invoiceLine.count(),
      payments: await prisma.payment.count(),
    };

    console.log("\n=== CHECKPOINT: row counts (DB vs file) ===");
    let allMatch = true;
    for (const key of SHEET_NAMES) {
      const db = dbCounts[key];
      const file = dataset[key].length;
      const ok = db === file;
      if (!ok) allMatch = false;
      console.log(
        `  ${key.padEnd(16)} DB=${String(db).padStart(5)}  file=${String(file).padStart(5)}  ${ok ? "OK" : "*** MISMATCH ***"}`,
      );
    }
    console.log(
      `\nreportingPeriods: ${await prisma.reportingPeriod.count()}  |  users: ${await prisma.user.count()}`,
    );
    console.log(allMatch ? "\nAll 12 tables reconcile with the file. ✅" : "\n*** COUNT MISMATCH — investigate. ***");
    if (!allMatch) process.exitCode = 1;
  } catch (error) {
    console.error("Seed failed:", error);
    process.exitCode = 1;
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main();
