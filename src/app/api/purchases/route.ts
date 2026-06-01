import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { calcLineGST } from "@/lib/utils";
import { nextPurchaseNumber } from "@/lib/numbering";

export async function GET() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const purchases = await db.purchase.findMany({
    where: { companyId: ctx.company.id },
    include: { party: true },
    orderBy: { date: "desc" },
  });
  return NextResponse.json(purchases);
}

export async function POST(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const company = ctx.company;
  const body = await req.json();
  const { partyId, date, dueDate, vendorBillNo, notes, items, discount, roundOff } = body;
  if (!partyId || !Array.isArray(items) || items.length === 0)
    return NextResponse.json({ error: "Party and items required" }, { status: 400 });

  const party = await db.party.findFirst({ where: { id: partyId, companyId: company.id } });
  if (!party) return NextResponse.json({ error: "Invalid party" }, { status: 400 });

  const isInterState = !!(
    company.stateCode &&
    party.stateCode &&
    company.stateCode !== party.stateCode
  );
  let subTotal = 0,
    cgstTotal = 0,
    sgstTotal = 0,
    igstTotal = 0;
  const computed = items.map((it: any) => {
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
  const number = await nextPurchaseNumber(company.id, company.purchasePrefix);

  const purchase = await db.$transaction(async (tx) => {
    const created = await tx.purchase.create({
      data: {
        companyId: company.id,
        partyId,
        number,
        vendorBillNo: vendorBillNo || null,
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
        items: { create: computed },
      },
    });

    for (const it of computed) {
      if (it.itemId) {
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
            notes: `Purchase: ${number}`,
          },
        });
      }
    }
    return created;
  });

  return NextResponse.json(purchase);
}
