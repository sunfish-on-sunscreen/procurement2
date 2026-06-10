import { readFile } from "fs/promises";
import path from "path";
import { getSession } from "@/lib/auth";

export const runtime = "nodejs";

export async function GET() {
  // Any authenticated user (incl. viewer) may download the sample file.
  const session = await getSession();
  if (!session) {
    return new Response("Unauthorized", { status: 401 });
  }

  const filePath = path.join(
    process.cwd(),
    "data",
    "raw",
    "procurement_data.xlsx",
  );

  try {
    const file = await readFile(filePath);
    return new Response(new Uint8Array(file), {
      headers: {
        "Content-Type":
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "Content-Disposition":
          'attachment; filename="procurement_data_sample.xlsx"',
      },
    });
  } catch {
    return new Response("Sample file not found", { status: 404 });
  }
}
