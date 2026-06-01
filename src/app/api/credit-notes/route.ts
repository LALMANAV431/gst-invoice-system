import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { calcLineGST } from "@/lib/utils";
import { nextCreditNoteNumber } from "@/lib/numbering";

export async function GET(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const kind = searchParams.get("kind");
  const where: any = { companyId: ctx.company.id };
  if (kind) where.kind = kind;
  const notes = await db.creditNote.findMany({
    where,
    include: { party: true },
    orderBy: { date: "desc" },
  });
  return NextResponse.json(notes);
}

export async function POST(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const company = ctx.company;
  const body = await req.json();
  const { partyId, kind, date, reason, originalRef, notes, items, discount, roundOff } = body;

  const noteKind = kind === "DEBIT" ? "DEBIT" : "CREDIT";
  if (!partyId) return NextResponse.json({ error: "Party required" }, { status: 400 });
  if (!Array.isArray(items) || items.length === 0)
    return NextResponse.json({ error: "Add at least one item" }, { status: 400 });

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

  const noteDiscount = parseFloat(discount) || 0;
  const noteRoundOff = parseFloat(roundOff) || 0;
  const taxTotal = +(cgstTotal + sgstTotal + igstTotal).toFixed(2);
  const grandTotal = +(subTotal + taxTotal - noteDiscount + noteRoundOff).toFixed(2);
  const prefix = noteKind === "DEBIT" ? company.debitNotePrefix : company.creditNotePrefix;
  const number = await nextCreditNoteNumber(company.id, prefix, noteKind);

  const note = await db.$transaction(async (tx) => {
    const created = await tx.creditNote.create({
      data: {
        companyId: company.id,
        partyId,
        number,
        kind: noteKind,
        date: date ? new Date(date) : new Date(),
        reason: reason || null,
        originalRef: originalRef || null,
        notes: notes || null,
        subTotal: +subTotal.toFixed(2),
        cgstTotal: +cgstTotal.toFixed(2),
        sgstTotal: +sgstTotal.toFixed(2),
        igstTotal: +igstTotal.toFixed(2),
        taxTotal,
        discount: noteDiscount,
        roundOff: noteRoundOff,
        grandTotal,
        isInterState,
        items: { create: computed },
      },
    });

    // Stock effects:
    // CREDIT (sales return) -> goods come back IN
    // DEBIT (purchase return) -> goods go OUT
    const movementType = noteKind === "CREDIT" ? "IN" : "OUT";
    for (const it of computed) {
      if (it.itemId) {
        await tx.item.update({
          where: { id: it.itemId },
          data: {
            currentStock:
              movementType === "IN" ? { increment: it.quantity } : { decrement: it.quantity },
          },
        });
        await tx.stockMovement.create({
          data: {
            companyId: company.id,
            itemId: it.itemId,
            type: movementType,
            quantity: it.quantity,
            reference: number,
            notes: `${noteKind === "CREDIT" ? "Sales return" : "Purchase return"}: ${number}`,
          },
        });
      }
    }
    return created;
  });

  return NextResponse.json(note);
}
