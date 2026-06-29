import { NextResponse } from "next/server";
import { prisma } from "@/lib/prisma";
import { getSession } from "@/lib/auth";
import {
  getAnalysisResult,
  type AbcResult,
  type KraljicResult,
} from "@/lib/analysis-types";
import { getRangeAnalyses } from "@/lib/range-analyses";
import { computeScores } from "@/lib/score-methodology";
import type { SpendDetail } from "@/lib/spend-overview-types";

export const runtime = "nodejs";

const iso = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);

/**
 * Period-scoped spend decomposition for one supplier (by externalId): identity +
 * stats + spend-by-item + every PO in the selected span. ABC/Kraljic chips are
 * scoped to the SELECTED period (via getRangeAnalyses — same source as the
 * ranking table), so a supplier absent from that period shows "—".
 *
 * Suppliers with no in-span activity but a real identity still return 200 with
 * zeroed stats (the panel renders an honest "no activity in this period" view).
 * 404 only for a genuinely unknown supplier id. Login required; any role.
 */
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const { id } = await params;

  // Optional period scope. Both must be valid YYYY-MM-DD with end >= start;
  // omit both for all-time (backward compat). invoiceDate is non-null here, so
  // filtering it matches the COALESCE(invoiceDate, prDate) tag the ranking uses.
  const sp = new URL(request.url).searchParams;
  const start = sp.get("start");
  const end = sp.get("end");
  let dateFilter: { gte: Date; lte: Date } | undefined;
  if (start || end) {
    if (!start || !end || !DATE_RE.test(start) || !DATE_RE.test(end)) {
      return NextResponse.json(
        { error: "start and end must both be YYYY-MM-DD" },
        { status: 400 },
      );
    }
    if (end < start) {
      return NextResponse.json(
        { error: "end must be on or after start" },
        { status: 400 },
      );
    }
    dateFilter = {
      gte: new Date(`${start}T00:00:00`),
      lte: new Date(`${end}T23:59:59`),
    };
  }

  // Identity first, so suppliers absent from the span still render. Also load
  // ALL periods + this supplier's per-period metric rows so performance can be
  // scoped to the selected span (single-period composite / range composite).
  const [metricRows, supplier, periods] = await Promise.all([
    prisma.supplierMetric.findMany({
      where: { supplierExternalId: id },
      select: {
        periodId: true,
        supplierName: true,
        category: true,
        tier: true,
        compositeScore: true,
        defectRatePct: true,
        complaintCountAnnual: true,
        onTimeDeliveryPct: true,
        avgLeadTimeDays: true,
        avgResponseTimeDays: true,
        rfxResponseRatePct: true,
        threeWayMatchPct: true,
        singleSourceRisk: true,
        // Stored sub-scores (single-period subScores read these directly).
        qualityScore: true,
        deliveryScore: true,
        serviceScore: true,
        processScore: true,
        riskScore: true,
      },
    }),
    prisma.supplier.findFirst({
      where: { externalId: id },
      orderBy: { periodId: "desc" },
      select: { supplierName: true, country: true, category: true, tier: true },
    }),
    prisma.reportingPeriod.findMany({
      orderBy: { startDate: "asc" },
      select: { id: true, name: true, startDate: true, endDate: true },
    }),
  ]);

  // Genuinely unknown supplier → 404. (Absence from a PERIOD is a 200 below.)
  if (metricRows.length === 0 && !supplier) {
    return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
  }

  // periodId → composite, and the latest-period metric row (for identity + the
  // constant soft inputs used by the range composite).
  const periodOrder = new Map(periods.map((p, i) => [p.id, i]));
  const compositeByPeriod = new Map(
    metricRows.map((m) => [m.periodId, m.compositeScore]),
  );
  const metricByPeriod = new Map(metricRows.map((m) => [m.periodId, m]));
  // Map a stored metric row's five sub-scores into the response shape.
  const storedSubScores = (m: (typeof metricRows)[number]) => ({
    quality: m.qualityScore,
    delivery: m.deliveryScore,
    service: m.serviceScore,
    process: m.processScore,
    risk: m.riskScore,
  });
  const latestMetric =
    metricRows.length > 0
      ? metricRows.reduce((a, b) =>
          (periodOrder.get(b.periodId) ?? -1) > (periodOrder.get(a.periodId) ?? -1) ? b : a,
        )
      : null;
  const metric = latestMetric;

  const purchases = await prisma.purchase.findMany({
    where: {
      supplierExternalId: id,
      ...(dateFilter ? { invoiceDate: dateFilter } : {}),
    },
    select: {
      poId: true,
      supplierName: true,
      itemDescription: true,
      unit: true,
      quantity: true,
      unitPriceUsd: true,
      totalValueUsd: true,
      prDate: true,
      invoiceDate: true,
      // Inputs for the range composite (A7): aggregated below into delivery /
      // process means over the in-span POs.
      poToDeliveryDays: true,
      onTimeDelivery: true,
      threeWayMatchPass: true,
    },
  });

  // ABC + Kraljic scoped to the SELECTED period (same source as the ranking).
  // With no span, fall back to the latest period's analysis (backward compat).
  let abcClass: SpendDetail["supplier"]["abcClass"] = null;
  let kraljicQuadrant: SpendDetail["supplier"]["kraljicQuadrant"] = null;
  if (start && end) {
    const analyses = await getRangeAnalyses(start, end);
    abcClass =
      analyses?.abc?.classifications.find((c) => c.supplier_id === id)?.abc_class ?? null;
    kraljicQuadrant =
      analyses?.kraljic?.quadrant_assignments.find((q) => q.supplier_id === id)
        ?.quadrant ?? null;
  } else {
    const latestPeriod = await prisma.reportingPeriod.findFirst({
      orderBy: { startDate: "desc" },
      select: { id: true },
    });
    if (latestPeriod) {
      const [abc, kraljic] = await Promise.all([
        getAnalysisResult<AbcResult>(latestPeriod.id, "abc"),
        getAnalysisResult<KraljicResult>(latestPeriod.id, "kraljic"),
      ]);
      abcClass = abc?.classifications.find((c) => c.supplier_id === id)?.abc_class ?? null;
      kraljicQuadrant =
        kraljic?.quadrant_assignments.find((q) => q.supplier_id === id)?.quadrant ?? null;
    }
  }

  // Stats + spend-by-item, aggregated over the in-span POs (0 POs → zeros).
  let totalSpend = 0;
  let earliest: Date | null = null;
  let latest: Date | null = null;
  // Accumulators for the range composite's delivery/process inputs.
  let leadSum = 0;
  let otdCount = 0;
  let twmCount = 0;
  const byItemMap = new Map<string, { poCount: number; totalSpend: number }>();
  for (const p of purchases) {
    totalSpend += p.totalValueUsd;
    leadSum += p.poToDeliveryDays;
    if (p.onTimeDelivery) otdCount += 1;
    if (p.threeWayMatchPass) twmCount += 1;
    const d = p.invoiceDate ?? p.prDate;
    if (d && (!earliest || d < earliest)) earliest = d;
    if (d && (!latest || d > latest)) latest = d;
    const cur = byItemMap.get(p.itemDescription) ?? { poCount: 0, totalSpend: 0 };
    cur.poCount += 1;
    cur.totalSpend += p.totalValueUsd;
    byItemMap.set(p.itemDescription, cur);
  }

  const byItem = [...byItemMap.entries()]
    .map(([itemDescription, v]) => ({ itemDescription, ...v }))
    .sort((a, b) => b.totalSpend - a.totalSpend);

  const pos = purchases
    .map((p) => ({
      poId: p.poId,
      itemDescription: p.itemDescription,
      prDate: iso(p.prDate),
      invoiceDate: iso(p.invoiceDate),
      quantity: p.quantity,
      unit: p.unit,
      unitPriceUsd: p.unitPriceUsd,
      totalValueUsd: p.totalValueUsd,
    }))
    .sort((a, b) =>
      (b.invoiceDate ?? b.prDate ?? "").localeCompare(
        a.invoiceDate ?? a.prDate ?? "",
      ),
    );

  // --- Period-scoped performance (A3/A7) ------------------------------------ #
  // Which periods fall inside the selected span (same containment rule as the
  // Python compute: period fully within [start, end]). Period dates are stored
  // in UTC, so the window bounds must be UTC too — parsing "YYYY-MM-DDT…" without
  // a Z would use the server's local zone and mis-bound the comparison.
  const inWindow =
    start && end
      ? periods.filter(
          (p) =>
            p.startDate >= new Date(`${start}T00:00:00.000Z`) &&
            p.endDate <= new Date(`${end}T23:59:59.999Z`),
        )
      : [];

  const performance: SpendDetail["supplier"]["performance"] = {
    score: null,
    mode: "all",
    periodLabel: null,
    previousScore: null,
    previousLabel: null,
    latestScore: null,
    latestLabel: null,
  };
  // Period-scoped sub-score breakdown (consumed by the classification panel;
  // the Spend Overview panel ignores it). Single/all read stored sub-scores;
  // range derives them from the same aggregated inputs as the range composite.
  let subScores: SpendDetail["supplier"]["subScores"] = null;

  if (!dateFilter) {
    // No span → latest snapshot (backward compat).
    performance.mode = "all";
    performance.score = latestMetric?.compositeScore ?? null;
    performance.periodLabel = latestMetric
      ? (periods.find((p) => p.id === latestMetric.periodId)?.name ?? null)
      : null;
    if (latestMetric) subScores = storedSubScores(latestMetric);
  } else if (inWindow.length === 1) {
    // Single-year → that period's composite + previous active period for delta.
    performance.mode = "single";
    const sel = inWindow[0];
    performance.score = compositeByPeriod.get(sel.id) ?? null;
    performance.periodLabel = sel.name;
    const selMetric = metricByPeriod.get(sel.id);
    if (selMetric) subScores = storedSubScores(selMetric);
    const selIdx = periodOrder.get(sel.id) ?? -1;
    // Nearest earlier period that the supplier actually has a metric row for.
    const prev = [...periods]
      .filter((p) => (periodOrder.get(p.id) ?? -1) < selIdx && compositeByPeriod.has(p.id))
      .pop();
    if (prev) {
      performance.previousScore = compositeByPeriod.get(prev.id) ?? null;
      performance.previousLabel = prev.name;
    }
  } else if (inWindow.length > 1) {
    // Range → composite from raw inputs aggregated over the span + latest
    // snapshot. "Latest" is the most recent in-window period the supplier is
    // actually active in (skip trailing inactive years).
    performance.mode = "range";
    performance.periodLabel = `${inWindow[0].name}–${inWindow[inWindow.length - 1].name}`;
    const lastActive = [...inWindow]
      .filter((p) => compositeByPeriod.has(p.id))
      .pop();
    if (lastActive) {
      performance.latestScore = compositeByPeriod.get(lastActive.id) ?? null;
      performance.latestLabel = lastActive.name;
    }
    if (latestMetric && purchases.length > 0) {
      const n = purchases.length;
      // Span-aggregated raw inputs (delivery/process recomputed over the in-span
      // POs; soft survey inputs constant from the latest snapshot).
      const b = computeScores({
        defectRatePct: latestMetric.defectRatePct,
        complaintCountAnnual: latestMetric.complaintCountAnnual,
        onTimeDeliveryPct: (otdCount / n) * 100,
        avgLeadTimeDays: leadSum / n,
        avgResponseTimeDays: latestMetric.avgResponseTimeDays,
        rfxResponseRatePct: latestMetric.rfxResponseRatePct,
        threeWayMatchPct: (twmCount / n) * 100,
        singleSourceRisk: latestMetric.singleSourceRisk,
        country: supplier?.country ?? "",
      });
      performance.score = b.compositeScore;
      subScores = {
        quality: b.qualityScore,
        delivery: b.deliveryScore,
        service: b.serviceScore,
        process: b.processScore,
        risk: b.riskScore,
      };
    }
  }

  // Period-scoped portfolio context (Spend insights cards): rank by spend, share
  // of the period total, and active-supplier count — one grouped aggregate over
  // the same span. A supplier absent from the span isn't in the groups, so its
  // rank/percent are null.
  const spendBySupplier = await prisma.purchase.groupBy({
    by: ["supplierExternalId"],
    where: dateFilter ? { invoiceDate: dateFilter } : {},
    _sum: { totalValueUsd: true },
  });
  const activeSupplierCount = spendBySupplier.length;
  const periodTotal = spendBySupplier.reduce((acc, r) => acc + (r._sum.totalValueUsd ?? 0), 0);
  const rankIdx = spendBySupplier
    .map((r) => ({ id: r.supplierExternalId, spend: r._sum.totalValueUsd ?? 0 }))
    .sort((a, b) => b.spend - a.spend)
    .findIndex((r) => r.id === id);
  const rank = rankIdx >= 0 && totalSpend > 0 ? rankIdx + 1 : null;
  const percentOfTotal =
    totalSpend > 0 && periodTotal > 0 ? (totalSpend / periodTotal) * 100 : null;

  const detail: SpendDetail = {
    supplier: {
      id,
      name: metric?.supplierName ?? supplier?.supplierName ?? purchases[0]?.supplierName ?? id,
      category: metric?.category ?? supplier?.category ?? null,
      tier: metric?.tier ?? supplier?.tier ?? null,
      country: supplier?.country ?? null,
      abcClass,
      kraljicQuadrant,
      performance,
      subScores,
    },
    stats: {
      totalSpend,
      poCount: purchases.length,
      earliestDate: iso(earliest),
      latestDate: iso(latest),
      avgPoValue: purchases.length > 0 ? totalSpend / purchases.length : 0,
      rank,
      percentOfTotal,
      activeSupplierCount,
    },
    byItem,
    pos,
  };

  return NextResponse.json(detail);
}
