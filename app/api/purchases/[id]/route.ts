import { getSession } from "@/lib/auth";
import { NextResponse } from "next/server";
import { writeDisabled } from "@/lib/write-disabled";

export const runtime = "nodejs";

// Delete-purchase is disabled in the normalized-data-model build (see writeDisabled).
export async function DELETE() {
  const session = await getSession();
  if (!session || session.role !== "ADMIN") {
    return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  }
  return writeDisabled();
}
