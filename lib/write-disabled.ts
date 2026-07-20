import { NextResponse } from "next/server";

/**
 * Data-mutation endpoints are DISABLED in the normalized-data-model build.
 *
 * The old flat-`Purchase` create/delete/upload flows assumed a single-table write
 * shape that no longer exists — in the normalized model a "purchase" is a
 * PurchaseOrder + lines + receipts + invoice + payment graph. Rebuilding those
 * write paths is deferred; the seed (`prisma db seed`) + the post-seed compute
 * (`python/seed_compute.py`) are the data source. These handlers return 501 so the
 * build stays green and the (disabled) admin controls fail loudly rather than
 * corrupting state. See the migration plan / CLAUDE.md.
 */
export function writeDisabled(): NextResponse {
  return NextResponse.json(
    {
      error:
        "Data management is disabled in this build. The normalized data model is loaded via the seed; manual add/delete/upload is not available.",
    },
    { status: 501 },
  );
}
