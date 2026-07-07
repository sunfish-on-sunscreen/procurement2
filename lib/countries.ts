/**
 * ISO 3166-1 alpha-2 code → English country name, via Intl.DisplayNames (no extra
 * dependency; the same source the add-supplier country combobox uses). The
 * instance is created lazily once. Pinned to "en" so server and client render the
 * same string (hydration-safe). Returns the code itself for an unknown/blank code.
 */
let regionNames: Intl.DisplayNames | null = null;

export function countryName(code: string): string {
  if (!code) return "";
  const upper = code.toUpperCase();
  try {
    if (!regionNames) regionNames = new Intl.DisplayNames(["en"], { type: "region" });
    return regionNames.of(upper) ?? upper;
  } catch {
    return upper;
  }
}
