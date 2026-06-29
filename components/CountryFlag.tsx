import * as Flags from "country-flag-icons/react/3x2";

/**
 * SVG country flag from an ISO 3166-1 alpha-2 code (e.g. "ID" → 🇮🇩 as an SVG,
 * which — unlike Unicode regional-indicator emoji — renders on Windows too).
 * Renders nothing for an unknown/empty code. Reusable across panels/tables.
 */
export function CountryFlag({ code, size = 14 }: { code: string; size?: number }) {
  if (!code) return null;
  const upperCode = code.toUpperCase();
  const Flag = Flags[upperCode as keyof typeof Flags];
  if (!Flag) return null;
  return (
    <Flag
      style={{
        width: size,
        height: size * 0.75,
        display: "inline-block",
        verticalAlign: "-1px",
        marginLeft: 4,
        borderRadius: 1,
      }}
      title={upperCode}
    />
  );
}
