import { z } from "zod";
import type { Prisma } from "@/lib/generated/prisma/client";

/**
 * Correction entries for POSTED transactional documents.
 *
 * A posted record is a statement about something that happened, so it is never
 * mutated (database triggers enforce this — see the immutability migration).
 * Instead a correction APPENDS signed line rows that net against the original and
 * link back via `correctsLineId`, with a Correction header recording who/why/when.
 *
 * Every reducer in the EnrichedPurchase view nets these correctly: spend, quantity,
 * accepted quantity, billed quantity and defects are all SUMs, and the two reducers
 * that were not — dominant category and the billed unit price — were made
 * correction-aware in the preceding migration (per-category SUM, and the
 * value-weighted effective price).
 *
 * Item identity FOLDS to the original line everywhere lines are read
 * (lib/po-lines.ts, python load_po_lines), so a correction never appears as a
 * phantom negative-quantity item in a breakdown.
 */

export const CORRECTION_KINDS = ["quantity", "price", "defect"] as const;
export type CorrectionKind = (typeof CORRECTION_KINDS)[number];

export const CORRECTION_KIND_LABELS: Record<CorrectionKind, string> = {
  quantity: "Quantity — goods returned or order reduced",
  price: "Price — billing corrected (credit / re-bill)",
  defect: "Defects — defect count corrected",
};

export const CorrectionBody = z
  .object({
    po_line_id: z.string().trim().min(1, "A PO line is required"),
    kind: z.enum(CORRECTION_KINDS),
    reason: z.string().trim().min(3, "A reason is required"),
    /** quantity: signed delta. Negative returns/cancels; positive adds. */
    quantity_delta: z.number().optional(),
    /** price: the corrected unit price the supplier should have billed. */
    corrected_unit_price: z.number().nonnegative().optional(),
    /** defect: signed delta against the recorded defect count. */
    defect_delta: z.number().int().optional(),
  })
  .refine((v) => v.kind !== "quantity" || (v.quantity_delta !== undefined && v.quantity_delta !== 0), {
    message: "A quantity correction needs a non-zero quantity change.",
    path: ["quantity_delta"],
  })
  .refine((v) => v.kind !== "price" || v.corrected_unit_price !== undefined, {
    message: "A price correction needs the corrected unit price.",
    path: ["corrected_unit_price"],
  })
  .refine((v) => v.kind !== "defect" || (v.defect_delta !== undefined && v.defect_delta !== 0), {
    message: "A defect correction needs a non-zero defect change.",
    path: ["defect_delta"],
  });

export type CorrectionInput = z.infer<typeof CorrectionBody>;

/** `PO-2024-00001-010` + 1 existing correction -> `PO-2024-00001-010-C02`. */
function correctionId(originalId: string, seq: number): string {
  return `${originalId}-C${String(seq).padStart(2, "0")}`;
}

export type PostedCorrection = {
  correctionId: string;
  kind: CorrectionKind;
  poId: string;
  createdRows: string[];
  netEffect: string;
};

/**
 * Post one correction. MUST run inside a transaction: it writes a header plus two
 * or three linked signed rows, and a partial write would leave the document chain
 * inconsistent (and could flip the three-way match).
 */
export async function postCorrection(
  tx: Prisma.TransactionClient,
  input: CorrectionInput,
  userId: string,
): Promise<PostedCorrection> {
  const line = await tx.poLine.findUnique({
    where: { id: input.po_line_id },
    select: {
      id: true,
      poId: true,
      itemName: true,
      category: true,
      unit: true,
      quantityOrdered: true,
      unitPriceUsd: true,
      needByDate: true,
      correctsLineId: true,
    },
  });
  if (!line) throw new Error(`PO line ${input.po_line_id} not found.`);
  if (line.correctsLineId) {
    throw new Error(
      "That row is itself a correction. Post the new correction against the ORIGINAL line.",
    );
  }

  const header = await tx.correction.create({
    data: {
      kind: input.kind,
      poId: line.poId,
      reason: input.reason,
      createdBy: userId,
    },
    select: { id: true },
  });

  const existing = await tx.poLine.count({ where: { correctsLineId: line.id } });
  const existingInv = await tx.invoiceLine.count({
    where: { correctsLine: { poLineId: line.id } },
  });
  const existingGrn = await tx.grnLine.count({ where: { correctsLine: { poLineId: line.id } } });

  const created: string[] = [];
  let netEffect = "";

  if (input.kind === "quantity") {
    const delta = input.quantity_delta!;
    // The correction rides on the ORIGINAL line's receipt + invoice documents, so
    // the chain stays attached to the same GRN and invoice.
    const grnLine = await tx.grnLine.findFirst({
      where: { poLineId: line.id, correctsLineId: null },
      select: { id: true, grnId: true },
    });
    const invLine = await tx.invoiceLine.findFirst({
      where: { poLineId: line.id, correctsLineId: null },
      select: { id: true, invoiceId: true, unitPriceUsd: true },
    });
    if (!grnLine || !invLine) {
      throw new Error("The original line has no receipt/invoice line to correct against.");
    }

    // A new signed PO line carries the value change; identity folds to the original
    // when read, so breakdowns stay clean.
    const newPoLineId = correctionId(line.id, existing + 1);
    await tx.poLine.create({
      data: {
        id: newPoLineId,
        poId: line.poId,
        itemName: line.itemName,
        category: line.category,
        unit: line.unit,
        quantityOrdered: delta,
        unitPriceUsd: line.unitPriceUsd,
        needByDate: line.needByDate,
        correctsLineId: line.id,
        correctionId: header.id,
      },
    });
    await tx.grnLine.create({
      data: {
        id: correctionId(grnLine.id, existingGrn + 1),
        grnId: grnLine.grnId,
        poLineId: newPoLineId,
        quantityReceived: delta,
        quantityRejected: 0,
        defectCount: 0,
        correctsLineId: grnLine.id,
        correctionId: header.id,
      },
    });
    await tx.invoiceLine.create({
      data: {
        id: correctionId(invLine.id, existingInv + 1),
        invoiceId: invLine.invoiceId,
        poLineId: newPoLineId,
        quantityBilled: delta,
        unitPriceUsd: line.unitPriceUsd,
        correctsLineId: invLine.id,
        correctionId: header.id,
      },
    });
    created.push(newPoLineId);
    netEffect = `quantity ${delta > 0 ? "+" : ""}${delta} @ ${line.unitPriceUsd} = ${(delta * line.unitPriceUsd).toFixed(2)} USD`;
  } else if (input.kind === "price") {
    // A billing correction: credit the original invoice line and re-bill at the
    // corrected price, both against the ORIGINAL po line. Billed quantity is
    // unchanged; the view's value-weighted price becomes the corrected one.
    const invLine = await tx.invoiceLine.findFirst({
      where: { poLineId: line.id, correctsLineId: null },
      select: { id: true, invoiceId: true, quantityBilled: true, unitPriceUsd: true },
    });
    if (!invLine) throw new Error("The original line has no invoice line to correct.");
    const price = input.corrected_unit_price!;

    await tx.invoiceLine.create({
      data: {
        id: correctionId(invLine.id, existingInv + 1),
        invoiceId: invLine.invoiceId,
        poLineId: line.id,
        quantityBilled: -invLine.quantityBilled,
        unitPriceUsd: invLine.unitPriceUsd,
        correctsLineId: invLine.id,
        correctionId: header.id,
      },
    });
    await tx.invoiceLine.create({
      data: {
        id: correctionId(invLine.id, existingInv + 2),
        invoiceId: invLine.invoiceId,
        poLineId: line.id,
        quantityBilled: invLine.quantityBilled,
        unitPriceUsd: price,
        correctsLineId: invLine.id,
        correctionId: header.id,
      },
    });
    created.push(correctionId(invLine.id, existingInv + 1), correctionId(invLine.id, existingInv + 2));
    netEffect = `billed price ${invLine.unitPriceUsd} → ${price} on ${invLine.quantityBilled} units`;
  } else {
    // Defects only — no value or quantity movement.
    const delta = input.defect_delta!;
    const grnLine = await tx.grnLine.findFirst({
      where: { poLineId: line.id, correctsLineId: null },
      select: { id: true, grnId: true },
    });
    if (!grnLine) throw new Error("The original line has no receipt line to correct.");
    const id = correctionId(grnLine.id, existingGrn + 1);
    await tx.grnLine.create({
      data: {
        id,
        grnId: grnLine.grnId,
        poLineId: line.id,
        quantityReceived: 0,
        quantityRejected: 0,
        defectCount: delta,
        correctsLineId: grnLine.id,
        correctionId: header.id,
      },
    });
    created.push(id);
    netEffect = `defects ${delta > 0 ? "+" : ""}${delta}`;
  }

  return {
    correctionId: header.id,
    kind: input.kind,
    poId: line.poId,
    createdRows: created,
    netEffect,
  };
}
