import { shortDate } from "@/lib/panel-format";

/**
 * Activity timeline (decision F): start/end labels on opposite ends, a 6px bar
 * showing where the supplier's active range sits within the selected period,
 * and a muted descriptor. Theme tokens only. Falls back to a muted line when
 * there's no activity.
 */
export function ActivityBar({
  earliest,
  latest,
  periodStart,
  periodEnd,
  descriptor,
}: {
  earliest: string | null;
  latest: string | null;
  periodStart: string;
  periodEnd: string;
  descriptor: string;
}) {
  if (!earliest || !latest) {
    return <p className="text-xs text-muted-foreground">No activity in this period</p>;
  }
  const ps = Date.parse(periodStart);
  const pe = Date.parse(periodEnd);
  const span = pe - ps || 1;
  const pct = (iso: string) =>
    Math.max(0, Math.min(100, ((Date.parse(iso) - ps) / span) * 100));
  const left = pct(earliest);
  const width = Math.max(2, pct(latest) - left); // min 2% so a single day is visible

  return (
    <div className="flex flex-col gap-1">
      <div className="flex justify-between text-[11px] text-muted-foreground">
        <span>{shortDate(earliest)}</span>
        <span>{shortDate(latest)}</span>
      </div>
      <div
        className="relative h-1.5 w-full overflow-hidden rounded-full"
        style={{ backgroundColor: "color-mix(in srgb, var(--muted-foreground) 18%, transparent)" }}
      >
        <div
          className="absolute h-full rounded-full"
          style={{ left: `${left}%`, width: `${width}%`, backgroundColor: "var(--primary)" }}
        />
      </div>
      <div className="text-right text-[11px] text-muted-foreground">{descriptor}</div>
    </div>
  );
}
