import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { PERIOD_COOKIE, type PeriodSelection } from "@/lib/period-constants";

export { PERIOD_COOKIE };

/**
 * All reporting periods, most recent first (year-name periods sort correctly).
 */
export async function getAllPeriods() {
  return prisma.reportingPeriod.findMany({
    orderBy: { startDate: "desc" },
  });
}

function isPeriodSelection(value: unknown): value is PeriodSelection {
  if (!value || typeof value !== "object") return false;
  const mode = (value as { mode?: unknown }).mode;
  return mode === "single" || mode === "range";
}

/**
 * Read the `period_selection` cookie (JSON). Falls back to single-year / latest
 * period and gracefully ignores malformed or stale-shaped cookies.
 */
export async function getCurrentPeriodSelection(): Promise<PeriodSelection> {
  const periods = await getAllPeriods();
  const latest = periods[0]?.id ?? null;
  const oldest = periods[periods.length - 1]?.id ?? null;
  // First visit (no cookie) lands on RANGE mode spanning all detected years, so
  // the dashboard opens on the full dataset rather than the latest (sparse) year.
  // An existing cookie is respected below — we never override an explicit choice.
  const fallback: PeriodSelection = {
    mode: "range",
    singleId: latest,
    fromId: oldest,
    toId: latest,
  };

  const cookieStore = await cookies();
  const raw = cookieStore.get(PERIOD_COOKIE)?.value;
  if (!raw) return fallback;

  let parsed: unknown;
  try {
    parsed = JSON.parse(decodeURIComponent(raw));
  } catch {
    return fallback;
  }
  if (!isPeriodSelection(parsed)) return fallback;

  const ids = new Set(periods.map((p) => p.id));
  return {
    mode: parsed.mode,
    singleId: parsed.singleId && ids.has(parsed.singleId) ? parsed.singleId : latest,
    fromId: parsed.fromId && ids.has(parsed.fromId) ? parsed.fromId : oldest,
    toId: parsed.toId && ids.has(parsed.toId) ? parsed.toId : latest,
  };
}

/**
 * Resolve a selection to the dates spanning it (chronologically ordered), or
 * null if the referenced periods don't exist.
 */
export async function getDateRangeFromSelection(
  selection: PeriodSelection,
): Promise<{ startDate: Date; endDate: Date } | null> {
  const periods = await getAllPeriods();
  const byId = new Map(periods.map((p) => [p.id, p]));

  if (selection.mode === "single") {
    const period = selection.singleId ? byId.get(selection.singleId) : undefined;
    return period ? { startDate: period.startDate, endDate: period.endDate } : null;
  }

  const from = selection.fromId ? byId.get(selection.fromId) : undefined;
  const to = selection.toId ? byId.get(selection.toId) : undefined;
  if (!from || !to) return null;
  const [a, b] = from.startDate <= to.startDate ? [from, to] : [to, from];
  return { startDate: a.startDate, endDate: b.endDate };
}

export type AnalysisSource =
  | { kind: "empty" }
  | { kind: "cached"; periodId: string; periodLabel: string }
  | { kind: "range"; startDate: string; endDate: string; periodLabel: string };

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10); // YYYY-MM-DD in UTC
}

/**
 * Decide how a page should source its analyses:
 * - single mode, or range mode where from === to  -> cached AnalysisResult
 * - range mode where from !== to                  -> on-the-fly compute by date range
 */
export async function resolveAnalysisSource(
  selection: PeriodSelection,
): Promise<AnalysisSource> {
  const periods = await getAllPeriods();
  if (periods.length === 0) return { kind: "empty" };
  const byId = new Map(periods.map((p) => [p.id, p]));

  if (selection.mode === "single") {
    const id =
      selection.singleId && byId.has(selection.singleId)
        ? selection.singleId
        : periods[0].id;
    return { kind: "cached", periodId: id, periodLabel: byId.get(id)!.name };
  }

  const from = selection.fromId ? byId.get(selection.fromId) : undefined;
  const to = selection.toId ? byId.get(selection.toId) : undefined;
  if (!from || !to) {
    return { kind: "cached", periodId: periods[0].id, periodLabel: periods[0].name };
  }
  if (from.id === to.id) {
    return { kind: "cached", periodId: from.id, periodLabel: from.name };
  }

  const [a, b] = from.startDate <= to.startDate ? [from, to] : [to, from];
  return {
    kind: "range",
    startDate: toIsoDate(a.startDate),
    endDate: toIsoDate(b.endDate),
    periodLabel: `${a.name}–${b.name}`,
  };
}
