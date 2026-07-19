import { getSession } from "@/lib/auth";
import { NextResponse } from "next/server";
import { writeDisabled } from "@/lib/write-disabled";

export const runtime = "nodejs";

// Bulk xlsx upload assumed the flat two-file (Suppliers + Purchases) schema, which
// no longer exists in the normalized data model. Disabled; the seed loads data now.
export async function POST() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return writeDisabled();
}
