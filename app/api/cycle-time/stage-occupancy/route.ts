import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import type { StageOccupancy, StageOccupancyRow } from "@/lib/cycle-time-types";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

// UTC calendar-day index. Read the date the same way the breakdown /
// supplier-detail routes do (toISOString → YYYY-MM-DD) so day math is TZ-safe
// regardless of how the driver hydrates the timestamp.
const epochDay = (d: Date): number => {
  const s = d.toISOString().slice(0, 10);
  return Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86_400_000;
};

type StageKey = "pr_active" | "po_active" | "delivery_active" | "invoice_active";

/**
 * Whole-integer monthly count of POs active in each of the 4 procure-to-pay
 * stages, for the selected span, using "[X] active" framing (X has occurred; the
 * PO is in the phase after it). For each PO and each stage-gap [start, end), the
 * PO counts as a whole +1 in EVERY window month the gap touches. A PO that moves
 * through two stages in one month counts +1 in both, so per-month totals across
 * the stages can exceed the PO count (intended). Population = POs tagged to the
 * window by paymentDate — the SAME filter the breakdown route + the rest of the
 * page use. Stage-months that fall outside the window (e.g. a
 * PO's PR stage in the prior December) are simply not counted; the x-axis is not
 * extended into the neighbouring year. Login required; any role.
 */
export async function GET(request: Request) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const sp = new URL(request.url).searchParams;
  const start = sp.get("start");
  const end = sp.get("end");
  if (!start || !end || !DATE_RE.test(start) || !DATE_RE.test(end)) {
    return NextResponse.json({ error: "start and end must both be YYYY-MM-DD" }, { status: 400 });
  }
  if (end < start) {
    return NextResponse.json({ error: "end must be on or after start" }, { status: 400 });
  }

  // Window months (the x-axis) from start's month through end's month.
  const sy = +start.slice(0, 4);
  const sm = +start.slice(5, 7);
  const ey = +end.slice(0, 4);
  const em = +end.slice(5, 7);
  const months: { key: string; startEpoch: number; nextEpoch: number }[] = [];
  for (let y = sy, m = sm; y < ey || (y === ey && m <= em); ) {
    months.push({
      key: `${y}-${String(m).padStart(2, "0")}`,
      startEpoch: Date.UTC(y, m - 1, 1) / 86_400_000,
      nextEpoch: Date.UTC(y, m, 1) / 86_400_000, // Date.UTC rolls Dec → next Jan
    });
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }

  // Population: POs tagged to the window by paymentDate — same filter the
  // breakdown route + the rest of the page use.
  const purchases = await prisma.purchase.findMany({
    where: {
      paymentDate: {
        gte: new Date(`${start}T00:00:00`),
        lte: new Date(`${end}T23:59:59`),
      },
    },
    select: {
      prDate: true,
      poDate: true,
      deliveryDate: true,
      invoiceDate: true,
      paymentDate: true,
    },
  });

  const acc = months.map((mo) => ({
    month: mo.key,
    pr_active: 0,
    po_active: 0,
    delivery_active: 0,
    invoice_active: 0,
  }));

  for (const p of purchases) {
    const pr = epochDay(p.prDate);
    const po = epochDay(p.poDate);
    const del = epochDay(p.deliveryDate);
    const inv = epochDay(p.invoiceDate);
    const pay = epochDay(p.paymentDate);
    const gaps: { key: StageKey; s: number; e: number }[] = [
      { key: "pr_active", s: pr, e: po },
      { key: "po_active", s: po, e: del },
      { key: "delivery_active", s: del, e: inv },
      { key: "invoice_active", s: inv, e: pay },
    ];
    months.forEach((mo, i) => {
      for (const g of gaps) {
        // Whole +1 if the gap [start, end) touches this month at all.
        const touches = Math.min(g.e, mo.nextEpoch) > Math.max(g.s, mo.startEpoch);
        if (touches) acc[i][g.key] += 1;
      }
    });
  }

  const rows: StageOccupancyRow[] = acc;
  return NextResponse.json({ months: rows } satisfies StageOccupancy);
}
