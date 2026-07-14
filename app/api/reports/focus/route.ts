import { NextResponse } from "next/server";
import { z } from "zod";
import { getSession } from "@/lib/auth";
import { assembleSupplierFocus } from "@/lib/report-focus";

export const runtime = "nodejs";

const dateField = z
  .string()
  .refine((s) => /^\d{4}-\d{2}-\d{2}/.test(s), "Expected YYYY-MM-DD")
  .transform((s) => s.slice(0, 10));

const bodySchema = z.object({
  supplierId: z.string().min(1),
  startDate: dateField,
  endDate: dateField,
});

/**
 * Per-supplier FOCUS data for a report span: the item breakdown + YoY trajectory a
 * Focus → supplier brief needs. Read-only; runs the same queries as the modal's
 * spend-detail + evolution routes (see lib/report-focus) so the brief's numbers
 * match the app exactly. Any authenticated user (same as /api/reports/analyses).
 */
export async function POST(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = bodySchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }
  const { supplierId, startDate, endDate } = parsed.data;

  const data = await assembleSupplierFocus(supplierId, startDate, endDate);
  return NextResponse.json(data);
}
