import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import { Prisma } from "@/lib/generated/prisma/client";

export const runtime = "nodejs";

const MAX_NAME = 50;

/** GET — list the signed-in admin's saved presets, newest first. */
export async function GET() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  const presets = await prisma.reportPreset.findMany({
    where: { createdBy: session.userId },
    orderBy: { updatedAt: "desc" },
    select: { id: true, name: true, config: true, updatedAt: true },
  });
  return NextResponse.json({ presets });
}

/** POST — save the current config as a new preset. Body: { name, config }. */
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
  const { name, config } = (body ?? {}) as {
    name?: unknown;
    config?: unknown;
  };

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
  if (!config || typeof config !== "object") {
    return NextResponse.json({ error: "Missing config" }, { status: 400 });
  }

  const preset = await prisma.reportPreset.create({
    data: {
      name: trimmed,
      config: config as unknown as Prisma.InputJsonValue,
      createdBy: session.userId,
    },
    select: { id: true, name: true, config: true, updatedAt: true },
  });
  return NextResponse.json({ preset }, { status: 201 });
}
