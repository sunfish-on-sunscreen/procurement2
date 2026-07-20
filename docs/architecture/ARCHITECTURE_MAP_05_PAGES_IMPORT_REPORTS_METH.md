> # ⚠️ STALE — PRE-MIGRATION DOCUMENT
>
> **This map describes the OLD flat-`Purchase` data model, which no longer exists.**
> It was written before the normalized 12-table migration
> (`8bc872e` → `eece0c0`, branch `feature/normalized-data-model`) and is retained as a
> historical record of the pre-migration architecture, not as a description of the
> system today.
>
> **What changed, in one paragraph:** the single flat `Purchase` table was replaced by a
> 12-table document graph (Supplier / Framework / Requisition / SourcingEvent / Response
> / PurchaseOrder / PoLine / GoodsReceipt / GrnLine / Invoice / InvoiceLine / Payment).
> A plain Postgres VIEW, `EnrichedPurchase`, reconstructs a PO-grain row with
> **byte-identical column names** to the old `Purchase`, so most read paths and the
> entire Python compute layer were re-pointed without renaming anything. Item-level
> columns (`itemName` / `unit` / `unitPriceUsd` / per-line quantity) are NOT on the view
> and are read from `PoLine` via `lib/po-lines.ts`. Period membership moved from payment
> year to **order year** (`poDate`). Write paths were disabled during the migration and
> have since been restored: supplier CRUD with an audit log, a 12-sheet replace-all
> importer, full-chain transaction creation, and append-only corrections against
> immutable posted records.
>
> **Current source of truth:** `CLAUDE.md` → "CURRENT ARCHITECTURE" + `git log`.
>
> Anywhere below that says `prisma.purchase`, `Purchase` columns, the two-file
> Suppliers/Purchases upload, `import_compute.py`, or `/api/sample-data`, read it as
> history. Those code paths are deleted.

# Architecture Map §05 — Import, Reports, Methodology pages (+ Supplier/Purchase CRUD)

Scope: three dashboard pages (**Import**, **Reports**, **Methodology**) and the supplier/purchase CRUD API surface. Every claim cites `path:line` with quoted code. READ-ONLY audit; no files were edited.

Coverage: **39 / 39 assigned files documented** (0 skipped). Supporting (non-assigned) files read for cited evidence: `lib/recompute.ts`, `lib/python.ts`, `components/ui/roster-table.tsx`.

---

## FILE-BY-FILE COVERAGE LEDGER (39/39)

| # | File | §Covered |
|---|------|----------|
| 1 | `app/(dashboard)/import/page.tsx` | IMPORT a/b/d |
| 2 | `app/(dashboard)/methodology/page.tsx` | METHODOLOGY a–e |
| 3 | `app/(dashboard)/reports/[id]/page.tsx` | REPORTS b |
| 4 | `app/(dashboard)/reports/page.tsx` | REPORTS a/b/d |
| 5 | `app/(dashboard)/reports/preview/page.tsx` | REPORTS b/d |
| 6 | `app/api/imports/upload/route.ts` | IMPORT b/c |
| 7 | `app/api/purchases/[id]/route.ts` | IMPORT b (DELETE; NO PATCH) |
| 8 | `app/api/purchases/batch-delete/route.ts` | IMPORT b |
| 9 | `app/api/purchases/route.ts` | IMPORT b/c (POST) |
| 10 | `app/api/reports/analyses/route.ts` | REPORTS b |
| 11 | `app/api/reports/focus/route.ts` | REPORTS b |
| 12 | `app/api/reports/generate/route.ts` | REPORTS b |
| 13 | `app/api/sample-data/route.ts` | IMPORT b |
| 14 | `app/api/suppliers/[id]/route.ts` | IMPORT b (DELETE; NO PATCH) |
| 15 | `app/api/suppliers/batch-delete/route.ts` | IMPORT b |
| 16 | `app/api/suppliers/route.ts` | IMPORT b/c (POST) |
| 17 | `components/AddPurchaseCard.tsx` | IMPORT d/e |
| 18 | `components/AddSupplierCard.tsx` | IMPORT d/e |
| 19 | `components/DownloadPdfButton.tsx` | REPORTS d/e |
| 20 | `components/ImportForm.tsx` | IMPORT d/e |
| 21 | `components/PurchaseRosterTable.tsx` | IMPORT d/e |
| 22 | `components/RemovePurchaseCard.tsx` | IMPORT d/e |
| 23 | `components/RemoveSupplierCard.tsx` | IMPORT d/e |
| 24 | `components/Reports/FilterStatusStrip.tsx` | REPORTS d |
| 25 | `components/Reports/PinContext.tsx` | REPORTS d/e |
| 26 | `components/Reports/ReportDocument.tsx` | REPORTS c/d |
| 27 | `components/Reports/ReportEditor.tsx` | REPORTS b/d/e |
| 28 | `components/Reports/ReportEditorSidebar.tsx` | REPORTS d/e |
| 29 | `components/Reports/ReportTOC.tsx` | REPORTS d/e |
| 30 | `components/Reports/SupplierDetailPanel.tsx` | REPORTS d |
| 31 | `components/SupplierRosterTable.tsx` | IMPORT d/e |
| 32 | `lib/purchase-import.ts` | IMPORT c |
| 33 | `lib/report-analyses.ts` | REPORTS b |
| 34 | `lib/report-config.ts` | REPORTS c |
| 35 | `lib/report-focus-types.ts` | REPORTS (types) |
| 36 | `lib/report-focus.ts` | REPORTS b |
| 37 | `lib/report-narrative.ts` | REPORTS c |
| 38 | `lib/report-templates.ts` | REPORTS c |
| 39 | `lib/supplier-import.ts` | IMPORT c |

---

# IMPORT PAGE

## a. PURPOSE

Admin-only two-file raw XLSX import **plus** supplier/purchase CRUD (add single / remove single / batch-remove). The page is a Server Component guarded by `await requireAdmin();` (`app/(dashboard)/import/page.tsx:36`). It renders the upload form, an Add/Remove control cluster, two roster tables, and a "Recent Imports" audit table.

## b. DATA SOURCES

### Page server load (`import/page.tsx:41-63`)

Three parallel Prisma reads:
```
const [imports, suppliers, purchaseRows] = await Promise.all([
  prisma.import.findMany({ take: 20, orderBy: { uploadedAt: "desc" }, include: { period: true } }),
  prisma.supplier.findMany({ select: {...}, distinct: ["externalId"], orderBy: { externalId: "asc" } }),
  prisma.purchase.findMany({ orderBy: { poId: "asc" }, select: {...} }),
]);
```
The purchase select pulls the **full raw field set** including `defectCount`, `complaintCount`, `onTimeDelivery`, `threeWayMatchPass`, and all 5 dates (`import/page.tsx:56-61`); the roster displays a subset. All purchases are loaded (comment `import/page.tsx:53-54`: "Client-side filtered + paginated in PurchaseRosterTable"). Derived server-side: `nextSupplierId` (`:86`), sorted distinct `categories` (`:87-89`), `nextPurchaseId` (`:90`), `supplierPicks` (`:91`), distinct `units` (`:92`), `purchasePicks` (`:93-98`), and a `supplierItems` map scoping item suggestions per supplier (`:99-113`).

### THE UPLOAD ROUTE — `app/api/imports/upload/route.ts`

**Two-file raw import — CONFIRMED.** Step 2 reads `formData.get("suppliers")` and `formData.get("purchases")` (`upload/route.ts:106-107`); both must be `Blob` else 400 "Both a Suppliers file and a Purchases file are required." (`:108-113`). There is **no SupplierMetrics sheet** — per-supplier metrics are computed server-side (see below).

**Zod schemas (raw-only).** Suppliers is validated by `SuppliersRow` (imported from `lib/supplier-import`); Purchases by the locally-defined `PurchasesRow`:
- `SuppliersRow` (`lib/supplier-import.ts:15-20`): `supplier_id: idCell` (optional, auto-genned when blank), `supplier_name: z.string()`, `country: z.string()`, `category: z.string()`. **Only 4 identity columns — no scores, no metrics.**
- `PurchasesRow` (`upload/route.ts:23-51`): `po_id`, `supplier_id` (a REFERENCE, never auto-genned — comment `:25-27`), `supplier_name`, `category`, `item_name`, `unit`, `quantity`, `unit_price_usd`, `total_value_usd`, 5 `*_date` fields (`dateLike = z.union([z.date(), z.string()])`, `:21`), 5 `*_days` ints (`pr_to_po_days`…`total_cycle_days`), `on_time_delivery: z.boolean()`, `three_way_match_pass: z.boolean()`, and per-PO quality inputs `defect_count: z.number().int()`, `complaint_count: z.number().int()` (`:48-50`).

Both parsed via `sheetRows(wb, "Suppliers"|"Purchases")` which falls back to the first sheet (`:86-90`). Validation is **fail-fast — both files validated before any DB write** (comment `:133`); each failure returns 400 with `formatIssues` (`:64-73`, first 3 issues). Empty purchases → 400 (`:148-150`).

**Trace parse → validate → id-resolve → orphan-check → periods → compute → transaction → analyses → cache-clear:**
1. **Id resolution** (`:156-169`): `makeIdGen(supRawIds, "S", 4, /^S(\d+)$/)` fills blank supplier ids; `makePoIdGen(poRawIds)` fills blank PO ids; purchase `supplier_id` is only normalized via `idStr` (blank stays undefined → orphan).
2. **Duplicate own-id check** (`:171-186`) via `firstDuplicate` (`:75-83`) → 400.
3. **Orphan check** (`:188-219`): every purchase `supplier_id` must be in the file OR the DB (`prisma.supplier.findMany({ distinct: ["externalId"] })`, `:193-196`); else 400 listing offending rows.
4. **Periods** (`:221-256`): years derived from `payment_date` (fallback `pr_date`) `getUTCFullYear()`; `prisma.reportingPeriod.upsert` per year with `update: {}` (comment `:253` "never mutate an existing period"). Suppliers tagged to the latest year (`:257-258`).
5. **Map to Prisma shapes** (`:261-305`): `supplierData` via the shared `toSupplierCreateData`; `purchaseData` passes the file's `total_value_usd`, `pr_to_po_days`, `po_to_delivery_days`, `delivery_to_invoice_days`, `invoice_to_payment_days`, `total_cycle_days` **VERBATIM** (`:279`, `:286-290`) — see the divergence flag in §c. Each purchase tagged to its `(paymentDate ?? prDate)` payment year (`:295-297`).
6. **COMPUTE SupplierMetric server-side BEFORE any write** (`:307-329`): `runImportCompute({ suppliers, purchases })` runs `python/scores.py` via the bridge. Comment `:311-313`: "⚠️ ATOMICITY: this happens BEFORE any DB write, so a compute failure aborts the import with NO partial state." On `computed.code !== 0 || !computed.rows` → 500 "Score computation failed — no data was imported." (`:323-329`). Result rows mapped to `metricData` with all 6 scores + operational aggregates (`:334-351`).
7. **Import audit rows** created OUTSIDE the transaction (comment `:353-354` — so a FAILED status survives rollback): 3 `prisma.import.create` (suppliers/purchases/supplier_metrics), status `PROCESSING`, `rowCount: 0` (`:355-373`).
8. **THE ATOMIC `$transaction`** (`:376-390`):
```
await prisma.$transaction(async (tx) => {
  const where = { periodId: { in: affectedPeriodIds } };
  await tx.supplier.deleteMany({ where });
  await tx.supplier.createMany({ data: supplierData });
  await tx.purchase.deleteMany({ where });
  await tx.purchase.createMany({ data: purchaseData });
  await tx.supplierMetric.deleteMany({ where });
  await tx.supplierMetric.createMany({ data: metricData });
}, { timeout: 30000 });
```
**Delete-then-insert per affected period, all three tables, 30s timeout.** On failure → mark imports FAILED with the sliced error (`:391-406`) and 500 "Import failed during database write. No partial data was saved."
9. On success → imports marked SUCCESS with row counts + `processedAt` (`:408-421`).
10. **`compute_analyses` per year, SEQUENTIALLY** (`:423-433`): `runComputeAnalyses(yearToPeriodId.get(year)!)`; a failure sets `analysesComputed = false` but **does NOT fail the upload** (comment `:423-425` — data already committed).
11. **Range-cache clear** (`:435-438`): `prisma.analysisResult.deleteMany({ where: { periodId: null } })`.
12. Returns `{ success, suppliers, purchases, metrics, analyses_computed, periodsCreated }` (`:441-448`).

### `app/api/sample-data/route.ts`

`GET` serves one of two raw sample files from `data/raw/` (`:9-12`): `?file=suppliers` → `procurement_suppliers.xlsx`, `?file=purchases` → `procurement_purchases.xlsx` (default suppliers, `:21`). Any authenticated session (incl. viewer) allowed (`:15-19`). Reads via `fs/promises.readFile` (`:29`), returns spreadsheet MIME + `Content-Disposition: attachment` (`:31-35`); unknown key → 400, missing file → 404.

### THE CRUD ROUTES — **PATCH is DELETED (governance) — CONFIRMED**

Enumerated per file — no PATCH handler exists on any CRUD route:

| Route file | Handlers present | Evidence of NO edit |
|---|---|---|
| `app/api/suppliers/route.ts` | `POST` only (`:24`) | — |
| `app/api/suppliers/[id]/route.ts` | `DELETE` only (`:21`) | Comment `:18-20`: "there is intentionally NO edit (PATCH) handler — in-place editing of transactional records was removed" |
| `app/api/suppliers/batch-delete/route.ts` | `POST` only (`:19`) | — |
| `app/api/purchases/route.ts` | `POST` only (`:25`) | — |
| `app/api/purchases/[id]/route.ts` | `DELETE` only (`:18`) | Comment `:13-16`: "there is intentionally NO edit (PATCH) handler" |
| `app/api/purchases/batch-delete/route.ts` | `POST` only (`:18`) | — |

Also `lib/supplier-import.ts:24-29`: "There is no edit path: the PATCH handler was removed in the 2026-07-13 CRUD rework — records are add-only + remove-only." `lib/purchase-import.ts:122-124` likewise: "there is no edit path since the 2026-07-13 CRUD rework".

**`recomputeAllPeriods` + honest-500 + 60s timeout + no-rollback-on-create-failure:**

`recomputeAllPeriods` (`lib/recompute.ts:26-49`) loops every period SEQUENTIALLY calling `runComputeAnalyses(period.id, RECOMPUTE_PERIOD_TIMEOUT_MS)` where **`RECOMPUTE_PERIOD_TIMEOUT_MS = 60_000`** (`lib/recompute.ts:6`). The underlying `runScript` kills Python after the timeout, appending `[python killed after ${timeoutMs}ms timeout]` (`lib/python.ts:40-44`). Range cache is cleared **only on full success** (`recompute.ts:44-46`): `if (failedPeriods.length === 0) await prisma.analysisResult.deleteMany({ where: { periodId: null } })`. Returns `{ ok, failedPeriods }`.

Every CRUD route surfaces an **honest 500** when `!ok`:
- `POST /api/suppliers:108-116` — insert already committed, then recompute; on `!ok` returns 500 "Supplier saved, but analytics failed to refresh (periods: …). Re-run a full import…". **No rollback of the insert** (comment `:106-108`: "On failure the insert already committed, so surface a real error rather than a green success").
- `DELETE /api/suppliers/[id]:56-64`, `POST /api/suppliers/batch-delete:68-76`, `POST /api/purchases:137-145`, `DELETE /api/purchases/[id]:35-43`, `POST /api/purchases/batch-delete:41-49` — same 500 pattern.

**Supplier CREATE** (`suppliers/route.ts`): `SupplierWriteBody` validates (`:36`); requires a latest period (`:47-56`); **exact-duplicate-name guard → 409** (`:60-69`, case-sensitive trimmed); id assigned from DB max via `nextSupplierId`, with a 3-attempt retry on P2002 unique collision (`:74-96`); insert via `toSupplierCreateData` (`:81-87`); then `recomputeAllPeriods()` (`:108`).

**Supplier DELETE** (`suppliers/[id]/route.ts`): 404 if not found (`:31-37`); **blocked 409 if it has any purchases** (`:39-49`, no orphans); else `$transaction([supplierMetric.deleteMany, supplier.deleteMany])` (`:51-54`) + recompute.

**Supplier BATCH-DELETE** (`suppliers/batch-delete/route.ts`): `BatchDeleteBody = { ids: z.array(z.string().min(1)).min(1) }` (`:9-11`); **ALL-OR-NOTHING** — if any selected supplier has purchases the whole batch is blocked 409 with a per-supplier report (`:41-61`, via `prisma.purchase.groupBy`); else one `$transaction([supplierMetric.deleteMany, supplier.deleteMany])` + recompute once.

**Purchase CREATE** (`purchases/route.ts`): `CreatePurchaseBody` validates (`:37`); **supplier must already exist** → orphan-proof (`:49-59`, 400 on unknown); name+category denormalized from the supplier (`:82-100`, comment `:47-48` "purchase.category == supplier.category holds for 100% of the imported data"); dates parsed+ordered via `parsePurchaseDates` (`:62-66`); tagged to the PAYMENT-year period via `reportingPeriod.upsert` (`:70-80`); PO id from DB max with 3-attempt P2002 retry (`:106-126`); insert via `toPurchaseCreateData` (derives totals/cycle-days); then recompute (`:137`).

**Purchase DELETE / BATCH-DELETE**: no block rule (a purchase can't orphan anything). `DELETE:33` = `purchase.deleteMany({ where: { poId: id } })`; batch `:39` = `purchase.deleteMany({ where: { poId: { in: ids } } })`; both then recompute.

## c. COMPUTATION — derived fields on manual add

### `lib/purchase-import.ts`

`MS_PER_DAY = 86_400_000` (`:24`). `daysBetween(from, to) = Math.round((to.getTime() - from.getTime()) / MS_PER_DAY)` (`:27-29`). `round2(x) = Math.round(x * 100) / 100` (`:31-33`).

`computeDerivedFields(i)` (`:73-82`) — the single source of truth for a manual purchase's derived fields:
```
totalValueUsd:  round2(i.quantity * i.unitPriceUsd),
prToPoDays:            daysBetween(i.prDate, i.poDate),
poToDeliveryDays:      daysBetween(i.poDate, i.deliveryDate),
deliveryToInvoiceDays: daysBetween(i.deliveryDate, i.invoiceDate),
invoiceToPaymentDays:  daysBetween(i.invoiceDate, i.paymentDate),
totalCycleDays:        daysBetween(i.prDate, i.paymentDate),   // = sum of the 4 gaps
```
`PO_ID_RE = /^PO-(\d+)$/` (`:35`), `formatPoId(648) → "PO-0000648"` (7-pad, `:38-40`), `makePoIdGen`/`nextPoId` share `makeIdGen(existing, "PO-", 7, PO_ID_RE)` (`:44-51`). `parseBodyDate(s) = new Date(`${s}T00:00:00.000Z`)` (UTC midnight, `:115-117`). `parsePurchaseDates` validates the 5 dates AND enforces **non-decreasing ordering** PR ≤ PO ≤ Delivery ≤ Invoice ≤ Payment (`:125-152`) so a manual write can never make a negative cycle-day. `CreatePurchaseBody` (`:94-109`) deliberately OMITS `total_value_usd`, all `*_days`, and `po_id` (computed/server-assigned; comment `:88-93`). `toPurchaseCreateData` calls `computeDerivedFields` internally (`:178-206`).

### `lib/supplier-import.ts`

Shared validation/id-gen/mapper (comment `:3-9`). `idCell = z.union([z.string(), z.number()]).optional()` (`:13`). `SupplierWriteBody` (single-create body) requires trimmed non-empty `supplier_name`/`country`/`category` (`:30-34`). `SUPPLIER_ID_RE = /^S(\d+)$/`, `formatSupplierId(56) → "S0056"` (4-pad, `:46-49`). `idStr` normalizes/blanks (`:52-56`). `makeIdGen(existing, prefix, pad, re)` continues after the highest matching numeric id (`:65-77`). `nextSupplierId` = `makeIdGen(existing, "S", 4, SUPPLIER_ID_RE)()` (`:80-82`). `toSupplierCreateData(row, periodId)` maps to `{ externalId, supplierName, country, category, periodId }` (`:85-93`).

### ⚠️ DIVERGENCE #1 — bulk-VERBATIM vs manual-COMPUTED totals

`lib/purchase-import.ts:9-21` documents it explicitly: "the BULK IMPORT reads total_value_usd and every `*_days` column verbatim from the file … the synthetic file's total_value is deliberately NOT qty×price, so recomputing it would move every spend/score. A MANUAL add has no file value, so it computes: total_value_usd = round(quantity × unit_price_usd, 2) …". Confirmed in `upload/route.ts:279` (`totalValueUsd: r.total_value_usd`) and `:286-290` (the 5 `*_days` passed straight through) vs `toPurchaseCreateData`/`computeDerivedFields` recomputing them for a single add. **So a manually-added PO's `totalValueUsd` may differ from what the bulk file would have carried for equivalent qty×price.** Deliberate, but a real behavioral fork worth §5 awareness.

## d. VISUAL STRUCTURE

- **`ImportForm.tsx`** — a `Card` (`:90-216`). Header "Import data" + description "Upload two Excel files…" (`:91-97`). Form `flex flex-col gap-4` (`:99`) with two file-input blocks (`flex flex-col gap-2`, `:100-154`) each labelled "Suppliers file (.xlsx)" / "Purchases file (.xlsx)" `accept=".xlsx"`, followed by an inline `flex items-center gap-4` link row with "add a single supplier"/"remove a single supplier" (and add/remove purchase) buttons (`Plus`/`Minus` icons, `text-primary … hover:underline`). Upload button + two sample-download `<a download>` links (`:163-184`). Mounts the four dialog cards below (`:188-214`). File inputs reset via a `fileInputKey` bump (`:43`, `:77`).
- **`AddSupplierCard.tsx`** — a `Dialog`/`DialogContent` (`showCloseButton={false}`, `flex max-h-[85vh] w-full flex-col gap-0 overflow-y-auto p-0 sm:max-w-[460px]` + `panelElevation`, `:122-125`). Header `border-b p-4` (`:127`); body `flex flex-col gap-4 p-4` (`:147`) with read-only auto-id preview (`font-mono text-muted-foreground`, `:150-162`), name Input, Country `TypeableCombobox` with flags, Category `TypeableCombobox creatable`; footer `flex items-center justify-end gap-2 border-t bg-muted/50 p-4` (`:213`).
- **`AddPurchaseCard.tsx`** — `Dialog` `sm:max-w-[520px]` (`:162`). Body with read-only PO-id preview, existing-only Supplier picker, supplier-scoped creatable Item picker (`disabled={!supplierId}`, `:235`), a `grid grid-cols-3 gap-3` for Unit/Quantity/Unit-price (`:247`), a bordered **Quality** section (`grid grid-cols-2 gap-3` defect/complaint + two checkboxes On-time/Three-way, `:287-333`), and a bordered **Timeline** section (`grid grid-cols-2 gap-3` over the 5 `type="date"` inputs, `:336-351`). Footer shows "Total & cycle days computed on save." (`:357-359`).
- **`RemoveSupplierCard.tsx`** — `Dialog` `sm:max-w-[460px]` (`:87`); single existing picker + confirm-copy + destructive "Remove supplier" button disabled until picked (`:138`).
- **`RemovePurchaseCard.tsx`** — `Dialog` `sm:max-w-[520px]` (`:97`); picker searches po_id/supplier/item with `maxVisible={50}` (`:128`), destructive remove.
- **`SupplierRosterTable.tsx`** — heading "Suppliers (N of M)" (`:109-115`); a two-row `TableHeader` (labels row `# checkbox · ID · Supplier · Country · Category`, then a filter-Input row, `:131-177`); rows with `RowCheckbox`, country name+code+`CountryFlag` (`:205-218`); `PaginationFooter` (`:228-237`); batch-delete confirm `Dialog` `sm:max-w-[420px]` (`:244`).
- **`PurchaseRosterTable.tsx`** — heading "Purchases (N of M)" (`:122-128`); columns `checkbox · PO ID · Supplier · Item · Unit · Qty(right) · Unit price(right) · Total(right) · Payment date` with a 4-cell filter row (PO/Supplier/Item/Unit) + `colSpan={4}` (`:144-196`); `formatCompactCurrency` for unit-price/total (`:230`, `:233`); `PaginationFooter`. **Client-side filtered + paginated** — `usePagination(filtered, ROSTER_PAGE_SIZE, …)` (`:71`). `ROSTER_PAGE_SIZE = 25` (`components/ui/roster-table.tsx:11`), so the full ~647 rows are loaded to the client but **only 25 render in the DOM per page** (CLAUDE.md's "one page in the DOM" is accurate; the "647 rows" is the full load, not the DOM count).

## e. INTERACTIONS

- **Upload** (`ImportForm.tsx:49-87`): `POST /api/imports/upload` with FormData (`suppliers`+`purchases`); on ok toast "Imported N suppliers and M purchases across periods: …", clears files, `router.refresh()`; on error `toast.error(data.error)`.
- **Add supplier** (`AddSupplierCard.tsx:78-115`): client validation, `POST /api/suppliers`; success toast + `router.refresh()`; recompute failure surfaces inline (comment `:101-103`). Form resets via render-time `prevOpen` transition (`:66-76`, avoids set-state-in-effect).
- **Add purchase** (`AddPurchaseCard.tsx:97-155`): rich client validation (qty>0, price≥0, integer defect/complaint≥0, all 5 dates present), `POST /api/purchases`; toast shows `poId · $total`. Re-pointing the supplier resets the item (`:205-210`).
- **Remove single** (`RemoveSupplierCard.tsx:52-80`, `RemovePurchaseCard.tsx:62-90`): `DELETE /api/{suppliers|purchases}/[id]`; 409 block message surfaced inline for suppliers-with-purchases.
- **Batch delete** (`SupplierRosterTable.tsx:72-103`, `PurchaseRosterTable.tsx:86-116`): `POST …/batch-delete` with selected ids; toast on `typeof data.deleted === "number"`.
- **Pagination/filters** (both roster tables): `useMemo` filters (`.toLowerCase().includes`), supplier filter matches name OR id (`PurchaseRosterTable.tsx:65`), country filter matches name OR code via `countryName` (`SupplierRosterTable.tsx:52`); `usePagination` resets on filter change (keyed on `JSON.stringify(filters)`).

---

# REPORTS

## a. PURPOSE

A decision-first ARGUMENT report (`components/Reports/ReportDocument.tsx`), not a table dump. **Single-year reports persist** (`ExecutiveSummary`); **range reports render live only** in the editor. `reports/page.tsx:31-34`: "Range reports are ephemeral — switch to a single year in the editor to save it to this list." `generate/route.ts:34-39` rejects a non-single period with 400 "Range reports are not persisted".

## b. DATA SOURCES

### `reports/page.tsx` (LIST)

`await requireAuth()` + `prisma.executiveSummary.findMany({ orderBy: { createdAt: "desc" }, include: { generatedByUser: true, period: true } })` (`:14-18`). "Generate Report" link → `/reports/preview`, admin-only (`:24-28`). Cards list title/period/date/author with a "View" link to `/reports/[id]`.

### `reports/[id]/page.tsx` (PERSISTED VIEW — server-assembled)

`await requireAuth()`, `prisma.executiveSummary.findUnique({ where: { id }, include: { generatedByUser: true, period: true } })` → `notFound()` if absent (`:37-41`). Reads `metricsJson` as `ReportMetrics & { config? }` (`:43-45`). Loads six analyses + supplier map in parallel via `getAnalysisResult<…>(periodId, type)` ×6 + `getSupplierCategoryMap()` (`:48-57`). Config: `stored.config ? normalizeReportConfig(stored.config) : defaultReportConfig({mode:"single",singleId:periodId,…})` (`:71-78`). Legacy pre-Batch-5 cycle prose gated on `stored.cycle_framing !== "monitoring"` (`:62-65`). **Assembles breakdown + temporal server-side** (`:88-91`): `computeCycleBreakdown(pStart, pEnd, { abc, performance_spend })` + `loadTemporalMatrix({ selectedPeriodId: periodId })` (period-aware). **Focus → supplier**: `assembleSupplierFocus(config.focus.supplierId, pStart, pEnd)` when focus is supplier (`:95-101`). Passes everything into `<ReportDocument>` (`:114-129`), with a deterministic filename via `title.replace(/[^\w-]+/g, "_")`.

### `reports/preview/page.tsx` (EDITOR — ephemeral)

`await requireAdmin()` (`:12`) + parallel loads `getCurrentPeriodSelection`, `getAllPeriods`, `getCategories`, `getSupplierCategoryMap`, `getSupplierDirectory` (`:13-20`) → `<ReportEditor>` (`:24-33`). Admin-only because the editor can persist.

### `ReportEditor.tsx` (client fetch orchestration)

Two independent fetches, keyed to avoid over-refetch:
- **Analyses** (`:175-208`): `POST /api/reports/analyses` on `[startDate, endDate, selectedPeriodId]` change only (tone/detail/section edits re-render without refetch). Single-year sends `selectedPeriodId` for period-aware temporal (`:104-106`, `:182-186`).
- **Focus** (`:224-241`): `POST /api/reports/focus` keyed on `(supplierId, span)` — separate so changing focus doesn't refetch the whole payload (comment `:210-213`).
Loaded data is span-tagged so `loading` is derived not set-in-effect (`:84-110`). Pin cleared on span change via render-time `prevSpanKey` (`:131-135`). `handleSave` (`:245-270`) → `POST /api/reports/generate`.

### `/api/reports/analyses/route.ts`

Any authenticated session (`:29-33`). `bodySchema = { startDate, endDate, selectedPeriodId? }` with a `YYYY-MM-DD` refine+slice (`:8-20`). Calls `assembleReportRangeAnalyses(startDate, endDate, selectedPeriodId ? {selectedPeriodId} : undefined)` (`:48-52`); null → 500 "Range computation failed".

### `/api/reports/focus/route.ts`

Any authenticated session. `bodySchema = { supplierId(min 1), startDate, endDate }` (`:13-17`). Calls `assembleSupplierFocus(supplierId, startDate, endDate)` (`:44`) → JSON.

### `/api/reports/generate/route.ts` (PERSIST)

**ADMIN only** (`:19-22`). Requires `config`; rejects non-single period (`:34-39`); requires `singleId` (`:40-43`); `prisma.reportingPeriod.findUnique` (`:45-48`). Loads six analyses via `getAnalysisResult` (`:50-58`); any missing → 400 "Compute analyses first…" (`:60-75`). Persists `prisma.executiveSummary.create` (`:78-91`) with a **stub `narrative`** ("rendered live from the analyses"; comment `:83-85`: the column is legacy/never displayed) and `metricsJson: { config, cycle_framing: "monitoring" }`. Returns `{ id, redirect: /reports/${id} }`.

### `lib/report-analyses.ts` — `assembleReportRangeAnalyses`

`server-only` (`:1`). `getRangeAnalyses(startDate, endDate)` → null-guard (`:46-47`); then `Promise.all([computeCycleBreakdown(start,end,{abc,performance_spend}), loadTemporalMatrix(selectedPeriodId?…)])` (`:49-57`). Returns `{ ...analyses, breakdown, temporal }` typed `ReportRangeAnalyses = RangeAnalyses & { breakdown: CycleBreakdown; temporal: TemporalLoad }` (`:12-18`). Temporal is a discriminated `TemporalLoad` (period-aware for single-year vs range; comment `:34-39`).

### `lib/report-focus.ts` — `assembleSupplierFocus`

`server-only` (`:1`). READ-ONLY, no recompute (comment `:15-27`). **itemBreakdown** mirrors spend-detail byItem: `prisma.purchase.findMany({ where: { supplierExternalId, paymentDate: { gte, lte } }, select: { itemName, totalValueUsd } })` (`:41-44`), grouped/summed/sorted desc (`:46-57`). **trajectory** mirrors the evolution route: `Promise.all([reportingPeriod.findMany, purchase.findMany(all), supplier.findFirst(latest)])` (`:62-76`) + per-period `getAnalysisResult<AbcResult|KraljicResult|PerformanceSpendResult>` ×3 (`:78-87`); each period buckets purchases by `(paymentDate ?? prDate)` within bounds (`:89-109`). Returns `SupplierFocusData`.

Prisma / cached-read calls documented across Reports: `executiveSummary.findMany` (list), `executiveSummary.findUnique` (view), `executiveSummary.create` + `reportingPeriod.findUnique` (generate), `report-focus.ts` 3 Prisma reads + N×3 `getAnalysisResult`, `report-analyses.ts` 3 assembler calls, plus `getAnalysisResult`×6 in both `[id]` and `generate`.

## c. COMPUTATION — the argument model (`lib/report-narrative.ts`)

Pure + tone-aware; numbers identical to the analyses (comment `:29-38`). Three public renderers: `renderReportArgument`, `renderSupplierBrief`, `renderCategoryDeepDive`.

### Fact model (`buildFacts`, `:208-391`)

`RenderedArgument` (`:67-76`) = `{ headline, situation[], findings[], actions[], watching{intro,items[]}, lensRows[], hasArgument }`.
- **SituationFacts** (`:188-206`, 17 fields): totalSpend, totalPos, activeSuppliers, cat1, cat1Pct, classAN, classASpendPct, stratN, **aAndStrategicN/Spend** (Class-A ∩ Strategic join, `:242`/`:263-264`), criticalN, criticalSpend, criticalSpendPct, **aAndCriticalN/Spend** (Class-A ∩ Critical-Issues join, `:243`/`:268-269`), criticalLeaders, perfMedian. These joins are the cross-analysis "the old report threw away".
- **Finding** discriminated union (`:126-176`) — 6 variants: `critical_issues`, `concentration`, `cycle_constraint`, `control_weakness`, `temporal_move`, `lens_disagreement`.

### Finding ranking — insight × exposure (`:300-390`)

Comment `:300-307` states the design. Scores:
- `critical_issues` (the cross-analysis join): `score = 1 + asFraction(criticalSpend)` — anchors the lead (`:311-321`).
- `concentration`: gated `cat1Pct >= 30`; `score = 0.5 + (cat1Pct/100)*0.3` — capped below 1.0, demoted to support (`:322-332`).
- `cycle_constraint`: gated `slowest.mean > STAGE_FLAG_DAYS`; `score = 0.4 + (slowest.mean/allMeans)*0.3` (`:333-354`).
- `control_weakness`: gated `n_failed>0 && pct_at_risk>=5`; `score = asFraction(failed_spend) * 4` (the ×4 "bigger story" override, `:355-365`).
- `temporal_move`: `score = asFraction(total_spend)*4` (`:366-377`).
- `lens_disagreement`: `score = asFraction(total_spend)*0.5` (`:378-387`).
Sorted desc, top 3 kept (`:389-390`). The headline = the top finding (`:773`).

### Named thresholds / constants

| Constant | Value | Line |
|---|---|---|
| `STAGE_FLAG_DAYS` | `8` | `report-narrative.ts:186` |
| `INTERNAL_STAGES` | `["pr_to_po","delivery_to_invoice","invoice_to_payment"]` (PO→Delivery excluded — physical lead time) | `:185` |
| `TRAJECTORY_PARTIAL_FRACTION` | `0.5` | `:1144` |
| concentration finding gate | `cat1Pct >= 30` (and headline conc clause at `>= 40`) | `:322`, `:402` |
| control finding gate | `pct_at_risk >= 5` | `:356` |
| `genuinelyLarge` (median-relative vs absolute guard) | `spendPct >= 5 \|\| rank <= 10` | `:1002` |

### The three data-honesty guards (CONFIRMED)

1. **PARTIAL-YEAR TRAP** — `TRAJECTORY_PARTIAL_FRACTION = 0.5` (`:1144`); `briefTrajectory` drops a trailing year whose spend `< 0.5 × prevYr.spend` from the trend and notes it (`:1157-1165`, comment "not asserting a spurious 'fell 72%'"). Also the temporal-load note states in `watchingItems` (`:724-732`).
2. **MEDIAN-RELATIVE vs ABSOLUTE** — `genuinelyLarge = f.spendPct >= 5 || (f.rank != null && f.rank <= 10)` (`:1002`); the brief headline only says "high-spend" when genuinely large, else "performs well for what you spend" / "underperforms for what you pay it" (`:1003-1065`). Comment `:998-1002` explains the median-split trap.
3. **SUB-1% → "<1%", never "0%"** — `sharePct(n) = (n > 0 && n < 1 ? "<1%" : pct0(n))` (`:83`), used across headlines/evidence.

### ⚠️ DIVERGENCE #2 — the ≥80 lens-disagreement HARDCODE (CONFIRMED)

`report-narrative.ts:636` hardcodes `{ label: "Lens spread", value: "≥ 80 pts" }` (NOTE: the orchestrator prompt said `:637`; the actual literal is on **line 636**). `components/Reports/ReportDocument.tsx:356` hardcodes `"rank ≥ 80 percentile-points apart"`. Neither interpolates `CLASSIFICATION_DISAGREEMENT_CUTOFF` (defined in `lib/anomaly-crossref.ts`, which the same code imports `buildClassificationAnomalies`/`buildAnomalyCrossref` from). If the constant is retuned, these two copy strings won't follow — matches CLAUDE.md's KNOWN OPEN ITEM.

### Supplier brief & category deep-dive

`renderSupplierBrief` (`:1273-1306`): `buildBriefFacts` (`:878-985`) derives the zone-branched headline (`briefHeadline`, `:989-1067`), situation, plain-language "What's flagged" (`briefFlagged`, `:1093-1123` — no S/P/R codes; uses `PROC_FLAG_PROSE`), "What you buy" (`briefBuy`, `:1125-1142`, `topItemsShare >= 60` = "concentrated"), Trajectory (`briefTrajectory`), "The conversation" (`briefRecommendation`, `:1242-1267`). `renderCategoryDeepDive` (`:1329-1413`): concentration headline + who-leads/performance situation + supplier comparison rows + a resilience/engagement recommendation; `singleSource = n === 1` (`:1362`), `underperformers = perf < perfMedian` (`:1361`), `topShare >= 60` = "leans heavily on one relationship" (`:1384`).

### `lib/report-templates.ts` — three tones + appendix prose

`deriveReportContext(a, period)` (`:138-275`) builds a ~65-field `ReportContext` (headline/spend/abc/kraljic/performance/cycle/comparison/recommendations blocks; `:48-120`). `TEMPLATES: Record<ReportTone, SectionTemplates>` (`:289-587`) — three genuine registers **executive / operational / analytical**, each with `cover/spendOverview/abc/kraljic/performanceSpend/cycleTime/keyFindings/recommendedPriorities/methodology`.
- **`CAT2_LARGE = 15`** (`:312`) — executive spendOverview frames "two markets" only when `top2 >= 55 && cat2Pct >= CAT2_LARGE` (`:311-326`).
- Executive cover scales the concentration adjective (`top10Pct >= 80` "highly concentrated" / `>= 60` "concentrated" / else "relatively distributed", `:294-300`).
- Analytical cycleTime derives skew from mean vs median (`skewGap >= 0.5` right-skew etc., `:521-527`); references `α = 0.05` (`:552`, `:581`), `> 2σ` outliers (`:537`, `:581`).
- `ReportMetrics` (`:22-25`) = `{ cycle_framing?: "monitoring"; narratives?: { cycle_time? } }`.

### `lib/report-config.ts` — the FOUR-field config

`ReportConfig` (`:37-58`): `period: PeriodSelection`, `focus: ReportFocus`, `sections` (7 appendix toggles + always-on `executiveSummary: true`), `detailLevel: "brief"|"standard"|"detailed"`, `tone: "executive"|"operational"|"analytical"`. `ReportFocus` (`:32-35`) = `{kind:"portfolio"} | {kind:"supplier";supplierId} | {kind:"category";category}`. `defaultReportConfig` = portfolio focus, all sections on, standard, operational (`:81-89`). `normalizeReportConfig` (`:99-109`) maps OLD persisted configs forward: `focus: raw.focus ?? {kind:"portfolio"}`, sections spread over `ALL_SECTIONS_ON`, detail/tone default — the removed `recommendationFilters`/`filters`/`filterScope` are simply dropped (comment `:91-98`).

### `lib/report-focus-types.ts` — client-safe types (enumerated)

`FocusItem = { itemName; poCount; totalSpend }` (`:14-18`); `FocusTrajectoryPoint = { year; spend; invoiceCount; abcClass: "A"|"B"|"C"|null; kraljicQuadrant: KraljicQuadrant|null; performanceScore: number|null }` (`:21-28`); `SupplierFocusData = { supplierId; name; category|null; country|null; itemBreakdown: FocusItem[]; totalSpend; poCount; trajectory: FocusTrajectoryPoint[] }` (`:30-43`); `ReportFocusData = { kind:"supplier"; data: SupplierFocusData } | null` (`:47`).

### 3-family anomaly summary in the appendix

`ReportDocument.tsx` `anomalyBlock` (`:250-418`) computes all three families synchronously from server-assembled data (no client fetch): **Classification** via `buildClassificationAnomalies` (`:257-261`), **Process** via `buildAnomalyCrossref`+`deriveCycleFlags` off `analyses.breakdown` (`:264-275`), **Temporal** via `buildTemporalAnomalies` off the discriminated `analyses.temporal` with note states (no-prior / partial-year / no-change) (`:281-291`). Rendered under "Cross-analysis anomalies" at standard/detailed (`:315-417`); capped 6 rows unless detailed (`:300`).

## d. VISUAL STRUCTURE

- **`ReportEditor.tsx`** — `flex` root (`:282`): left `ReportEditorSidebar`, right `relative min-w-0 flex-1` column with a `no-print` top bar (Back link + title, `:298-306`), `FilterStatusStrip`, a `PinProvider`-wrapped body (`:312-339`) that renders loading / error / `<ReportDocument … embedded>` and the `SupplierDetailPanel`.
- **`ReportEditorSidebar.tsx`** — the FOUR-QUESTION panel, a width-animating `<aside>` (`sticky top-0 h-[calc(100vh-2rem)]`, collapsed `w-11` rail ↔ open `w-[248px]`, `transition-[width] duration-150`, `:201-217`). Sections `flex flex-col gap-5 p-3` (`:230`): ① **What's it about?** — 3 `RadioRow` focus options + a `TypeableCombobox` supplier/category picker (`:231-292`, supplier options show `name` + `category · spend`); ② **Which period?** — mode select + single/range year selects (`:294-357`); ③ **How long?** — 3 `LENGTH_OPTIONS` radios (Executive brief / Standard / Full, `:359-372`); ④ **Attach evidence** — six `EVIDENCE_OPTIONS` checkboxes (Spend & ABC toggle together; "Cross-analysis anomalies" = `actionDashboard`; supplier/category focus filters to Methodology only, `:374-403`); **Draft voice** demoted to a `rounded-full` pill row (`:405-430`). Footer Save (disabled for range) + `DownloadPdfButton` (`:433-450`).
- **`ReportDocument.tsx`** — `mx-auto max-w-[820px] flex flex-col gap-8` root (`:544-546`). Non-embedded: sticky Back+Download bar (`:529-542`). Embedded: `ReportTOC`. Portfolio path: Cover card (`rounded-lg border bg-card p-8`, headline `:582-602`), "The situation", "What we found" (finding cards `rounded-xl bg-card p-4 ring-1 ring-foreground/10` with a 3-col evidence grid + `border-l-2 border-primary` recommendation, `:619-656`), "What to do" `<table>` P1/P2/P3 (`:658-690`), "Worth watching" (`:692-709`), Appendix sections. Focus path branches to `SupplierBriefView` (`:1154-1295`) / `CategoryDeepDiveView` (`:1297-1371`). `ReportSection` (`:99-158`): `pdf-page-break`; embedded header sticky `top-9`; collapsed body uses the `.hidden` CLASS + `print:flex` (comment `:146-148` — an author print rule can't override the `hidden` attribute).
- **`ReportTOC.tsx`** — `no-print sticky top-0 z-30` chip nav; active chip `bg-primary text-primary-foreground` (`:20-44`).
- **`FilterStatusStrip.tsx`** — one line `focus · length · voice` (`:27-38`), `border-b bg-muted/40 px-3 py-1.5`.
- **`PinContext.tsx`** — an OPTIONAL React context (no-op defaults outside a provider, so standalone dashboard charts are inert; comment `:5-17`); `PinProvider`, `usePin`, `useIsPinned(supplierId)` (`:26-44`). Identity key = `supplier_id`.
- **`SupplierDetailPanel.tsx`** — `no-print absolute inset-0 z-30` backdrop + right `w-80` slide-out (`:74-86`); Identity / Key metrics / Classifications (`Pill` `color-mix 13%` tints) / Anomalies / Recommendations sections.
- **`DownloadPdfButton.tsx`** — calls native `window.print()` (`:22`), seeding the Save-as-PDF name via `document.title` restored on `afterprint` (`:14-23`).
- **Embedded charts STACK, not tab**: `OverviewCharts spend={…} embedded` (`:736`) and `CycleTimeView data={…} embedded` (`:1027`) render in the appendix; the `embedded` prop is what forces the stacked (print-safe) layout.

## e. INTERACTIONS

- The four questions all call `set(patch)` = `onConfigChange({...config, ...patch})` (`ReportEditorSidebar.tsx:153-154`); focus-kind change preserves the last-picked supplier/category (`:163-170`).
- **Focus picker** = `TypeableCombobox` (`:246-291`), `maxVisible={40}` for suppliers.
- **Section toggles** = `toggleEvidence(keys, next)` writes `config.sections` (`:193-197`); disabled/hidden at brief length (`:377-402`).
- **Tone pills** = `set({ tone })` with `aria-pressed` (`:413-427`).
- **Pin context**: chart/table clicks call `pin(supplier_id)` (e.g. ABC row `onClick={() => pin(c.supplier_id)}`, `ReportDocument.tsx:771`); `pinnedDetail` assembled via `buildSupplierDetail` (`ReportEditor.tsx:145-159`); Escape closes (`:162-169`).
- **Section collapse + scroll-spy**: `toggleCollapse` (`:427-434`), `IntersectionObserver` scroll-spy (`:493-511`), `onSectionClick` expands then smooth-scrolls (`:513-525`).
- **PDF export**: `DownloadPdfButton` → `window.print()`; layout in the `@media print` block of `app/globals.css`.
- **Save**: `handleSave` (`ReportEditor.tsx:245-270`) POSTs `/api/reports/generate`, `router.push(redirect)`; disabled unless `config.period.mode === "single"` (`:243`).

---

# METHODOLOGY

## a. PURPOSE

A static explainer of the scoring model — nine numbered `Card` sections (`app/(dashboard)/methodology/page.tsx`).

## b. DATA SOURCES

**[INFERRED] Static — no data fetch.** The component's only server call is `await requireAuth();` (`:11`); it imports only `Card`/`CardContent`/`CardHeader`/`CardTitle` + `cardElevation` (`:2-8`). No `prisma`, no `getAnalysisResult`, no `fetch` anywhere in the file (confirmed by reading the file in full — all content is literal JSX copy).

## c. COMPUTATION — QUANTITATIVE CLAIMS EXTRACTED (for §5 verification)

**This page is static copy.** Every quantitative claim it makes about the app is enumerated below with exact quote + line. **These are NOT verified here — §5 checks each against the traced code.**

1. **ABC Class A = top 80% of spend.** `:118-120`: "**Class A** — the suppliers making up the top 80% of spend (strategic, high-touch)."
2. **ABC Class B = next 15%.** `:122-124`: "**Class B** — the next 15% of spend (preferred, periodic review)."
3. **ABC Class C = bottom 5%.** `:126-128`: "**Class C** — the bottom 5% of spend (tail, consolidation candidates)."
4. **Kraljic X-axis = spend share %, log scale, median split.** `:150-153`: "**Profit Impact** (X-axis) — supplier share of total spend (%), shown on a log scale … high/low split at the median."
5. **Kraljic Y-axis = 0–100 composite of three capped components, summed and clipped to 100.** `:155-158`.
6. **Supply concentration ≤50, step curve on # other suppliers in category across the FULL roster:** `0 → 50, 1 → 35, 2 → 22, 3 → 12, 4 → 5, ≥5 → 0`. `:162-172`.
7. **Cost premium ≤25, period-scoped.** `:174-187`: benchmark = spend-weighted avg unit price across all suppliers; `premium = supplier_avg_unit_price / item_avg − 1`; counted only when supplier×item **≥2 POs** AND item **≥2 suppliers**; `points = clip(premium × 62.5, 0, 25)` — "+8% → 5, +20% → 12.5, +40%+ → 25; at or below market → 0".
8. **Import friction ≤25:** `ID → 0`, `AFTA/ASEAN → 8`, `RCEP non-ASEAN (JP, KR, CN, AU, NZ) → 16`, else/unknown → `25`. `:188-195`.
9. **Kraljic median split on each axis → 4 quadrants** (Strategic/Leverage/Bottleneck/Routine). `:201-223`.
10. **Performance vs Spend = 4 zones via median lines** (Stars/Critical Issues/Hidden Gems/Long Tail). `:239-261`.
11. **Performance composite weights: quality 30%, delivery 30%, process 22%, risk 18%.** `:262-267` (§3.3) AND `:400-403` (§4.2) AND formula `:405-407`: "composite = 0.30·quality + 0.30·delivery + 0.22·process + 0.18·risk".
12. **Z-score anomaly = cycle time > 2σ above the mean.** `:302-306`: "POs with cycle time more than 2 standard deviations above the mean are flagged as outliers."
13. **Typical range = IQR (P25–P75, middle 50%), linear-interpolation quantiles.** `:289-295`.
14. **Inconsistent flag = supplier IQR > 1.5× median of all suppliers' IQRs (Tukey).** `:322-324`.
15. **Stage-dominated PO = a single P2P stage exceeds 60% of that PO's total cycle.** `:324-327`.
16. **Period comparison = midpoint split of the selected period** (first half vs second, intra-period). `:328-334`.
17. **Mann-Whitney U + rank-biserial; Cohen small ≈ 0.1, medium ≈ 0.3, large ≈ 0.5.** `:307-316`.
18. **Quality sub-score = avg of defect rate (bound 0–10%) and complaint rate (share of orders with a complaint, 0–100%), lower-is-better, per PO.** `:364-369`.
19. **Delivery sub-score = avg of on-time-delivery % (0–100, higher-better) and avg lead time (0–60 days, lower-better).** `:370-373`.
20. **Process sub-score = three-way-match pass rate (0–100).** `:374-376`.
21. **Risk sub-score = structural: geography + roster concentration.** `:377-380`.
22. **`norm_high(v,lo,hi)=clamp((v−lo)/(hi−lo),0,1)×100` · `norm_low(v,lo,hi)=clamp((hi−v)/(hi−lo),0,1)×100`.** `:383-386`.
23. **Service dimension REMOVED; its 15% weight redistributed proportionally → clean 30/30/22/18.** `:409-421`.
24. **Risk formula: `risk = 100 − (0.6·country_distance + 0.4·roster_concentration)`, higher = safer, structural.** `:426-430`.
25. **Geographic distance tiers: Indonesia 0 · ASEAN 30 · Asia-Pacific 60 · other 100.** `:431-440`.
26. **Roster concentration continuous 0–100 (true single source → 100, ≥5 alternatives → 0).** `:434-439`.
27. **Composite carries exactly TWICE the Kraljic concentration points** (0 alternatives → 50 Kraljic / 100 composite; ≥5 → 0 both). `:671-679`.
28. **§5.1 four cross-classification synthesis buckets vs the period performance median** ("Below" = below median; "above" = at or over). `:477-505`.
29. **§6 Action Priorities = 3 groups (Spend / Suppliers / Process), 8 named categories.** `:522-539` (Concentration, Critical Spend, Tail Spend, Critical Issues Engagement, Hidden Gems Promotion, Bottleneck Risk Mitigation, Process Improvement, Slowest Stage).
30. **Impact score 0–100; `spend_normalized = log(1 + total_spend) ÷ max(log(1 + total_spend)) × 100`.** `:557-562`.
31. **Critical Issues Engagement impact = `0.7 × spend_normalized + 0.3 × performance_gap`.** `:564-569`.
32. **Hidden Gems Promotion impact = `(performance − median) ÷ (100 − median) × 100`.** `:570-574`.
33. **Bottleneck Risk Mitigation impact = the supplier's `supply_risk_score` (0–100).** `:576-579`.
34. **Process Improvement impact: 3-way-match issues use `fail_rate_pct`; stage-time issues use `mean_days ÷ 18 × 100` (~18-day reference).** `:581-586`. ⚠️ Possible code drift — CLAUDE.md records the runtime rec string was reframed to "the weakest match compliance among quadrants"; §5 should verify the impact-formula against `python/compute_analyses.py`.
35. **§7 Periods auto-detected — one per distinct year in `pr_date`.** `:597-601`. ⚠️ Possible code drift — the import route derives periods from **payment_date** (fallback pr_date), not pr_date (`upload/route.ts:221-236`); §5 should reconcile this Methodology claim.
36. **Range computes take ~5 seconds** (Python live vs cache). `:611-614`.
37. **§8.3 real concentration maxima on this data are 35 and 70** (the single-source top rung never fires). `:704-712`.
38. **Cost premium registers for only 24 of 55 suppliers.** `:713-722`.
39. **"Inconsistent" flag fires for 2 of 55 suppliers.** `:724-727`.
40. **"Slowest stage" rec fires only when an internal stage averages > 8 days — fires in 2024 not 2025/2026.** `:728-735`.
41. **Three recs always fire** (Concentration, Process Improvement, Tail Spend — structural summaries). `:736-743`.
42. **§8.3 "Two country scales":** country_distance Indonesia 0 / ASEAN 30 / Asia-Pacific 60 / other 100; import_friction Indonesia 0 / AFTA 8 / RCEP-non-ASEAN 16 / other 25; India = Asia-Pacific 60 on distance but 25 on friction (left RCEP 2019). `:749-762`.
43. **§8.4 Complaint rate real rates top out near 33% → half occupies 66.7–100; defect half does ~2.3× the work. Lead time real leads 8–26.5 days → half occupies 55.8–86.7.** `:796-803`.
44. **§8.4 82% of the composite (Quality+Delivery+Process) is period-sensitive; only the 18% Risk sub-score is period-independent.** `:780-786`.
45. **§8.5 fixed constants: ABC at 80%/95%, median splits on both matrices, the 2σ outlier rule, the 8-day slow-stage flag, Mann-Whitney U — all constants, no sliders.** `:824-829`.
46. **§8.2 two opposite "risks": Kraljic supply-risk higher = riskier; composite Risk sub-score higher = safer.** `:666-679`.
47. **§8.5 currency normalized to USD using period averages.** `:820-823`.
48. **§8.5 process structure reflects Perpres 12/2021.** `:831-834`.

**Total extracted: 48 numbered quantitative claims.**

## d. VISUAL STRUCTURE

Nine `Card className={cardElevation}` sections inside `flex max-w-4xl flex-col gap-6` (`:14`): 1 Project Background, 2 Data Sources (calibration `<ul>` + a `border-l-4 border-primary bg-muted/50` callout, `:61-65`), 3 The Four Analyses (subsections 3.1–3.4), 4 Supplier Scorecard (4.1–4.3 with `rounded-md bg-muted/50 p-2 text-xs` formula blocks), 5 Supplier Classification (5.1), 6 Action Recommendations Synthesis (impact-formula block), 7 Reporting Periods, 8 Assumptions and Limitations (8.1–8.5, a "defence not a spec" framing `:624-630`), 9 References. Headings `text-base font-semibold text-foreground`; body `text-sm leading-relaxed text-muted-foreground`.

## e. INTERACTIONS

**None** — the page is entirely static JSX. No buttons, links, forms, event handlers, or client directive (no `"use client"`; it is an async Server Component). Confirmed by full read.

---

# CROSS-CUTTING DIVERGENCES

1. **≥80 lens-disagreement hardcode** (see Reports §c #2): `report-narrative.ts:636` (`"≥ 80 pts"`) + `ReportDocument.tsx:356` (`"rank ≥ 80 percentile-points apart"`) don't interpolate `CLASSIFICATION_DISAGREEMENT_CUTOFF` (`lib/anomaly-crossref.ts`). (Prompt cited `:637`; actual is `:636`.)
2. **Bulk-verbatim vs manual-computed totals** (Import §c #1): `upload/route.ts:279`/`:286-290` pass `total_value_usd`+`*_days` straight from file; `purchase-import.ts:73-82` recomputes them for a manual add. Deliberate but a real fork.
3. **Methodology §7 says periods from `pr_date`** (`methodology/page.tsx:597-601`) but the import route derives them from `payment_date` fallback `pr_date` (`upload/route.ts:221-236`) — code-vs-Methodology drift for §5.
4. **Methodology §6 Process-Improvement impact uses `fail_rate_pct`** (`:581-586`) — CLAUDE.md records the runtime rec was reframed; §5 to verify against `compute_analyses.py`.
5. **`SupplierDetailPanel.tsx:18-25` hardcodes hex** (`ACTION_COLORS = { engage:"#ef4444", review:"#f59e0b", mitigate:"#f97316", promote:"#10b981", demote:"#64748b", improve:"#3b82f6" }`) — violates CLAUDE.md's "Theme-aware tokens only — NO hardcoded hex". It also lists `review`/`demote` keys that are NOT in the `RecommendationAction` union (`report-narrative.ts:89-98` has promote/engage/mitigate/improve/diversify/steward/consolidate/streamline) — stale/dead keys. Falls back to `#64748b` for unknown actions (`:215`).
6. **Two "≥ 80" copies vs the constant** is the same root as #1; recorded once.

---

# APPENDIX — audit tallies

- **A3 exports documented: ~108 / ~108** across the 39 files (5 page defaults; 11 route files × `runtime`+handler = 22; ~25 component exports incl. types like `PurchaseRow`/`SupplierPick`/`SupplierOption`/`PinContextValue`/`ReportAnalyses`/`ReportMeta`; ~56 lib exports — `purchase-import` 13, `supplier-import` 12, `report-narrative` 12, `report-config` 8, `report-templates` 4, `report-focus-types` 4, `report-analyses` 2, `report-focus` 1). Every assigned file's exports are covered.
- **A5 reports computed values enumerated: ~90** — `ReportContext` (~65 fields, `report-templates.ts:48-120`) + the argument fact model (`SituationFacts` 17 fields + 6 `Finding` variants + `ActionRow`/`watching`/`lensRows` shapes) + `SupplierFocusData`/brief facts.
- **A6 Prisma/cached queries documented: ~36 direct `prisma.*` call sites** — Import page 3; upload route 7 sites (+6 inner `$transaction` ops); suppliers POST 4, DELETE 3, batch 2; purchases POST 4, DELETE 2, batch 1; sample-data 0 (filesystem); reports list 1, `[id]` view (findUnique + create-path reads), generate (findUnique + create), `report-focus` 4 Prisma reads, `recompute` 2; plus `getAnalysisResult`-wrapped reads (×6 in `[id]`, ×6 in generate, ×3·N in focus) and the assembler helpers.

---

## A3 EXPORTS COMPLETENESS INDEX (auto-generated — every `export` in this doc's files, cited)

Guarantees one-to-one A3 coverage: each symbol below is defined at the cited line in a file this doc documents.

| Symbol | Kind | file:line |
|---|---|---|
| `SupplierPick` | type | `AddPurchaseCard.tsx:14` |
| `AddPurchaseCard` | fn | `AddPurchaseCard.tsx:25` |
| `AddSupplierCard` | fn | `AddSupplierCard.tsx:38` |
| `DownloadPdfButton` | fn | `DownloadPdfButton.tsx:13` |
| `FilterStatusStrip` | fn | `FilterStatusStrip.tsx:27` |
| `ImportForm` | fn | `ImportForm.tsx:22` |
| `PinContextValue` | type | `PinContext.tsx:18` |
| `PinProvider` | const | `PinContext.tsx:34` |
| `usePin` | fn | `PinContext.tsx:36` |
| `useIsPinned` | fn | `PinContext.tsx:41` |
| `PurchaseRow` | type | `PurchaseRosterTable.tsx:28` |
| `PurchaseRosterTable` | fn | `PurchaseRosterTable.tsx:52` |
| `PurchasePick` | type | `RemovePurchaseCard.tsx:13` |
| `RemovePurchaseCard` | fn | `RemovePurchaseCard.tsx:26` |
| `SupplierPick` | type | `RemoveSupplierCard.tsx:13` |
| `RemoveSupplierCard` | fn | `RemoveSupplierCard.tsx:21` |
| `ReportAnalyses` | type | `ReportDocument.tsx:39` |
| `ReportMeta` | type | `ReportDocument.tsx:55` |
| `ReportDocument` | fn | `ReportDocument.tsx:160` |
| `ReportEditor` | fn | `ReportEditor.tsx:58` |
| `SupplierOption` | type | `ReportEditorSidebar.tsx:23` |
| `ReportEditorSidebar` | fn | `ReportEditorSidebar.tsx:127` |
| `ReportTOC` | fn | `ReportTOC.tsx:10` |
| `SupplierDetailPanel` | fn | `SupplierDetailPanel.tsx:63` |
| `SupplierRosterTable` | fn | `SupplierRosterTable.tsx:38` |
| `(default)` | default | `page.tsx:10` |
| `(default)` | default | `page.tsx:11` |
| `(default)` | default | `page.tsx:13` |
| `(default)` | default | `page.tsx:29` |
| `(default)` | default | `page.tsx:35` |
| `PO_ID_RE` | const | `purchase-import.ts:35` |
| `formatPoId` | fn | `purchase-import.ts:38` |
| `makePoIdGen` | fn | `purchase-import.ts:44` |
| `nextPoId` | fn | `purchase-import.ts:49` |
| `DerivedFieldInputs` | type | `purchase-import.ts:53` |
| `DerivedFields` | type | `purchase-import.ts:63` |
| `computeDerivedFields` | fn | `purchase-import.ts:73` |
| `CreatePurchaseBody` | const | `purchase-import.ts:94` |
| `CreatePurchaseInput` | type | `purchase-import.ts:111` |
| `parseBodyDate` | fn | `purchase-import.ts:115` |
| `parsePurchaseDates` | fn | `purchase-import.ts:125` |
| `PurchaseCreateArgs` | type | `purchase-import.ts:155` |
| `toPurchaseCreateData` | fn | `purchase-import.ts:178` |
| `ReportRangeAnalyses` | type | `report-analyses.ts:12` |
| `assembleReportRangeAnalyses` | fn | `report-analyses.ts:41` |
| `SectionKey` | type | `report-config.ts:14` |
| `DetailLevel` | type | `report-config.ts:23` |
| `ReportTone` | type | `report-config.ts:24` |
| `ReportFocus` | type | `report-config.ts:32` |
| `ReportConfig` | interface | `report-config.ts:37` |
| `SECTION_LABELS` | const | `report-config.ts:60` |
| `defaultReportConfig` | fn | `report-config.ts:81` |
| `normalizeReportConfig` | fn | `report-config.ts:99` |
| `FocusItem` | type | `report-focus-types.ts:14` |
| `FocusTrajectoryPoint` | type | `report-focus-types.ts:21` |
| `SupplierFocusData` | type | `report-focus-types.ts:30` |
| `ReportFocusData` | type | `report-focus-types.ts:47` |
| `assembleSupplierFocus` | fn | `report-focus.ts:28` |
| `ArgumentInput` | type | `report-narrative.ts:41` |
| `EvidenceStat` | type | `report-narrative.ts:52` |
| `ActionRow` | type | `report-narrative.ts:53` |
| `RenderedFinding` | type | `report-narrative.ts:59` |
| `RenderedArgument` | type | `report-narrative.ts:67` |
| `lensVerdict` | fn | `report-narrative.ts:117` |
| `renderReportArgument` | fn | `report-narrative.ts:756` |
| `RenderedSupplierBrief` | type | `report-narrative.ts:865` |
| `renderSupplierBrief` | fn | `report-narrative.ts:1273` |
| `CategorySupplierRow` | type | `report-narrative.ts:1312` |
| `RenderedCategoryDeepDive` | type | `report-narrative.ts:1320` |
| `renderCategoryDeepDive` | fn | `report-narrative.ts:1329` |
| `ReportMetrics` | type | `report-templates.ts:22` |
| `ReportContext` | type | `report-templates.ts:48` |
| `deriveReportContext` | fn | `report-templates.ts:138` |
| `TEMPLATES` | const | `report-templates.ts:289` |
| `runtime` | const | `route.ts:5` |
| `runtime` | const | `route.ts:6` |
| `runtime` | const | `route.ts:7` |
| `runtime` | const | `route.ts:12` |
| `runtime` | const | `route.ts:13` |
| `GET` | fn | `route.ts:14` |
| `runtime` | const | `route.ts:16` |
| `runtime` | const | `route.ts:17` |
| `DELETE` | fn | `route.ts:18` |
| `POST` | fn | `route.ts:18` |
| `POST` | fn | `route.ts:19` |
| `DELETE` | fn | `route.ts:21` |
| `POST` | fn | `route.ts:24` |
| `POST` | fn | `route.ts:25` |
| `POST` | fn | `route.ts:29` |
| `POST` | fn | `route.ts:92` |
| `idCell` | const | `supplier-import.ts:13` |
| `SuppliersRow` | const | `supplier-import.ts:15` |
| `SupplierRowData` | type | `supplier-import.ts:22` |
| `SupplierWriteBody` | const | `supplier-import.ts:30` |
| `SupplierWriteInput` | type | `supplier-import.ts:35` |
| `ResolvedSupplierRow` | type | `supplier-import.ts:38` |
| `SUPPLIER_ID_RE` | const | `supplier-import.ts:46` |
| `formatSupplierId` | fn | `supplier-import.ts:47` |
| `idStr` | fn | `supplier-import.ts:52` |
| `makeIdGen` | fn | `supplier-import.ts:65` |
| `nextSupplierId` | fn | `supplier-import.ts:80` |
| `toSupplierCreateData` | fn | `supplier-import.ts:85` |

**Total distinct exports across this doc's files: 102.**
