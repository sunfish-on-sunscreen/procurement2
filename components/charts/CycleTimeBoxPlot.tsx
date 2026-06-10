"use client";

import type { HypothesisResult, HypothesisStats } from "@/lib/analysis-types";

type Box = { label: string; s: HypothesisStats; color: string };

function isComplete(s: HypothesisStats): boolean {
  return (
    s.min != null &&
    s.max != null &&
    s.q1 != null &&
    s.q3 != null &&
    s.median != null
  );
}

export function CycleTimeBoxPlot({ data }: { data: HypothesisResult }) {
  const boxes: Box[] = [
    { label: "Pre (2024)", s: data.pre_stats, color: "#3b82f6" },
    { label: "Post (2025)", s: data.post_stats, color: "#10b981" },
  ].filter((b) => isComplete(b.s));

  if (boxes.length === 0) return null;

  const extremes = boxes.flatMap((b) => [b.s.min as number, b.s.max as number]);
  const dmin = Math.min(...extremes);
  const dmax = Math.max(...extremes);
  const pad = (dmax - dmin) * 0.08 || 1;
  const lo = dmin - pad;
  const hi = dmax + pad;

  const W = 420;
  const H = 320;
  const ml = 44;
  const mr = 16;
  const mt = 16;
  const mb = 40;
  const plotW = W - ml - mr;
  const plotH = H - mt - mb;
  const y = (v: number) => mt + plotH * (1 - (v - lo) / (hi - lo));
  const bandW = plotW / boxes.length;
  const ticks = Array.from({ length: 5 }, (_, i) => lo + ((hi - lo) * i) / 4);

  return (
    <div className="w-full">
      <svg
        viewBox={`0 0 ${W} ${H}`}
        className="h-[320px] w-full"
        preserveAspectRatio="xMidYMid meet"
        role="img"
        aria-label="Box plot of invoice-to-payment days, pre vs post automation"
      >
        {ticks.map((t, i) => (
          <g key={i}>
            <line
              x1={ml}
              y1={y(t)}
              x2={W - mr}
              y2={y(t)}
              stroke="currentColor"
              strokeOpacity={0.1}
            />
            <text
              x={ml - 6}
              y={y(t) + 3}
              textAnchor="end"
              fontSize={10}
              fill="currentColor"
              opacity={0.6}
            >
              {t.toFixed(0)}
            </text>
          </g>
        ))}

        {boxes.map((b, i) => {
          const cx = ml + bandW * (i + 0.5);
          const boxW = Math.min(90, bandW * 0.45);
          const s = b.s;
          return (
            <g key={b.label}>
              {/* whiskers */}
              <line x1={cx} y1={y(s.min!)} x2={cx} y2={y(s.q1!)} stroke={b.color} strokeWidth={1.5} />
              <line x1={cx} y1={y(s.q3!)} x2={cx} y2={y(s.max!)} stroke={b.color} strokeWidth={1.5} />
              <line x1={cx - boxW / 3} y1={y(s.min!)} x2={cx + boxW / 3} y2={y(s.min!)} stroke={b.color} strokeWidth={1.5} />
              <line x1={cx - boxW / 3} y1={y(s.max!)} x2={cx + boxW / 3} y2={y(s.max!)} stroke={b.color} strokeWidth={1.5} />
              {/* box (q1..q3) */}
              <rect
                x={cx - boxW / 2}
                y={y(s.q3!)}
                width={boxW}
                height={Math.max(1, y(s.q1!) - y(s.q3!))}
                fill={b.color}
                fillOpacity={0.18}
                stroke={b.color}
                strokeWidth={1.5}
              />
              {/* median */}
              <line
                x1={cx - boxW / 2}
                y1={y(s.median!)}
                x2={cx + boxW / 2}
                y2={y(s.median!)}
                stroke={b.color}
                strokeWidth={2.5}
              />
              <text x={cx} y={H - 18} textAnchor="middle" fontSize={11} fill="currentColor" opacity={0.8}>
                {b.label}
              </text>
              <text x={cx} y={H - 5} textAnchor="middle" fontSize={9} fill="currentColor" opacity={0.5}>
                n = {s.n}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
