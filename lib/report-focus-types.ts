/**
 * Client-safe data shapes for a report FOCUS (Focus → one supplier). The server
 * assembler (lib/report-focus.ts, server-only) produces these; ReportDocument
 * consumes them to render the supplier brief. Kept free of server-only imports so
 * the client renderer can import the types.
 *
 * The numbers are IDENTICAL to what UnifiedSupplierDetailModal shows — the
 * assembler runs the same queries as the spend-detail (item breakdown) and
 * evolution (YoY trajectory) routes, without touching them.
 */
import type { KraljicQuadrant } from "@/lib/analysis-types";

/** One item bought from the supplier over the report span (spend-detail byItem). */
export type FocusItem = {
  itemName: string;
  poCount: number;
  totalSpend: number;
};

/** One year of the supplier's trajectory (evolution route, per period). */
export type FocusTrajectoryPoint = {
  year: string;
  spend: number;
  invoiceCount: number;
  abcClass: "A" | "B" | "C" | null;
  kraljicQuadrant: KraljicQuadrant | null;
  performanceScore: number | null;
};

export type SupplierFocusData = {
  supplierId: string;
  // Identity (from the Supplier master row) so the brief needn't plumb a directory.
  name: string;
  category: string | null;
  country: string | null;
  /** Every item bought over the span, sorted by spend desc. */
  itemBreakdown: FocusItem[];
  /** Span totals (for item share % + a header stat). */
  totalSpend: number;
  poCount: number;
  /** Year-by-year trajectory across ALL periods (not span-scoped, like the modal). */
  trajectory: FocusTrajectoryPoint[];
};

/** The focus payload threaded into the report render paths. Null = portfolio /
 *  category focus (no per-supplier assembly), or an unresolved supplier pick. */
export type ReportFocusData = { kind: "supplier"; data: SupplierFocusData } | null;
