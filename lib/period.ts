import { cookies } from "next/headers";
import { prisma } from "@/lib/prisma";
import { PERIOD_COOKIE } from "@/lib/period-constants";

export { PERIOD_COOKIE };

/**
 * All reporting periods, most recent first.
 */
export async function getAllPeriods() {
  return prisma.reportingPeriod.findMany({
    orderBy: { startDate: "desc" },
  });
}

/**
 * The currently selected period id. Reads the `selected_period_id` cookie and
 * validates it against existing periods; falls back to the most recent period.
 * Returns null only when there are no periods at all.
 */
export async function getCurrentPeriodId(): Promise<string | null> {
  const periods = await getAllPeriods();
  if (periods.length === 0) {
    return null;
  }

  const cookieStore = await cookies();
  const cookieValue = cookieStore.get(PERIOD_COOKIE)?.value;

  if (cookieValue && periods.some((p) => p.id === cookieValue)) {
    return cookieValue;
  }

  return periods[0].id;
}
