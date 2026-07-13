import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import {
  nextSupplierId,
  toSupplierCreateData,
  SupplierWriteBody,
} from "@/lib/supplier-import";
import { recomputeAllPeriods } from "@/lib/recompute";
import { Prisma } from "@/lib/generated/prisma/client";

export const runtime = "nodejs";

/**
 * Create ONE supplier (admin only). Reuses the shared validation + id-gen +
 * mapper (lib/supplier-import) — the SAME logic the bulk import uses, so there's
 * one source of truth for how a supplier row is shaped. The new supplier is a
 * targeted INSERT tagged to the LATEST reporting period, THEN all periods are
 * recomputed so the addition is reflected in every analysis (roster concentration
 * is global). Recompute is synchronous; on failure we surface a real error (the
 * insert already committed). Unlike the permissive bulk import, a manual add
 * REJECTS an exact-duplicate name (409).
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const parsed = SupplierWriteBody.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid input" },
      { status: 400 },
    );
  }
  const { supplier_name, country, category } = parsed.data;

  // A manual add must have a period to tag to (suppliers aren't year-specific;
  // they hang off the latest reporting period, like the bulk import tags them).
  const latestPeriod = await prisma.reportingPeriod.findFirst({
    orderBy: { startDate: "desc" },
    select: { id: true },
  });
  if (!latestPeriod) {
    return NextResponse.json(
      { error: "No reporting period exists yet — import data first." },
      { status: 400 },
    );
  }

  // Exact-duplicate name guard (case-sensitive, trimmed). Similar-but-different
  // names pass through — that's intentional.
  const dupe = await prisma.supplier.findFirst({
    where: { supplierName: supplier_name },
    select: { externalId: true },
  });
  if (dupe) {
    return NextResponse.json(
      { error: `A supplier named "${supplier_name}" already exists (${dupe.externalId}).` },
      { status: 409 },
    );
  }

  // Assign the real next id from the DB max, then write. On the rare unique
  // collision (a concurrent add grabbed the same id), re-derive the id and retry.
  let created: { externalId: string; supplierName: string; country: string; category: string } | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    const existing = await prisma.supplier.findMany({
      select: { externalId: true },
      distinct: ["externalId"],
    });
    const externalId = nextSupplierId(existing.map((s) => s.externalId));
    try {
      created = await prisma.supplier.create({
        data: toSupplierCreateData(
          { supplier_id: externalId, supplier_name, country, category },
          latestPeriod.id,
        ),
        select: { externalId: true, supplierName: true, country: true, category: true },
      });
      break;
    } catch (err) {
      // Unique-constraint race → re-derive the id and retry; anything else fails.
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === "P2002") {
        continue;
      }
      throw err;
    }
  }

  if (!created) {
    return NextResponse.json(
      { error: "Could not assign a unique supplier id — please retry." },
      { status: 409 },
    );
  }

  // Recompute so the new supplier appears in the analyses (concentration is roster-
  // global). Synchronous — the admin waits. On failure the insert already committed,
  // so surface a real error rather than a green success.
  const { ok, failedPeriods } = await recomputeAllPeriods();
  if (!ok) {
    return NextResponse.json(
      {
        error: `Supplier saved, but analytics failed to refresh (periods: ${failedPeriods.join(", ")}). Re-run a full import to update the dashboards.`,
      },
      { status: 500 },
    );
  }

  return NextResponse.json({
    success: true,
    supplier: {
      id: created.externalId,
      name: created.supplierName,
      country: created.country,
      category: created.category,
    },
  });
}
