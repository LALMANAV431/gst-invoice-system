/**
 * Invoice service.
 *
 * Owns the whole "create an invoice" operation as ONE transaction:
 * number allocation, GST computation, line items, stock movements and the
 * double-entry posting. Previously this logic lived inline in the route handler,
 * which meant it could not be unit tested, and POS / recurring invoices
 * re-implemented the same rules slightly differently.
 *
 * Everything here works in integer paise via src/lib/money.ts.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  computeGstInvoice,
  GstLineInput,
  isInterStateSupply,
  normaliseStateCode,
  PricingMode,
  SupplyType,
} from "@/lib/gst";
import { toPaise, toRupees } from "@/lib/money";
import { buildInvoicePosting, LEDGER, salesLedgerForSupplyType } from "@/lib/accounting";
import { allocateDocumentNumber, assertPeriodOpen } from "../numbering";
import { ensureChartOfAccounts, ensurePartyLedger, postJournalEntry, deletePostingsFor } from "../ledger";
import { estimateCostRate, recordStockMovement } from "../stock";

export type InvoiceLineInput = {
  itemId?: string | null;
  itemName: string;
  hsn?: string | null;
  quantity: number;
  unit?: string;
  /** Rupees, as entered by the user. Converted to paise internally. */
  rate: number | string;
  discount?: number | string;
  gstRate: number;
  cessRate?: number;
  cessPerUnit?: number | string;
  supplyType?: SupplyType;
  pricingMode?: PricingMode;
};

export type CreateInvoiceInput = {
  companyId: string;
  userId: string;
  partyId: string;
  date?: Date;
  dueDate?: Date | null;
  notes?: string | null;
  lines: InvoiceLineInput[];
  /** Rupees. Apportioned across lines BEFORE tax. */
  invoiceDiscount?: number | string;
  additionalCharges?: number | string;
  additionalChargesGstRate?: number;
  reverseCharge?: boolean;
  tdsRate?: number;
  /** Overrides the party's state. Needed for services with special POS rules. */
  placeOfSupply?: string | null;
  roundToNearestRupee?: boolean;
};

export class ValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

/**
 * Create an invoice.
 *
 * Runs entirely inside one interactive transaction, so a failure anywhere leaves
 * no partial invoice, no orphan stock movement and no unbalanced ledger entry.
 */
export async function createInvoice(input: CreateInvoiceInput) {
  const date = input.date ?? new Date();

  if (!input.partyId) throw new ValidationError("Customer is required");
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new ValidationError("Add at least one item");
  }

  const company = await db.company.findUnique({
    where: { id: input.companyId },
    select: {
      id: true,
      stateCode: true,
      invoicePrefix: true,
      journalPrefix: true,
      roundInvoices: true,
      gstScheme: true,
    },
  });
  if (!company) throw new ValidationError("Company not found");

  const party = await db.party.findFirst({
    where: { id: input.partyId, companyId: input.companyId },
    select: {
      id: true,
      name: true,
      type: true,
      stateCode: true,
      openingBalancePaise: true,
      balanceType: true,
      creditLimitPaise: true,
    },
  });
  if (!party) throw new ValidationError("Invalid customer");

  await assertPeriodOpen(db, input.companyId, date);

  const placeOfSupply =
    normaliseStateCode(input.placeOfSupply) ?? normaliseStateCode(party.stateCode);

  // A composition dealer cannot collect GST; it issues a bill of supply.
  const reverseCharge = input.reverseCharge ?? false;
  const isComposition = company.gstScheme === "COMPOSITION";

  const gstLines: GstLineInput[] = input.lines.map((l) => ({
    description: l.itemName,
    hsn: l.hsn ?? null,
    quantity: Number(l.quantity) || 0,
    rate: l.rate,
    discount: l.discount ?? 0,
    gstRate: isComposition ? 0 : Number(l.gstRate) || 0,
    cessRate: isComposition ? 0 : l.cessRate ?? 0,
    cessPerUnit: isComposition ? 0 : l.cessPerUnit ?? 0,
    supplyType: l.supplyType ?? "TAXABLE",
    pricingMode: l.pricingMode ?? "EXCLUSIVE",
  }));

  const gst = computeGstInvoice({
    supplierStateCode: company.stateCode,
    placeOfSupplyStateCode: placeOfSupply,
    lines: gstLines,
    invoiceDiscount: input.invoiceDiscount ?? 0,
    additionalCharges: input.additionalCharges ?? 0,
    additionalChargesGstRate: input.additionalChargesGstRate,
    reverseCharge,
    tdsRate: input.tdsRate ?? 0,
    roundToNearestRupee: input.roundToNearestRupee ?? company.roundInvoices,
  });

  // Credit limit check, using the party's current outstanding.
  if (party.creditLimitPaise > 0) {
    const outstanding = await outstandingForParty(input.companyId, party.id);
    if (outstanding + gst.grandTotalPaise > party.creditLimitPaise) {
      throw new ValidationError(
        `This invoice would take ${party.name} past their credit limit of ` +
          `Rs ${toRupees(party.creditLimitPaise).toFixed(2)} ` +
          `(current outstanding Rs ${toRupees(outstanding).toFixed(2)}).`
      );
    }
  }

  return db.$transaction(async (tx) => {
    const { number } = await allocateDocumentNumber(tx, {
      companyId: input.companyId,
      documentType: "INVOICE",
      prefix: company.invoicePrefix,
      date,
    });

    const invoice = await tx.invoice.create({
      data: {
        companyId: input.companyId,
        partyId: party.id,
        number,
        date,
        dueDate: input.dueDate ?? null,
        notes: input.notes ?? null,
        status: "UNPAID",
        subTotalPaise: gst.taxablePaise - gst.additionalChargesPaise,
        cgstTotalPaise: gst.cgstPaise,
        sgstTotalPaise: gst.sgstPaise,
        igstTotalPaise: gst.igstPaise,
        cessTotalPaise: gst.cessPaise,
        taxTotalPaise: gst.taxPaise,
        discountPaise: gst.invoiceDiscountPaise,
        additionalChargesPaise: gst.additionalChargesPaise,
        roundOffPaise: gst.roundOffPaise,
        grandTotalPaise: gst.grandTotalPaise,
        amountPaidPaise: 0,
        isInterState: gst.isInterState,
        reverseCharge,
        placeOfSupply,
        tdsRate: input.tdsRate ?? 0,
        tdsPaise: gst.tdsPaise,
        items: {
          create: gst.lines.map((line, i) => ({
            itemId: input.lines[i].itemId || null,
            itemName: input.lines[i].itemName,
            hsn: line.hsn,
            quantity: line.quantity,
            unit: input.lines[i].unit || "NOS",
            ratePaise: line.ratePaise,
            discountPaise: line.discountPaise,
            apportionedDiscountPaise: line.apportionedDiscountPaise,
            taxablePaise: line.taxablePaise,
            gstRate: line.gstRate,
            cessRate: input.lines[i].cessRate ?? 0,
            cessPerUnitPaise: toPaise(input.lines[i].cessPerUnit ?? 0),
            cgstPaise: line.cgstPaise,
            sgstPaise: line.sgstPaise,
            igstPaise: line.igstPaise,
            cessPaise: line.cessPaise,
            totalPaise: line.totalPaise,
            supplyType: line.supplyType,
            pricingMode: input.lines[i].pricingMode ?? "EXCLUSIVE",
          })),
        },
      },
      include: { items: true, party: true },
    });

    // Stock out for inventory-linked lines.
    for (let i = 0; i < input.lines.length; i++) {
      const src = input.lines[i];
      if (!src.itemId) continue;
      await recordStockMovement(tx, {
        companyId: input.companyId,
        itemId: src.itemId,
        direction: "OUT",
        quantity: Number(src.quantity) || 0,
        date,
        reference: number,
        notes: `Sale: ${number}`,
        sourceType: "SALE",
        sourceId: invoice.id,
      });
    }

    // Double-entry posting.
    await ensureChartOfAccounts(tx, input.companyId);
    const partyLedger = await ensurePartyLedger(tx, input.companyId, party);

    // Split taxable value by supply type so exempt and zero-rated sales land in
    // their own ledgers, which is what makes correct GSTR-1 grouping possible.
    const taxableByLedger: Record<string, number> = {};
    for (const line of gst.lines) {
      const ledger = salesLedgerForSupplyType(line.supplyType);
      taxableByLedger[ledger] = (taxableByLedger[ledger] ?? 0) + line.taxablePaise;
    }

    const posting = buildInvoicePosting({
      partyLedger: partyLedger.name,
      date,
      number,
      invoiceId: invoice.id,
      taxableByLedger,
      cgstPaise: gst.cgstPaise,
      sgstPaise: gst.sgstPaise,
      igstPaise: gst.igstPaise,
      cessPaise: gst.cessPaise,
      additionalChargesPaise: gst.additionalChargesPaise,
      roundOffPaise: gst.roundOffPaise,
      grandTotalPaise: gst.grandTotalPaise,
      tdsPaise: gst.tdsPaise,
      reverseCharge,
    });

    await postJournalEntry(tx, {
      companyId: input.companyId,
      userId: input.userId,
      posting,
      voucherNo: number,
      journalPrefix: company.journalPrefix,
    });

    return invoice;
  });
}

/**
 * Delete an invoice, restoring stock and removing its ledger entry.
 *
 * GST requires cancellation rather than deletion for issued invoices, so prefer
 * `cancelInvoice`. This exists for drafts and mistakes caught immediately.
 */
export async function deleteInvoice(companyId: string, invoiceId: string) {
  return db.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, companyId },
      include: { items: true },
    });
    if (!invoice) throw new ValidationError("Invoice not found");

    await assertPeriodOpen(tx, companyId, invoice.date);

    // Put the stock back.
    for (const line of invoice.items) {
      if (!line.itemId) continue;
      // Goods coming back need a COST, which no sales document states - an
      // invoice records what we charged, not what the goods cost us. Valuing the
      // return at the sale price would inflate closing stock by the margin.
      const ratePaise = await estimateCostRate(tx, companyId, line.itemId);
      await recordStockMovement(tx, {
        companyId,
        itemId: line.itemId,
        direction: "IN",
        quantity: line.quantity,
        reference: invoice.number,
        notes: `Invoice deleted: ${invoice.number}`,
        sourceType: "SALES_RETURN",
        sourceId: invoice.id,
        ratePaise,
      });
    }

    await deletePostingsFor(tx, companyId, "Invoice", invoiceId);
    await tx.invoice.delete({ where: { id: invoiceId } });
    return invoice;
  });
}

/**
 * Cancel an invoice without deleting it.
 *
 * The correct treatment for an issued GST invoice: the number stays consumed
 * (the series must have no gaps), the document remains auditable, and the ledger
 * effect is removed.
 */
export async function cancelInvoice(
  companyId: string,
  invoiceId: string,
  reason: string
) {
  return db.$transaction(async (tx) => {
    const invoice = await tx.invoice.findFirst({
      where: { id: invoiceId, companyId },
      include: { items: true },
    });
    if (!invoice) throw new ValidationError("Invoice not found");
    if (invoice.status === "CANCELLED") throw new ValidationError("Invoice is already cancelled");
    if (invoice.amountPaidPaise > 0) {
      throw new ValidationError(
        "This invoice has payments against it. Delete the payments first, or raise a credit note instead."
      );
    }

    await assertPeriodOpen(tx, companyId, invoice.date);

    for (const line of invoice.items) {
      if (!line.itemId) continue;
      const ratePaise = await estimateCostRate(tx, companyId, line.itemId);
      await recordStockMovement(tx, {
        companyId,
        itemId: line.itemId,
        direction: "IN",
        quantity: line.quantity,
        reference: invoice.number,
        notes: `Invoice cancelled: ${invoice.number}`,
        sourceType: "SALES_RETURN",
        sourceId: invoice.id,
        ratePaise,
      });
    }

    await deletePostingsFor(tx, companyId, "Invoice", invoiceId);

    return tx.invoice.update({
      where: { id: invoiceId },
      data: { status: "CANCELLED", cancelledAt: new Date(), cancelReason: reason },
    });
  });
}

/** Outstanding receivable for a party, in paise. */
export async function outstandingForParty(companyId: string, partyId: string): Promise<number> {
  const result = await db.invoice.aggregate({
    where: { companyId, partyId, status: { notIn: ["PAID", "CANCELLED"] } },
    _sum: { grandTotalPaise: true, amountPaidPaise: true },
  });
  return (result._sum.grandTotalPaise ?? 0) - (result._sum.amountPaidPaise ?? 0);
}

/**
 * Recalculate an invoice's paid amount and status from its payments.
 *
 * Derived rather than incremented, so it self-heals if a payment is edited or
 * deleted - an incremented counter drifts, a derived one cannot.
 */
export async function refreshInvoiceStatus(
  tx: Prisma.TransactionClient,
  invoiceId: string
): Promise<void> {
  const invoice = await tx.invoice.findUnique({
    where: { id: invoiceId },
    select: { grandTotalPaise: true, status: true },
  });
  if (!invoice) return;

  const paid = await tx.payment.aggregate({
    where: { invoiceId },
    _sum: { amountPaise: true },
  });
  const amountPaidPaise = paid._sum.amountPaise ?? 0;

  let status = invoice.status;
  if (status !== "CANCELLED") {
    if (amountPaidPaise <= 0) status = "UNPAID";
    else if (amountPaidPaise >= invoice.grandTotalPaise) status = "PAID";
    else status = "PARTIAL";
  }

  await tx.invoice.update({
    where: { id: invoiceId },
    data: { amountPaidPaise, status },
  });
}
