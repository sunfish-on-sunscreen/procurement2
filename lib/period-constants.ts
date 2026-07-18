/**
 * Client-safe constants/types for period selection. No server-only imports here
 * so that client components (e.g. PeriodSelector) can import it freely.
 */
export const PERIOD_COOKIE = "period_selection";

export type PeriodMode = "single" | "range";

export type PeriodSelection = {
  mode: PeriodMode;
  singleId: string | null;
  fromId: string | null;
  toId: string | null;
};
