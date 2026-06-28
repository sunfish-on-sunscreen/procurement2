/** Small formatters shared by both detail panels. */

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2024" for a single year, "2024 – 2026" for a range. `full` is the raw span. */
export function periodSpanLabel(
  startDate: string,
  endDate: string,
): { short: string; full: string } {
  const sy = startDate.slice(0, 4);
  const ey = endDate.slice(0, 4);
  return {
    short: sy === ey ? sy : `${sy} – ${ey}`,
    full: `${startDate} to ${endDate}`,
  };
}

/** "Jun 28" from an ISO "YYYY-MM-DD" (no timezone parsing). */
export function shortDate(iso: string): string {
  const [, m, d] = iso.split("-").map(Number);
  if (!m || !d) return iso;
  return `${MONTHS[m - 1]} ${d}`;
}
