import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { recordStockMovement } from "@/server/stock";
import { writeGuard } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { allocateDocumentNumber, assertPeriodOpen, PeriodLockedError } from "@/server/numbering";
import {
  ensureChartOfAccounts,
  ensurePartyLedger,
  postJournalEntry,
} from "@/server/ledger";
import { buildInvoicePosting, salesLedgerForSupplyType } from "@/lib/accounting";

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;

  const company = ctx.company;

  const quotation = await db.quotation.findFirst({
    where: { id: params.id, companyId: company.id },
    include: { items: true, party: true },
  });
  if (!quotation) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (quotation.status === "CONVERTED" || quotation.convertedInvoiceId) {
    return NextResponse.json({ error: "Already converted" }, { status: 400 });
  }

  const date = new Date();

  try {
    await assertPeriodOpen(db, company.id, date);

    const invoice = await db.$transaction(async (tx) => {
      const { number } = await allocateDocumentNumber(tx, {
        companyId: company.id,
        documentType: "INVOICE",
        prefix: company.invoicePrefix,
        date,
      });

      // Totals are copied verbatim: the customer accepted these figures, so
      // recomputing them here could change the amount they agreed to.
      const created = await tx.invoice.create({
        data: {
          companyId: company.id,
          partyId: quotation.partyId,
          number,
          date,
          notes: quotation.notes,
          subTotalPaise: quotation.subTotalPaise,
          cgstTotalPaise: quotation.cgstTotalPaise,
          sgstTotalPaise: quotation.sgstTotalPaise,
          igstTotalPaise: quotation.igstTotalPaise,
          cessTotalPaise: quotation.cessTotalPaise,
          taxTotalPaise: quotation.taxTotalPaise,
          discountPaise: quotation.discountPaise,
          additionalChargesPaise: quotation.additionalChargesPaise,
          roundOffPaise: quotation.roundOffPaise,
          grandTotalPaise: quotation.grandTotalPaise,
          isInterState: quotation.isInterState,
          reverseCharge: quotation.reverseCharge,
          placeOfSupply: quotation.placeOfSupply,
          status: "UNPAID",
          items: {
            create: quotation.items.map((it) => ({
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
            })),
          },
        },
      });

      for (const it of quotation.items) {
        if (!it.itemId) continue;
        await recordStockMovement(tx, {
          companyId: company.id,
          itemId: it.itemId,
          direction: "OUT",
          quantity: it.quantity,
          date,
          reference: number,
          notes: `Sale (from ${quotation.number}): ${number}`,
          sourceType: "SALE",
          sourceId: created.id,
        });
      }

      await ensureChartOfAccounts(tx, company.id);
      const partyLedger = await ensurePartyLedger(tx, company.id, quotation.party);

      const taxableByLedger: Record<string, number> = {};
      for (const it of quotation.items) {
        const ledger = salesLedgerForSupplyType(it.supplyType);
        taxableByLedger[ledger] = (taxableByLedger[ledger] ?? 0) + it.taxablePaise;
      }

      const posting = buildInvoicePosting({
        partyLedger: partyLedger.name,
        date,
        number,
        invoiceId: created.id,
        taxableByLedger,
        cgstPaise: quotation.cgstTotalPaise,
        sgstPaise: quotation.sgstTotalPaise,
        igstPaise: quotation.igstTotalPaise,
        cessPaise: quotation.cessTotalPaise,
        additionalChargesPaise: quotation.additionalChargesPaise,
        roundOffPaise: quotation.roundOffPaise,
        grandTotalPaise: quotation.grandTotalPaise,
        tdsPaise: 0,
        reverseCharge: quotation.reverseCharge,
      });

      await postJournalEntry(tx, {
        companyId: company.id,
        userId: ctx.user.id,
        posting,
        voucherNo: number,
        journalPrefix: company.journalPrefix,
      });

      await tx.quotation.update({
        where: { id: quotation.id },
        data: { status: "CONVERTED", convertedInvoiceId: created.id },
      });

      return created;
    });

    await logAudit({
      companyId: company.id,
      userId: ctx.user.id,
      action: "CREATE",
      entity: "Invoice",
      entityId: invoice.id,
      changes: { number: invoice.number, convertedFrom: quotation.number },
    });

    return NextResponse.json(invoice);
  } catch (e) {
    if (e instanceof PeriodLockedError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    console.error("[quotations/convert] failed:", e);
    return NextResponse.json({ error: "Could not convert the quotation" }, { status: 500 });
  }
}
