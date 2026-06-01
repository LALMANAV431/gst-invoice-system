import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { nextInvoiceNumber } from "@/lib/numbering";

export async function POST(_: Request, { params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const company = ctx.company;

  const quotation = await db.quotation.findFirst({
    where: { id: params.id, companyId: company.id },
    include: { items: true },
  });
  if (!quotation) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (quotation.status === "CONVERTED" || quotation.convertedInvoiceId) {
    return NextResponse.json({ error: "Already converted" }, { status: 400 });
  }

  const number = await nextInvoiceNumber(company.id, company.invoicePrefix);

  const invoice = await db.$transaction(async (tx) => {
    const created = await tx.invoice.create({
      data: {
        companyId: company.id,
        partyId: quotation.partyId,
        number,
        date: new Date(),
        notes: quotation.notes,
        subTotal: quotation.subTotal,
        cgstTotal: quotation.cgstTotal,
        sgstTotal: quotation.sgstTotal,
        igstTotal: quotation.igstTotal,
        taxTotal: quotation.taxTotal,
        discount: quotation.discount,
        roundOff: quotation.roundOff,
        grandTotal: quotation.grandTotal,
        isInterState: quotation.isInterState,
        status: "UNPAID",
        items: {
          create: quotation.items.map((it) => ({
            itemId: it.itemId,
            itemName: it.itemName,
            hsn: it.hsn,
            quantity: it.quantity,
            unit: it.unit,
            rate: it.rate,
            discount: it.discount,
            taxableAmount: it.taxableAmount,
            gstRate: it.gstRate,
            cgst: it.cgst,
            sgst: it.sgst,
            igst: it.igst,
            total: it.total,
          })),
        },
      },
    });

    for (const it of quotation.items) {
      if (it.itemId) {
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
            notes: `Sale (from ${quotation.number}): ${number}`,
          },
        });
      }
    }

    await tx.quotation.update({
      where: { id: quotation.id },
      data: { status: "CONVERTED", convertedInvoiceId: created.id },
    });

    return created;
  });

  return NextResponse.json(invoice);
}
