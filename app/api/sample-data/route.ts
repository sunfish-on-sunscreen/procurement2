import { readFile } from "fs/promises";
import path from "path";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

// The two downloadable sample files. These OMIT the system-generated id columns
// (Suppliers has no `supplier_id`, Purchases has no `po_id`) — both auto-generate
// on import (makeIdGen: S#### / PO-#######), and each Purchases `supplier_id`
// reference still resolves against the regenerated Suppliers ids. Kept SEPARATE from
// the id-bearing `data/raw/procurement_{suppliers,purchases}.xlsx`, which remain the
// python test fixtures / import source. `?file=` selects which to download; defaults
// to the Suppliers file.
const FILES: Record<string, { name: string; download: string }> = {
  suppliers: { name: "procurement_suppliers_sample.xlsx", download: "procurement_suppliers_sample.xlsx" },
  purchases: { name: "procurement_purchases_sample.xlsx", download: "procurement_purchases_sample.xlsx" },
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
