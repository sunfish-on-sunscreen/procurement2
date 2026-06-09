import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import bcrypt from "bcrypt";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

const reportingPeriods = [
  {
    name: "FY 2024",
    startDate: new Date("2024-01-01"),
    endDate: new Date("2024-12-31"),
    isLocked: false,
  },
  {
    name: "FY 2025",
    startDate: new Date("2025-01-01"),
    endDate: new Date("2025-12-31"),
    isLocked: false,
  },
  {
    name: "FY 2024-2025 Combined",
    startDate: new Date("2024-01-01"),
    endDate: new Date("2025-12-31"),
    isLocked: false,
  },
];

const users = [
  {
    email: "admin@adaro.com",
    password: "admin123",
    name: "Admin User",
    role: "ADMIN" as const,
  },
  {
    email: "viewer@adaro.com",
    password: "viewer123",
    name: "Viewer User",
    role: "VIEWER" as const,
  },
];

async function main() {
  try {
    // Reporting periods (idempotent via unique `name`)
    for (const period of reportingPeriods) {
      await prisma.reportingPeriod.upsert({
        where: { name: period.name },
        update: {
          startDate: period.startDate,
          endDate: period.endDate,
          isLocked: period.isLocked,
        },
        create: period,
      });
    }

    // Users with bcrypt-hashed passwords (12 rounds), idempotent via unique `email`
    for (const user of users) {
      const passwordHash = await bcrypt.hash(user.password, 12);
      await prisma.user.upsert({
        where: { email: user.email },
        update: {
          name: user.name,
          role: user.role,
          passwordHash,
        },
        create: {
          email: user.email,
          name: user.name,
          role: user.role,
          passwordHash,
        },
      });
    }

    const periodCount = await prisma.reportingPeriod.count();
    const userCount = await prisma.user.count();
    console.log(
      `Seed complete: ${userCount} users, ${periodCount} reporting periods.`,
    );
  } catch (error) {
    console.error("Seed failed:", error);
    process.exitCode = 1;
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main();
