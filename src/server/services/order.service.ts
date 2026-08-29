/**
 * Sales order, delivery challan, purchase order and goods receipt note.
 *
 * One service for all four, because they differ only in direction and in whether
 * they move stock:
 *
 *   | Document          | Party    | Stock  | Ledger | Becomes  |
 *   |-------------------|----------|--------|--------|----------|
 *   | SALES_ORDER       | customer | none   | none   | invoice  |
 *   | DELIVERY_CHALLAN  | customer | OUT    | none   | invoice  |
 *   | PURCHASE_ORDER    | supplier | none   | none   | purchase |
 *   | GRN               | supplier | IN     | none   | purchase |
 *
 * None post to the ledger. Orders are commitments — nothing has moved and nothing
 * is owed. Challans and GRNs move stock only, which matches the periodic-inventory
 * approach the posting rules already use (purchases are debited to the Purchases
 * expense ledger, not to Stock-in-Hand), so stock quantity legitimately lives
 * outside the ledger. The ledger entry happens on conversion.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { computeDocument, type RawLineInput } from "./document.service";
import { allocateDocumentNumber, assertPeriodOpen, type DocumentType } from "../numbering";
import { ValidationError } from "./invoice.service";
import { estimateCostRate, purchaseCostPaise, recordStockMovement } from "../stock";

export type OrderDocType =
  | "SALES_ORDER"
  | "DELIVERY_CHALLAN"
  | "PURCHASE_ORDER"
  | "GRN";

/** Per-type behaviour, in one place so the four cannot drift apart. */
export const DOC_CONFIG: Record<
  OrderDocType,
  {
    label: string;
    /** Which side of the trade the party is on. */
    partyType: "CUSTOMER" | "VENDOR";
    /** Stock effect when the document is created. */
    stockEffect: "NONE" | "OUT" | "IN";
    /** What converting it produces. */
    convertsTo: "INVOICE" | "PURCHASE";
    /** Counter key + default prefix. */
    counter: DocumentType;
    prefix: string;
    /** GST requires transport details when goods move without an invoice. */
    needsTransport: boolean;
  }
> = {
  SALES_ORDER: {
    label: "Sales Order",
    partyType: "CUSTOMER",
    stockEffect: "NONE",
    convertsTo: "INVOICE",
    counter: "SALES_ORDER",
    prefix: "SO",
    needsTransport: false,
  },
  DELIVERY_CHALLAN: {
    label: "Delivery Challan",
    partyType: "CUSTOMER",
    stockEffect: "OUT",
    convertsTo: "INVOICE",
    counter: "DELIVERY_CHALLAN",
    prefix: "DC",
    needsTransport: true,
  },
  PURCHASE_ORDER: {
    label: "Purchase Order",
    partyType: "VENDOR",
    stockEffect: "NONE",
    convertsTo: "PURCHASE",
    counter: "PURCHASE_ORDER",
    prefix: "PO",
    needsTransport: false,
  },
  GRN: {
    label: "Goods Receipt Note",
    partyType: "VENDOR",
    stockEffect: "IN",
    convertsTo: "PURCHASE",
    counter: "GRN",
    prefix: "GRN",
    needsTransport: false,
  },
};

export type CreateOrderInput = {
  companyId: string;
  userId: string;
  docType: OrderDocType;
  partyId: string;
  date?: Date;
  expectedDate?: Date | null;
  notes?: string | null;
  externalRef?: string | null;
  transporterName?: string | null;
  vehicleNumber?: string | null;
  movementReason?: string | null;
  godownId?: string | null;
  lines: RawLineInput[];
  discount?: number | string;
  additionalCharges?: number | string;
  reverseCharge?: boolean;
  placeOfSupply?: string | null;
  /** Raised from an existing order (DC from SO, GRN from PO). */
  sourceDocumentId?: string | null;
};

export async function createOrderDocument(input: CreateOrderInput) {
  const config = DOC_CONFIG[input.docType];
  if (!config) throw new ValidationError("Unknown document type");

  const date = input.date ?? new Date();

  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new ValidationError("Add at least one item");
  }

  const company = await db.company.findUnique({
    where: { id: input.companyId },
    select: {
      id: true,
      stateCode: true,
      roundInvoices: true,
      gstScheme: true,
    },
  });
  if (!company) throw new ValidationError("Company not found");

  const party = await db.party.findFirst({
    where: { id: input.partyId, companyId: input.companyId },
    select: { id: true, name: true, type: true, stateCode: true },
  });
  if (!party) throw new ValidationError("Invalid party");

  // A purchase order addressed to a customer is almost always a mistake, and
  // catching it here is cheaper than discovering it in a supplier ledger.
  if (config.partyType === "VENDOR" && party.type === "CUSTOMER") {
    throw new ValidationError(
      `${config.label} must be raised against a supplier, but "${party.name}" is a customer.`
    );
  }
  if (config.partyType === "CUSTOMER" && party.type === "VENDOR") {
    throw new ValidationError(
      `${config.label} must be raised against a customer, but "${party.name}" is a supplier.`
    );
  }

  if (config.needsTransport && !input.vehicleNumber && !input.transporterName) {
    throw new ValidationError(
      "A delivery challan moves goods without an invoice, so GST requires transport details. " +
        "Enter a vehicle number or transporter name."
    );
  }

  if (input.godownId) {
    const owned = await db.godown.findFirst({
      where: { id: input.godownId, companyId: input.companyId },
      select: { id: true },
    });
    if (!owned) throw new ValidationError("Invalid godown");
  }

  // A source document must belong to this tenant and be of the right kind.
  if (input.sourceDocumentId) {
    const source = await db.orderDocument.findFirst({
      where: { id: input.sourceDocumentId, companyId: input.companyId },
      select: { id: true, docType: true, status: true },
    });
    if (!source) throw new ValidationError("Source document not found");

    const expectedSource =
      input.docType === "DELIVERY_CHALLAN"
        ? "SALES_ORDER"
        : input.docType === "GRN"
          ? "PURCHASE_ORDER"
          : null;

    if (expectedSource && source.docType !== expectedSource) {
      throw new ValidationError(
        `A ${config.label} can only be raised from a ${DOC_CONFIG[expectedSource as OrderDocType].label}.`
      );
    }
    if (source.status === "CANCELLED") {
      throw new ValidationError("The source document has been cancelled.");
    }
  }

  await assertPeriodOpen(db, input.companyId, date);

  const { header, lines } = computeDocument({
    supplierStateCode: company.stateCode,
    partyStateCode: party.stateCode,
    placeOfSupply: input.placeOfSupply,
    lines: input.lines,
    invoiceDiscount: input.discount,
    additionalCharges: input.additionalCharges,
    reverseCharge: input.reverseCharge,
    roundToNearestRupee: company.roundInvoices,
    isComposition: company.gstScheme === "COMPOSITION",
  });

  return db.$transaction(async (tx) => {
    const { number } = await allocateDocumentNumber(tx, {
      companyId: input.companyId,
      documentType: config.counter,
      prefix: config.prefix,
      date,
    });

    const created = await tx.orderDocument.create({
      data: {
        companyId: input.companyId,
        partyId: party.id,
        docType: input.docType,
        number,
        date,
        expectedDate: input.expectedDate ?? null,
        status: "OPEN",
        notes: input.notes ?? null,
        externalRef: input.externalRef ?? null,
        transporterName: input.transporterName ?? null,
        vehicleNumber: input.vehicleNumber ?? null,
        movementReason: input.movementReason ?? null,
        godownId: input.godownId ?? null,
        sourceDocumentId: input.sourceDocumentId ?? null,
        ...header,
        items: {
          create: lines.map((l) => ({
            itemId: l.itemId,
            itemName: l.itemName,
            hsn: l.hsn,
            quantity: l.quantity,
            unit: l.unit,
            ratePaise: l.ratePaise,
            discountPaise: l.discountPaise,
            apportionedDiscountPaise: l.apportionedDiscountPaise,
            taxablePaise: l.taxablePaise,
            gstRate: l.gstRate,
            cessRate: l.cessRate,
            cessPerUnitPaise: l.cessPerUnitPaise,
            cgstPaise: l.cgstPaise,
            sgstPaise: l.sgstPaise,
            igstPaise: l.igstPaise,
            cessPaise: l.cessPaise,
            totalPaise: l.totalPaise,
            supplyType: l.supplyType,
            pricingMode: l.pricingMode,
          })),
        },
      },
      include: { items: true, party: true },
    });

    // Stock moves for challans and GRNs only.
    if (config.stockEffect !== "NONE") {
      for (const line of lines) {
        if (!line.itemId) continue;
        // A GRN receives goods, so it carries their cost. A delivery challan
        // issues them and the valuation engine decides what they cost.
        const costPaise =
          config.stockEffect === "IN" ? purchaseCostPaise(line, company.gstScheme) : undefined;
        await recordStockMovement(tx, {
          companyId: input.companyId,
          itemId: line.itemId,
          direction: config.stockEffect === "IN" ? "IN" : "OUT",
          quantity: line.quantity,
          date,
          reference: number,
          notes: `${config.label}: ${number}`,
          sourceType: input.docType === "GRN" ? "GRN" : "DELIVERY_CHALLAN",
          sourceId: created.id,
          godownId: input.godownId ?? null,
          valuePaise: costPaise,
        });
      }
    }

    // Record fulfilment against the source order, so a partly-delivered order
    // shows as PARTIAL rather than staying OPEN forever.
    if (input.sourceDocumentId) {
      await applyFulfilment(tx, input.sourceDocumentId, lines);
    }

    return created;
  });
}

/**
 * Increase `fulfilledQuantity` on the source order's lines and update its status.
 *
 * Matched by item where possible, falling back to the item name, because a line
 * typed by hand has no itemId.
 */
async function applyFulfilment(
  tx: Prisma.TransactionClient,
  sourceDocumentId: string,
  deliveredLines: { itemId: string | null; itemName: string; quantity: number }[]
): Promise<void> {
  const sourceItems = await tx.orderDocumentItem.findMany({
    where: { documentId: sourceDocumentId },
  });

  for (const delivered of deliveredLines) {
    const match =
      sourceItems.find(
        (s) => delivered.itemId && s.itemId === delivered.itemId && s.fulfilledQuantity < s.quantity
      ) ??
      sourceItems.find(
        (s) =>
          s.itemName.trim().toLowerCase() === delivered.itemName.trim().toLowerCase() &&
          s.fulfilledQuantity < s.quantity
      );
    if (!match) continue;

    // Never record more delivered than ordered: an over-delivery is a separate
    // document, not a line that exceeds its own order.
    const remaining = match.quantity - match.fulfilledQuantity;
    const applied = Math.min(remaining, delivered.quantity);

    await tx.orderDocumentItem.update({
      where: { id: match.id },
      data: { fulfilledQuantity: match.fulfilledQuantity + applied },
    });
    match.fulfilledQuantity += applied;
  }

  const refreshed = await tx.orderDocumentItem.findMany({
    where: { documentId: sourceDocumentId },
    select: { quantity: true, fulfilledQuantity: true },
  });

  const fullyDone = refreshed.every((i) => i.fulfilledQuantity >= i.quantity);
  const anyDone = refreshed.some((i) => i.fulfilledQuantity > 0);

  await tx.orderDocument.update({
    where: { id: sourceDocumentId },
    data: { status: fullyDone ? "COMPLETED" : anyDone ? "PARTIAL" : "OPEN" },
  });
}

/**
 * Cancel an order document, reversing any stock it moved.
 *
 * Cancelling rather than deleting keeps the number consumed, which matters for
 * delivery challans: they accompany a physical movement of goods and the series
 * needs to be accountable.
 */
export async function cancelOrderDocument(
  companyId: string,
  documentId: string,
  reason: string
) {
  return db.$transaction(async (tx) => {
    const doc = await tx.orderDocument.findFirst({
      where: { id: documentId, companyId },
      include: { items: true },
    });
    if (!doc) throw new ValidationError("Document not found");
    if (doc.status === "CANCELLED") throw new ValidationError("Already cancelled");
    if (doc.convertedToId) {
      throw new ValidationError(
        "This document has already been converted. Cancel or credit the resulting invoice instead."
      );
    }

    await assertPeriodOpen(tx, companyId, doc.date);

    const config = DOC_CONFIG[doc.docType as OrderDocType];

    // Put the stock back the way it was.
    if (config && config.stockEffect !== "NONE") {
      for (const line of doc.items) {
        if (!line.itemId) continue;
        const reversing = config.stockEffect === "IN" ? "OUT" : "IN";
        const ratePaise =
          reversing === "IN" ? await estimateCostRate(tx, companyId, line.itemId) : undefined;
        await recordStockMovement(tx, {
          companyId,
          itemId: line.itemId,
          direction: reversing,
          quantity: line.quantity,
          reference: doc.number,
          notes: `${config.label} cancelled: ${doc.number}`,
          sourceType: doc.docType === "GRN" ? "PURCHASE_RETURN" : "SALES_RETURN",
          sourceId: doc.id,
          godownId: doc.godownId,
          ratePaise,
        });
      }
    }

    return tx.orderDocument.update({
      where: { id: documentId },
      data: { status: "CANCELLED", notes: `${doc.notes ?? ""}\nCancelled: ${reason}`.trim() },
    });
  });
}

/**
 * Goods received but not yet invoiced.
 *
 * With periodic inventory, a GRN raises stock without creating a liability. That
 * is correct, but it means an un-invoiced GRN is a real reconciliation item — the
 * business holds goods it has not recorded a payable for. Surfacing it is the
 * difference between a known gap and a silent one.
 */
export async function getGoodsReceivedNotInvoiced(companyId: string) {
  const documents = await db.orderDocument.findMany({
    where: {
      companyId,
      docType: "GRN",
      status: { not: "CANCELLED" },
      convertedToId: null,
    },
    include: {
      party: { select: { id: true, name: true } },
      items: { select: { quantity: true, totalPaise: true } },
    },
    orderBy: { date: "asc" },
  });

  const rows = documents.map((d) => ({
    id: d.id,
    number: d.number,
    date: d.date,
    partyName: d.party.name,
    externalRef: d.externalRef,
    valuePaise: d.grandTotalPaise,
    ageDays: Math.floor((Date.now() - d.date.getTime()) / 86_400_000),
  }));

  return {
    rows,
    totalPaise: rows.reduce((s, r) => s + r.valuePaise, 0),
    count: rows.length,
  };
}
