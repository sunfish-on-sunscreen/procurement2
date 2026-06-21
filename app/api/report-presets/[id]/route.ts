import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { Prisma } from "@/lib/generated/prisma/client";

export const runtime = "nodejs";

const MAX_NAME = 50;

type Ctx = { params: Promise<{ id: string }> };

/** PUT — update a preset's name and/or config. Body: { name?, config? }. */
export async function PUT(request: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const { name, config } = (body ?? {}) as { name?: unknown; config?: unknown };

  const data: Prisma.ReportPresetUpdateInput = {};
  if (name !== undefined) {
    const trimmed = typeof name === "string" ? name.trim() : "";
    if (!trimmed) {
      return NextResponse.json({ error: "Name is required" }, { status: 400 });
    }
    if (trimmed.length > MAX_NAME) {
      return NextResponse.json(
        { error: `Name must be ${MAX_NAME} characters or fewer` },
        { status: 400 },
      );
    }
    data.name = trimmed;
  }
  if (config !== undefined) {
    if (!config || typeof config !== "object") {
      return NextResponse.json({ error: "Invalid config" }, { status: 400 });
    }
    data.config = config as unknown as Prisma.InputJsonValue;
  }

  // Ownership-scoped update: only rows the caller owns are touched.
  const result = await prisma.reportPreset.updateMany({
    where: { id, createdBy: session.userId },
    data,
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "Preset not found" }, { status: 404 });
  }
  const preset = await prisma.reportPreset.findUnique({
    where: { id },
    select: { id: true, name: true, config: true, updatedAt: true },
  });
  return NextResponse.json({ preset });
}

/** DELETE — remove a preset the caller owns. */
export async function DELETE(_request: Request, { params }: Ctx) {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const { id } = await params;
  const result = await prisma.reportPreset.deleteMany({
    where: { id, createdBy: session.userId },
  });
  if (result.count === 0) {
    return NextResponse.json({ error: "Preset not found" }, { status: 404 });
  }
  return NextResponse.json({ ok: true });
}
