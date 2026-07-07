import { readFile } from "fs/promises";
import path from "path";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

// The two separated raw sample files (new-format ids, item_name). `?file=`
// selects which one to download; defaults to the Suppliers file.
const FILES: Record<string, { name: string; download: string }> = {
  suppliers: { name: "procurement_suppliers.xlsx", download: "procurement_suppliers_sample.xlsx" },
  purchases: { name: "procurement_purchases.xlsx", download: "procurement_purchases_sample.xlsx" },
};

export async function GET(request: Request) {
  // Any authenticated user (incl. viewer) may download the sample files.
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const which = new URL(request.url).searchParams.get("file") ?? "suppliers";
  const entry = FILES[which];
  if (!entry) {
    return new Response("Unknown sample file", { status: 400 });
  }

  const filePath = path.join(process.cwd(), "data", "raw", entry.name);
  try {
    const file = await readFile(filePath);
    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition": `attachment; filename="${entry.download}"`,
      },
    });
  } catch {
    return new Response("Sample file not found", { status: 404 });
  }
}
