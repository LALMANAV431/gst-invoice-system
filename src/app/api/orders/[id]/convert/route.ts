import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { writeGuard } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { allocateDocumentNumber, assertPeriodOpen, PeriodLockedError } from "@/server/numbering";
import {
  ensureChartOfAccounts,
  ensurePartyLedger,
  postJournalEntry,
} from "@/server/ledger";
import {
  buildInvoicePosting,
  buildPurchasePosting,
  salesLedgerForSupplyType,
} from "@/lib/accounting";
import { DOC_CONFIG, type OrderDocType } from "@/server/services/order.service";

/**
 * Convert an order document into an invoice or a purchase.
 *
 * This is where the ledger entry finally happens: orders and challans are not
 * financial events, but the invoice or purchase they become is.
 *
 * STOCK IS NOT MOVED AGAIN.
 * A delivery challan or GRN already moved the stock when it was created. Moving
 * it again on conversion would double-count, so the resulting invoice/purchase is
 * created WITHOUT stock movements when the source already moved them. A sales
 * order or purchase order moved nothing, so its conversion does move stock.
 */
export async function POST(_: Request, { params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;

  const company = ctx.company;

  const doc = await db.orderDocument.findFirst({
    where: { id: params.id, companyId: company.id },
    include: { items: true, party: true },
  });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const config = DOC_CONFIG[doc.docType as OrderDocType];
  if (!config) {
    return NextResponse.json({ error: "Unknown document type" }, { status: 400 });
  }
  if (doc.status === "CANCELLED") {
    return NextResponse.json({ error: "This document is cancelled" }, { status: 400 });
  }
  if (doc.convertedToId) {
    return NextResponse.json(
      { error: "This document has already been converted" },
      { status: 400 }
    );
  }

  const date = new Date();
  // Stock already moved when a challan or GRN was raised.
  const stockAlreadyMoved = config.stockEffect !== "NONE";

  try {
    await assertPeriodOpen(db, company.id, date);

    const result = await db.$transaction(async (tx) => {
      await ensureChartOfAccounts(tx, company.id);
      const partyLedger = await ensurePartyLedger(tx, company.id, doc.party);

      // Totals are carried across verbatim. The party agreed these figures on the
      // order, so recomputing could silently change the amount.
      const sharedTotals = {
        subTotalPaise: doc.subTotalPaise,
        cgstTotalPaise: doc.cgstTotalPaise,
        sgstTotalPaise: doc.sgstTotalPaise,
        igstTotalPaise: doc.igstTotalPaise,
        cessTotalPaise: doc.cessTotalPaise,
        taxTotalPaise: doc.taxTotalPaise,
        discountPaise: doc.discountPaise,
        additionalChargesPaise: doc.additionalChargesPaise,
        roundOffPaise: doc.roundOffPaise,
        grandTotalPaise: doc.grandTotalPaise,
        isInterState: doc.isInterState,
        reverseCharge: doc.reverseCharge,
        placeOfSupply: doc.placeOfSupply,
      };

      const lineData = doc.items.map((it) => ({
        itemId: it.itemId,
        itemName: it.itemName,
        hsn: it.hsn,
        quantity: it.quantity,
        unit: it.unit,
        ratePaise: it.ratePaise,
        discountPaise: it.discountPaise,
        apportionedDiscountPaise: it.apportionedDiscountPaise,
        taxablePaise: it.taxablePaise,
        gstRate: it.gstRate,
        cessRate: it.cessRate,
        cessPerUnitPaise: it.cessPerUnitPaise,
        cgstPaise: it.cgstPaise,
        sgstPaise: it.sgstPaise,
        igstPaise: it.igstPaise,
        cessPaise: it.cessPaise,
        totalPaise: it.totalPaise,
        supplyType: it.supplyType,
        pricingMode: it.pricingMode,
      }));

      if (config.convertsTo === "INVOICE") {
        const { number } = await allocateDocumentNumber(tx, {
          companyId: company.id,
          documentType: "INVOICE",
          prefix: company.invoicePrefix,
          date,
        });

        const invoice = await tx.invoice.create({
          data: {
            companyId: company.id,
            partyId: doc.partyId,
            number,
            date,
            notes: doc.notes,
            status: "UNPAID",
            tdsRate: 0,
            tdsPaise: 0,
            ...sharedTotals,
            items: { create: lineData },
          },
        });

        if (!stockAlreadyMoved) {
          for (const it of doc.items) {
            if (!it.itemId) continue;
            await tx.item.update({
              where: { id: it.itemId },
              data: { currentStock: { decrement: it.quantity } },
            });
            await tx.stockMovement.create({
              data: {
                companyId: company.id,
                itemId: it.itemId,
                type: "OUT",
                quantity: it.quantity,
                reference: number,
                notes: `Sale (from ${doc.number}): ${number}`,
                date,
              },
            });
          }
        }

        const taxableByLedger: Record<string, number> = {};
        for (const it of doc.items) {
          const ledger = salesLedgerForSupplyType(it.supplyType);
          taxableByLedger[ledger] = (taxableByLedger[ledger] ?? 0) + it.taxablePaise;
        }

        await postJournalEntry(tx, {
          companyId: company.id,
          userId: ctx.user.id,
          posting: buildInvoicePosting({
            partyLedger: partyLedger.name,
            date,
            number,
            invoiceId: invoice.id,
            taxableByLedger,
            cgstPaise: doc.cgstTotalPaise,
            sgstPaise: doc.sgstTotalPaise,
            igstPaise: doc.igstTotalPaise,
            cessPaise: doc.cessTotalPaise,
            additionalChargesPaise: doc.additionalChargesPaise,
            roundOffPaise: doc.roundOffPaise,
            grandTotalPaise: doc.grandTotalPaise,
            tdsPaise: 0,
            reverseCharge: doc.reverseCharge,
          }),
          voucherNo: number,
          journalPrefix: company.journalPrefix,
        });

        await tx.orderDocument.update({
          where: { id: doc.id },
          data: { convertedToId: invoice.id, convertedAt: date, status: "COMPLETED" },
        });

        return { kind: "invoice" as const, id: invoice.id, number };
      }

      // --- PURCHASE_ORDER / GRN -> Purchase ---------------------------------
      const { number } = await allocateDocumentNumber(tx, {
        companyId: company.id,
        documentType: "PURCHASE",
        prefix: company.purchasePrefix,
        date,
      });

      const purchase = await tx.purchase.create({
        data: {
          companyId: company.id,
          partyId: doc.partyId,
          number,
          // The supplier's own document reference, if it was captured.
          vendorBillNo: doc.externalRef,
          date,
          notes: doc.notes,
          status: "UNPAID",
          itcEligible: true,
          ...sharedTotals,
          items: { create: lineData },
        },
      });

      if (!stockAlreadyMoved) {
        for (const it of doc.items) {
          if (!it.itemId) continue;
          await tx.item.update({
            where: { id: it.itemId },
            data: { currentStock: { increment: it.quantity } },
          });
          await tx.stockMovement.create({
            data: {
              companyId: company.id,
              itemId: it.itemId,
              type: "IN",
              quantity: it.quantity,
              reference: number,
              notes: `Purchase (from ${doc.number}): ${number}`,
              date,
            },
          });
        }
      }

      await postJournalEntry(tx, {
        companyId: company.id,
        userId: ctx.user.id,
        posting: buildPurchasePosting({
          partyLedger: partyLedger.name,
          date,
          number,
          purchaseId: purchase.id,
          taxablePaise: doc.subTotalPaise,
          cgstPaise: doc.cgstTotalPaise,
          sgstPaise: doc.sgstTotalPaise,
          igstPaise: doc.igstTotalPaise,
          cessPaise: doc.cessTotalPaise,
          additionalChargesPaise: doc.additionalChargesPaise,
          roundOffPaise: doc.roundOffPaise,
          grandTotalPaise: doc.grandTotalPaise,
          itcEligible: true,
        }),
        voucherNo: number,
        journalPrefix: company.journalPrefix,
      });

      await tx.orderDocument.update({
        where: { id: doc.id },
        data: { convertedToId: purchase.id, convertedAt: date, status: "COMPLETED" },
      });

      return { kind: "purchase" as const, id: purchase.id, number };
    });

    await logAudit({
      companyId: company.id,
      userId: ctx.user.id,
      action: "CREATE",
      entity: result.kind === "invoice" ? "Invoice" : "Purchase",
      entityId: result.id,
      changes: { number: result.number, convertedFrom: doc.number, docType: doc.docType },
    });

    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof PeriodLockedError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    console.error("[orders/convert] failed:", e);
    return NextResponse.json({ error: "Could not convert the document" }, { status: 500 });
  }
}
