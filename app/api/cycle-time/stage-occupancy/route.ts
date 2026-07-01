import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import type { StageOccupancy, StageOccupancyRow } from "@/lib/cycle-time-types";

export const runtime = "nodejs";

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const round1 = (x: number) => Math.round(x * 10) / 10;

// UTC calendar-day index. Read the date the same way the breakdown /
// supplier-detail routes do (toISOString → YYYY-MM-DD) so day math is TZ-safe
// regardless of how the driver hydrates the timestamp.
const epochDay = (d: Date): number => {
  const s = d.toISOString().slice(0, 10);
  return Date.UTC(+s.slice(0, 4), +s.slice(5, 7) - 1, +s.slice(8, 10)) / 86_400_000;
};

type StageKey = "pr_active" | "po_active" | "delivery_active" | "invoice_active";

/**
 * Fractional (time-weighted) monthly occupancy of the 4 procure-to-pay stages,
 * for the selected span, using "[X] active" framing (X has occurred; the PO is
 * in the phase after it). For each PO, each stage-gap [start, end), and each
 * month M in the window, the PO contributes (days the gap overlapped M ÷ days in
 * M) to that stage — so a PO live for all of M sums to 1.0 across its stages (no
 * double-count, no month-boundary distortion). Payment is the exit, so there is
 * no payment series. Population = POs whose lifecycle [prDate, paymentDate]
 * overlaps the window (occupancy needs overlap, not the invoice-date tagging the
 * rest of the page uses). Login required; any role.
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

  // Population: any PO whose lifecycle overlaps the window.
  const purchases = await prisma.purchase.findMany({
    where: {
      prDate: { lte: new Date(`${end}T23:59:59`) },
      paymentDate: { gte: new Date(`${start}T00:00:00`) },
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
      const daysInMonth = mo.nextEpoch - mo.startEpoch;
      for (const g of gaps) {
        const overlap = Math.min(g.e, mo.nextEpoch) - Math.max(g.s, mo.startEpoch);
        if (overlap > 0) acc[i][g.key] += overlap / daysInMonth;
      }
    });
  }

  const rows: StageOccupancyRow[] = acc.map((r) => ({
    month: r.month,
    pr_active: round1(r.pr_active),
    po_active: round1(r.po_active),
    delivery_active: round1(r.delivery_active),
    invoice_active: round1(r.invoice_active),
  }));

  return NextResponse.json({ months: rows } satisfies StageOccupancy);
}
