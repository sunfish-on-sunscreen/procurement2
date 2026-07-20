import { z } from "zod";
import type { Prisma } from "@/lib/generated/prisma/client";

/**
 * Create ONE complete purchase document chain: requisition → (sourcing event +
 * awarded response, for rfq/tender) → purchase order + lines → ONE OR MORE goods
 * receipts + lines → invoice + lines → payment.
 *
 * ⚠️ COMPLETE-CHAIN ONLY — there is deliberately no "open PO" mode. The
 * EnrichedPurchase view LEFT JOINs receipts / invoices / payments and COALESCEs a
 * PO with no invoice lines to threeWayMatchPass = TRUE, so an open PO would be
 * counted as a three-way-match PASS while contributing nothing to the other rate
 * denominators — silently inflating processScore. Supporting open POs would
 * require changing the rate denominators, i.e. changing a formula. Every PO in the
 * dataset is a complete chain; new ones match.
 */

// --- id formats (read off the seeded data — do not invent) -----------------
//   Requisition   PR-<year>-00001      SourcingEvent RFQ-/TND-<year>-0001
//   Response      <eventId>-Q01        PurchaseOrder PO-<year>-00001
//   PoLine        <poId>-010           GoodsReceipt  GRN-<year>-00001
//   GrnLine       <grnId>-010          Invoice       AP-<year>-00001
//   InvoiceLine   INV-<year>-00001-010 Payment       PAY-<year>-00001
// The year is that document's OWN date year; line suffixes step by 10.

const pad = (n: number, width: number) => String(n).padStart(width, "0");

/**
 * Sourcing-event id prefix per SOURCED buying method. Both methods share one
 * document table but get DISTINCT id namespaces and independent per-year
 * sequences, so an id never reads "RFQ-…" for a tender. Both are 4-digit.
 */
export const SOURCING_ID_PREFIX: Record<SourcedMethod, string> = {
  rfq: "RFQ",
  tender: "TND",
};

export const ID_FORMATS = {
  requisition: (year: number, seq: number) => `PR-${year}-${pad(seq, 5)}`,
  /** Prefixed by the sourced buying method — RFQ-<year>-0001 / TND-<year>-0001. */
  sourcingEvent: (year: number, seq: number, method: SourcedMethod = "rfq") =>
    `${SOURCING_ID_PREFIX[method]}-${year}-${pad(seq, 4)}`,
  response: (sourcingEventId: string, n: number) => `${sourcingEventId}-Q${pad(n, 2)}`,
  purchaseOrder: (year: number, seq: number) => `PO-${year}-${pad(seq, 5)}`,
  poLine: (poId: string, index: number) => `${poId}-${pad((index + 1) * 10, 3)}`,
  goodsReceipt: (year: number, seq: number) => `GRN-${year}-${pad(seq, 5)}`,
  grnLine: (grnId: string, index: number) => `${grnId}-${pad((index + 1) * 10, 3)}`,
  invoice: (year: number, seq: number) => `AP-${year}-${pad(seq, 5)}`,
  /** Invoice lines carry an INV- prefix over the invoice's own year + sequence. */
  invoiceLine: (year: number, seq: number, index: number) =>
    `INV-${year}-${pad(seq, 5)}-${pad((index + 1) * 10, 3)}`,
  payment: (year: number, seq: number) => `PAY-${year}-${pad(seq, 5)}`,
} as const;

/** Highest sequence already used for `prefix-<year>-` + 1. */
async function nextSeq(
  rows: { id: string }[],
  prefix: string,
  year: number,
): Promise<number> {
  const head = `${prefix}-${year}-`;
  let max = 0;
  for (const { id } of rows) {
    if (!id.startsWith(head)) continue;
    const tail = id.slice(head.length).split("-")[0];
    const n = parseInt(tail, 10);
    if (Number.isFinite(n)) max = Math.max(max, n);
  }
  return max + 1;
}

// --- request shape ---------------------------------------------------------

/**
 * RFQ and tender are PEER solicitation methods, not one method with a type: they
 * differ in scope, sealed bidding, public bid opening and formality, so a buyer
 * choosing between them is choosing a method. Both are competitive and each
 * order carries its own sourcing event, responses and award.
 *
 * RFI is excluded on purpose: it produces no purchase order, and a complete
 * chain is required here.
 */
export const BUYING_METHODS = ["rfq", "tender", "spot_buy", "call_off", "direct"] as const;
export type BuyingMethod = (typeof BUYING_METHODS)[number];
export const PAYMENT_TERMS = ["Net 14", "Net 30", "Net 45"] as const;

/**
 * The COMPETITIVELY SOURCED methods — those whose orders carry a sourcing event
 * with invited suppliers, bid responses and an award. Everything else (spot buy,
 * call-off, direct award) has none.
 *
 * ⚠️ THE single definition of that rule. Six separate sites used to test
 * `method === "rfq"` for it — the chain's sourcing gate, three append-validator
 * rules and two form conditionals. Missing any one of them produces a form that
 * renders correctly but posts an incomplete payload, or a validator that rejects
 * a legitimate tender. Always ask through `isSourcedMethod`, never re-inline the
 * literal.
 */
export const SOURCED_METHODS = ["rfq", "tender"] as const;
export type SourcedMethod = (typeof SOURCED_METHODS)[number];

export function isSourcedMethod(method: string): method is SourcedMethod {
  return (SOURCED_METHODS as readonly string[]).includes(method);
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isoDate = z.string().regex(DATE_RE, "Dates must be YYYY-MM-DD");

/**
 * Name-shaped free text. `min(1)` alone let "12" and "da12" through on the
 * requisition fields, which then became the requester/department of a posted,
 * immutable document.
 *
 * The two fields differ deliberately, calibrated against the live vocabulary:
 * - **requester is a PERSON** ("Agus Pratama", "Dedi Firmansyah") — no existing
 *   value contains a digit, and a person's name has none, so ANY digit is rejected.
 * - **department is a PLACE/FUNCTION** ("Drill & Blast", "HSE", "Coal Processing")
 *   — only digit-ONLY is rejected, so a plausible "Warehouse 2" still passes.
 *
 * Both require at least one LETTER, so punctuation-only ("--", "&") is refused.
 * No minimum length beyond that and no two-word rule: "HSE" is a real department.
 * Letters are matched Unicode-aware (\p{L}) rather than A-Z, so a non-ASCII name
 * is not rejected for being non-English.
 */
const HAS_LETTER = /\p{L}/u;
const HAS_DIGIT = /\d/u;
/** Letters, spaces and the punctuation real names use: & - ' . , / ( ) */
const NAME_CHARS = /^[\p{L}\p{M}0-9\s&\-'’.,/()]+$/u;

export const personName = (field: string) =>
  z
    .string()
    .trim()
    .min(1, `${field} is required`)
    .refine((v) => HAS_LETTER.test(v), `${field} must contain a letter`)
    .refine((v) => !HAS_DIGIT.test(v), `${field} must be a name, not a number`)
    .refine((v) => NAME_CHARS.test(v), `${field} contains characters that are not part of a name`);

export const orgName = (field: string) =>
  z
    .string()
    .trim()
    .min(1, `${field} is required`)
    .refine((v) => HAS_LETTER.test(v), `${field} must contain a letter, not just digits`)
    .refine((v) => NAME_CHARS.test(v), `${field} contains characters that are not part of a name`);

const LineInput = z.object({
  item_name: z.string().trim().min(1, "Item name is required"),
  category: z.string().trim().min(1, "Category is required"),
  unit: z.string().trim().min(1, "Unit is required"),
  quantity_ordered: z.number().positive("Quantity must be greater than zero"),
  unit_price_usd: z.number().nonnegative("Unit price cannot be negative"),
  /**
   * Billed quantity + invoice price default to the ACCEPTED quantity (received −
   * rejected, summed across every receipt) and the PO price, which is what a
   * correct invoice looks like and passes the three-way match. Overriding either
   * represents a genuine billing discrepancy — the same condition the dataset
   * injects — and will fail the match, by design.
   */
  quantity_billed: z.number().nonnegative().optional(),
  invoice_unit_price_usd: z.number().nonnegative().optional(),
});

/** What ONE receipt recorded against ONE order line. */
const ReceiptLineInput = z.object({
  /** Index into `lines`. */
  line_index: z.number().int().nonnegative(),
  quantity_received: z.number().nonnegative(),
  quantity_rejected: z.number().nonnegative().default(0),
  defect_count: z.number().int().nonnegative().default(0),
});

/**
 * ONE goods receipt: its own date, site and receiver, covering any subset of the
 * order's lines. A PO may have several — 28% of the seeded orders do, 136 of them
 * receiving at DIFFERENT sites, with most lines split by partial quantity across
 * two receipts. The view takes `deliveryDate = MAX(receiptDate)`, so a split
 * delivery is judged on-time by its FINAL receipt.
 */
const ReceiptInput = z.object({
  receipt_date: isoDate,
  site: orgName("Site"),
  received_by: personName("Received by"),
  lines: z.array(ReceiptLineInput).min(1, "A goods receipt must cover at least one line"),
});

/** Shape shared by the zod refinements and the chain writer, so both total the
 *  same way. Structural (not the inferred zod type) so it applies pre-parse. */
type ReceiptLike = {
  lines: { line_index: number; quantity_received: number; quantity_rejected: number }[];
};

/** Total received for order line `i`, summed across every receipt. */
function receivedFor(receipts: ReceiptLike[], i: number): number {
  return receipts.reduce(
    (sum, r) => sum + r.lines.filter((l) => l.line_index === i).reduce((s, l) => s + l.quantity_received, 0),
    0,
  );
}
/** Total rejected for order line `i`, summed across every receipt. */
function rejectedFor(receipts: ReceiptLike[], i: number): number {
  return receipts.reduce(
    (sum, r) => sum + r.lines.filter((l) => l.line_index === i).reduce((s, l) => s + l.quantity_rejected, 0),
    0,
  );
}

export const CreateTransactionBody = z
  .object({
    supplier_id: z.string().trim().min(1, "Supplier is required"),
    buying_method: z.enum(BUYING_METHODS),
    framework_id: z.string().trim().min(1).optional(),
    justification: z.string().trim().min(1).optional(),
    num_suppliers_invited: z.number().int().min(2).max(10).default(3),

    requester: personName("Requester"),
    department: orgName("Department"),
    payment_terms: z.enum(PAYMENT_TERMS),
    supplier_invoice_no: z.string().trim().min(1, "Supplier invoice number is required"),
    complaint_count: z.number().int().nonnegative().default(0),

    pr_date: isoDate,
    po_date: isoDate,
    promised_delivery_date: isoDate,
    invoice_date: isoDate,
    payment_date: isoDate,

    lines: z.array(LineInput).min(1, "At least one line is required"),
    receipts: z.array(ReceiptInput).min(1, "At least one goods receipt is required"),
  })
  // Buying-method conditionals, mirroring the seeded data exactly: the sourced
  // methods (rfq, tender) each carry their own sourcing event (created here),
  // call_off a framework, direct a justification, spot_buy none of them.
  .refine((v) => v.buying_method !== "call_off" || !!v.framework_id, {
    message: "A call-off order requires a framework agreement.",
    path: ["framework_id"],
  })
  .refine((v) => v.buying_method !== "direct" || !!v.justification, {
    message: "A direct award requires a justification.",
    path: ["justification"],
  })
  .refine((v) => v.buying_method === "call_off" || !v.framework_id, {
    message: "Only a call-off order may reference a framework agreement.",
    path: ["framework_id"],
  })
  // The document chain must move forward in time; the view derives every *Days
  // column as a plain date difference, so out-of-order dates would yield negative
  // cycle times.
  .refine((v) => v.pr_date <= v.po_date, {
    message: "PO date cannot precede the requisition date.",
    path: ["po_date"],
  })
  // With several receipts the chain bounds are the EARLIEST and LATEST of them:
  // nothing may be received before the PO, and the invoice may not precede the
  // final receipt — which is the date the view uses as deliveryDate.
  .refine((v) => v.receipts.every((r) => v.po_date <= r.receipt_date), {
    message: "A receipt date cannot precede the PO date.",
    path: ["receipts"],
  })
  .refine((v) => v.receipts.every((r) => r.receipt_date <= v.invoice_date), {
    message: "The invoice date cannot precede the last receipt date.",
    path: ["invoice_date"],
  })
  .refine((v) => v.invoice_date <= v.payment_date, {
    message: "Payment date cannot precede the invoice date.",
    path: ["payment_date"],
  })
  // Every receipt line must point at a real order line.
  .refine((v) => v.receipts.every((r) => r.lines.every((rl) => rl.line_index < v.lines.length)), {
    message: "A receipt references an order line that does not exist.",
    path: ["receipts"],
  })
  // Complete-chain rule, per line: nothing may be ordered and never received.
  .refine(
    (v) =>
      v.lines.every((_, i) =>
        v.receipts.some((r) => r.lines.some((rl) => rl.line_index === i)),
      ),
    {
      message: "Every order line needs at least one goods receipt.",
      path: ["receipts"],
    },
  )
  // Quantities reconcile ACROSS receipts: a line cannot be over-received, and its
  // rejections cannot exceed what actually arrived. Under-receipt is allowed — a
  // correctly-billed partial delivery is a legitimate, match-passing order.
  .refine((v) => v.lines.every((l, i) => receivedFor(v.receipts, i) <= l.quantity_ordered), {
    message: "Received quantity cannot exceed the quantity ordered.",
    path: ["receipts"],
  })
  .refine((v) => v.lines.every((_, i) => rejectedFor(v.receipts, i) <= receivedFor(v.receipts, i)), {
    message: "Rejected quantity cannot exceed the received quantity.",
    path: ["receipts"],
  });

export type CreateTransactionInput = z.infer<typeof CreateTransactionBody>;

/** UTC midnight, so a date never shifts across a year boundary by timezone. */
function utc(d: string): Date {
  return new Date(`${d}T00:00:00.000Z`);
}
const yearOf = (d: string) => Number(d.slice(0, 4));

export type CreatedChain = {
  poId: string;
  period: string;
  totalValueUsd: number;
  ids: Record<string, string | string[]>;
};

/**
 * Insert the full chain. MUST run inside a transaction — it performs ~9 dependent
 * writes and a partial chain would corrupt the view (and the three-way-match rate).
 * Assumes the body has already been validated and the supplier/framework verified.
 */
export async function createTransactionChain(
  tx: Prisma.TransactionClient,
  input: CreateTransactionInput,
): Promise<CreatedChain> {
  const prYear = yearOf(input.pr_date);
  const poYear = yearOf(input.po_date);
  const invYear = yearOf(input.invoice_date);
  const payYear = yearOf(input.payment_date);

  // Receipts are ordered by date: the sequence of receipt DATES is what makes a
  // split delivery meaningful (the view reads MAX(receiptDate) as deliveryDate),
  // and the "complete" status below depends on cumulative arrival in that order.
  const receipts = [...input.receipts].sort((a, b) => a.receipt_date.localeCompare(b.receipt_date));
  // Receipts may straddle a year boundary, so GRN sequences are allocated PER YEAR.
  const grnYears = [...new Set(receipts.map((r) => yearOf(r.receipt_date)))];

  // Sequence heads. Scoped by the id prefix of the relevant year only.
  const [prRows, poRows, grnRowsByYear, invRows, payRows] = await Promise.all([
    tx.requisition.findMany({ where: { id: { startsWith: `PR-${prYear}-` } }, select: { id: true } }),
    tx.purchaseOrder.findMany({ where: { id: { startsWith: `PO-${poYear}-` } }, select: { id: true } }),
    Promise.all(
      grnYears.map(async (y) => ({
        year: y,
        rows: await tx.goodsReceipt.findMany({
          where: { id: { startsWith: `GRN-${y}-` } },
          select: { id: true },
        }),
      })),
    ),
    tx.invoice.findMany({ where: { id: { startsWith: `AP-${invYear}-` } }, select: { id: true } }),
    tx.payment.findMany({ where: { id: { startsWith: `PAY-${payYear}-` } }, select: { id: true } }),
  ]);

  const prId = ID_FORMATS.requisition(prYear, await nextSeq(prRows, "PR", prYear));
  const poId = ID_FORMATS.purchaseOrder(poYear, await nextSeq(poRows, "PO", poYear));
  // Next free GRN sequence per year, then handed out in receipt-date order.
  const grnNext = new Map<number, number>();
  for (const { year, rows } of grnRowsByYear) {
    grnNext.set(year, await nextSeq(rows, "GRN", year));
  }
  const grnIds = receipts.map((r) => {
    const y = yearOf(r.receipt_date);
    const seq = grnNext.get(y)!;
    grnNext.set(y, seq + 1);
    return ID_FORMATS.goodsReceipt(y, seq);
  });
  const invSeq = await nextSeq(invRows, "AP", invYear);
  const invoiceId = ID_FORMATS.invoice(invYear, invSeq);
  const paymentId = ID_FORMATS.payment(payYear, await nextSeq(payRows, "PAY", payYear));

  const lineValue = (l: CreateTransactionInput["lines"][number]) =>
    l.quantity_ordered * l.unit_price_usd;
  const totalValueUsd = input.lines.reduce((sum, l) => sum + lineValue(l), 0);
  // Dominant (highest-value) line's category — the same rule the view applies.
  const dominant = [...input.lines].sort((a, b) => lineValue(b) - lineValue(a))[0];

  // 1. Requisition
  await tx.requisition.create({
    data: {
      id: prId,
      prDate: utc(input.pr_date),
      requester: input.requester,
      department: input.department,
      category: dominant.category,
      needByDate: utc(input.promised_delivery_date),
      estimatedValueUsd: totalValueUsd,
      status: "approved",
    },
  });

  // 2. Sourcing event + awarded response — competitively sourced methods only
  //    (rfq, tender). The two share this document but have INDEPENDENT id
  //    sequences, so the scan below is scoped to this method's own prefix.
  let sourcingEventId: string | null = null;
  let responseId: string | null = null;
  if (isSourcedMethod(input.buying_method)) {
    const prefix = SOURCING_ID_PREFIX[input.buying_method];
    const eventRows = await tx.sourcingEvent.findMany({
      where: { id: { startsWith: `${prefix}-${prYear}-` } },
      select: { id: true },
    });
    sourcingEventId = ID_FORMATS.sourcingEvent(
      prYear,
      await nextSeq(eventRows, prefix, prYear),
      input.buying_method,
    );
    responseId = ID_FORMATS.response(sourcingEventId, 1);

    await tx.sourcingEvent.create({
      data: {
        id: sourcingEventId,
        prId,
        issueDate: utc(input.pr_date),
        closeDate: utc(input.po_date),
        numSuppliersInvited: input.num_suppliers_invited,
        awardedSupplierId: input.supplier_id,
        awardedResponseId: responseId,
      },
    });
    await tx.response.create({
      data: {
        id: responseId,
        sourcingEventId,
        supplierId: input.supplier_id,
        // The winning quote is the order as placed: spend-weighted unit price and
        // the promised lead time.
        quotedUnitPriceUsd:
          totalValueUsd / input.lines.reduce((q, l) => q + l.quantity_ordered, 0),
        quotedLeadTimeDays: Math.round(
          (utc(input.promised_delivery_date).getTime() - utc(input.po_date).getTime()) / 86_400_000,
        ),
        submittedDate: utc(input.po_date),
        isAwarded: true,
      },
    });
  }

  // 3. Purchase order — period is the ORDER YEAR, converging with the compute
  //    layer's poDate filter.
  const period = String(poYear);
  await tx.purchaseOrder.create({
    data: {
      id: poId,
      prId,
      sourcingEventId,
      supplierId: input.supplier_id,
      buyingMethod: input.buying_method,
      frameworkId: input.buying_method === "call_off" ? (input.framework_id ?? null) : null,
      justification: input.buying_method === "direct" ? (input.justification ?? null) : null,
      poDate: utc(input.po_date),
      promisedDeliveryDate: utc(input.promised_delivery_date),
      paymentTerms: input.payment_terms,
      complaintCount: input.complaint_count,
      status: "closed",
      period,
    },
  });

  // 4. PO lines
  const poLineIds = input.lines.map((_, i) => ID_FORMATS.poLine(poId, i));
  await tx.poLine.createMany({
    data: input.lines.map((l, i) => ({
      id: poLineIds[i],
      poId,
      itemName: l.item_name,
      category: l.category,
      unit: l.unit,
      quantityOrdered: l.quantity_ordered,
      unitPriceUsd: l.unit_price_usd,
      needByDate: utc(input.promised_delivery_date),
    })),
  });

  // 5. Goods receipts (+ lines), in receipt-date order — one or many, each with
  //    its own site and receiver, each covering any subset of the lines.
  //
  //    ⚠️ STATUS is CUMULATIVE-ARRIVAL, matching the seeded vocabulary exactly: a
  //    receipt is `complete` when, counting everything received up to and
  //    INCLUDING it, every order line has reached its ordered quantity; otherwise
  //    `partial`. Verified against all 829 seeded receipts — 647 complete / 182
  //    partial separate perfectly on that rule, and on a two-receipt order the
  //    earlier one is partial and the later one complete.
  //    ⚠️ Rejections do NOT make a receipt partial: 25 seeded `complete` receipts
  //    carry rejected quantity. (The previous single-receipt code also required
  //    zero rejections, which diverged from the data; corrected here. GoodsReceipt
  //    .status is read by neither the view nor python/, so this is inert.)
  const cumulative = input.lines.map(() => 0);
  const grnLineRows: { id: string; grnId: string; poLineId: string; quantityReceived: number; quantityRejected: number; defectCount: number }[] = [];

  for (const [ri, receipt] of receipts.entries()) {
    const grnId = grnIds[ri];
    for (const rl of receipt.lines) cumulative[rl.line_index] += rl.quantity_received;
    const complete = input.lines.every((l, i) => cumulative[i] >= l.quantity_ordered);

    await tx.goodsReceipt.create({
      data: {
        id: grnId,
        poId,
        receiptDate: utc(receipt.receipt_date),
        receivedBy: receipt.received_by,
        site: receipt.site,
        status: complete ? "complete" : "partial",
      },
    });
    receipt.lines.forEach((rl, li) => {
      grnLineRows.push({
        id: ID_FORMATS.grnLine(grnId, li),
        grnId,
        poLineId: poLineIds[rl.line_index],
        quantityReceived: rl.quantity_received,
        quantityRejected: rl.quantity_rejected,
        defectCount: rl.defect_count,
      });
    });
  }
  await tx.grnLine.createMany({ data: grnLineRows });

  // 6. Invoice (+ lines). Billed quantity defaults to ACCEPTED — received minus
  //    rejected, summed ACROSS every receipt — and the price to the PO price, so a
  //    correct invoice passes the three-way match; explicit overrides create a
  //    real discrepancy.
  const received = input.lines.map((_, i) => receivedFor(receipts, i));
  const rejected = input.lines.map((_, i) => rejectedFor(receipts, i));
  const billed = input.lines.map((l, i) => l.quantity_billed ?? received[i] - rejected[i]);
  const invoicePrice = input.lines.map((l) => l.invoice_unit_price_usd ?? l.unit_price_usd);
  const invoiceTotal = input.lines.reduce((sum, _, i) => sum + billed[i] * invoicePrice[i], 0);

  await tx.invoice.create({
    data: {
      id: invoiceId,
      poId,
      supplierId: input.supplier_id,
      supplierInvoiceNo: input.supplier_invoice_no,
      invoiceDate: utc(input.invoice_date),
      totalAmountUsd: invoiceTotal,
      status: "paid",
    },
  });
  await tx.invoiceLine.createMany({
    data: input.lines.map((_, i) => ({
      id: ID_FORMATS.invoiceLine(invYear, invSeq, i),
      invoiceId,
      poLineId: poLineIds[i],
      quantityBilled: billed[i],
      unitPriceUsd: invoicePrice[i],
    })),
  });

  // 7. Payment
  await tx.payment.create({
    data: {
      id: paymentId,
      invoiceId,
      paymentDate: utc(input.payment_date),
      amountPaidUsd: invoiceTotal,
      method: "Bank Transfer",
    },
  });

  return {
    poId,
    period,
    totalValueUsd,
    ids: {
      requisition: prId,
      ...(sourcingEventId ? { sourcingEvent: sourcingEventId, response: responseId! } : {}),
      purchaseOrder: poId,
      poLines: poLineIds,
      goodsReceipts: grnIds,
      invoice: invoiceId,
      payment: paymentId,
    },
  };
}
