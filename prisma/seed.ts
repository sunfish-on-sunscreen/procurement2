import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../lib/generated/prisma/client";
import bcrypt from "bcrypt";

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

// Reporting periods are NO LONGER seeded — they are auto-created from the years
// detected in uploaded data (see app/api/imports/upload/route.ts).
const users = [
  {
    email: "admin@mail.com",
    password: "admin123",
    name: "Admin User",
    role: "ADMIN" as const,
  },
  {
    email: "viewer@mail.com",
    password: "viewer123",
    name: "Viewer User",
    role: "VIEWER" as const,
  },
];

async function main() {
  try {
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

    const userCount = await prisma.user.count();
    console.log(`Seed complete: ${userCount} users (periods are created on import).`);
  } catch (error) {
    console.error("Seed failed:", error);
    process.exitCode = 1;
    throw error;
  } finally {
    await prisma.$disconnect();
  }
}

main();
