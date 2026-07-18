/** Small formatters shared by both detail panels. */

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
