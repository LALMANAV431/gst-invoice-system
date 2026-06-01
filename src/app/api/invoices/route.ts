import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { calcLineGST } from "@/lib/utils";
import { nextInvoiceNumber } from "@/lib/numbering";

export async function GET() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const invoices = await db.invoice.findMany({
    where: { companyId: ctx.company.id },
    include: { party: true },
    orderBy: { date: "desc" },
  });
  return NextResponse.json(invoices);
}

export async function POST(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const company = ctx.company;
  const body = await req.json();
  const { partyId, date, dueDate, notes, items, discount, roundOff } = body;

  if (!partyId) return NextResponse.json({ error: "Party required" }, { status: 400 });
  if (!Array.isArray(items) || items.length === 0)
    return NextResponse.json({ error: "Add at least one item" }, { status: 400 });

  const party = await db.party.findFirst({ where: { id: partyId, companyId: company.id } });
  if (!party) return NextResponse.json({ error: "Invalid party" }, { status: 400 });

  // Determine inter-state by comparing state codes
  const isInterState = !!(
    company.stateCode &&
    party.stateCode &&
    company.stateCode !== party.stateCode
  );

  let subTotal = 0;
  let cgstTotal = 0;
  let sgstTotal = 0;
  let igstTotal = 0;
  const computedItems = items.map((it: any) => {
    const quantity = parseFloat(it.quantity) || 0;
    const rate = parseFloat(it.rate) || 0;
    const itemDiscount = parseFloat(it.discount) || 0;
    const gstRate = parseFloat(it.gstRate) || 0;
    const r = calcLineGST({ quantity, rate, discount: itemDiscount, gstRate, isInterState });
    subTotal += r.taxableAmount;
    cgstTotal += r.cgst;
    sgstTotal += r.sgst;
    igstTotal += r.igst;
    return {
      itemId: it.itemId || null,
      itemName: it.itemName,
      hsn: it.hsn || null,
      quantity,
      unit: it.unit || "NOS",
      rate,
      discount: itemDiscount,
      taxableAmount: r.taxableAmount,
      gstRate,
      cgst: r.cgst,
      sgst: r.sgst,
      igst: r.igst,
      total: r.total,
    };
  });

  const invDiscount = parseFloat(discount) || 0;
  const invRoundOff = parseFloat(roundOff) || 0;
  const taxTotal = +(cgstTotal + sgstTotal + igstTotal).toFixed(2);
  const grandTotal = +(subTotal + taxTotal - invDiscount + invRoundOff).toFixed(2);

  const number = await nextInvoiceNumber(company.id, company.invoicePrefix);

  const invoice = await db.$transaction(async (tx) => {
    const created = await tx.invoice.create({
      data: {
        companyId: company.id,
        partyId,
        number,
        date: date ? new Date(date) : new Date(),
        dueDate: dueDate ? new Date(dueDate) : null,
        notes: notes || null,
        subTotal: +subTotal.toFixed(2),
        cgstTotal: +cgstTotal.toFixed(2),
        sgstTotal: +sgstTotal.toFixed(2),
        igstTotal: +igstTotal.toFixed(2),
        taxTotal,
        discount: invDiscount,
        roundOff: invRoundOff,
        grandTotal,
        isInterState,
        status: "UNPAID",
        items: { create: computedItems },
      },
    });

    // Stock OUT for items linked to inventory
    for (const it of computedItems) {
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
            notes: `Sale: ${number}`,
          },
        });
      }
    }
    return created;
  });

  return NextResponse.json(invoice);
}
