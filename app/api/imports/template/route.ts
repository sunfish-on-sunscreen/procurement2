import { NextResponse } from "next/server";
import { getSession } from "@/lib/auth";
import { buildTemplateWorkbook } from "@/lib/dataset-template";

export const runtime = "nodejs";

/**
 * Download the import template. Generated on the fly from REQUIRED_COLUMNS — the
 * same constant the validator checks — so it cannot drift from what the importer
 * accepts. Any signed-in user may download it; only admins can upload.
 */
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const buffer = buildTemplateWorkbook();
  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": 'attachment; filename="procurement_dataset_template.xlsx"',
      "Content-Length": String(buffer.byteLength),
      "Cache-Control": "no-store",
    },
  });
}
