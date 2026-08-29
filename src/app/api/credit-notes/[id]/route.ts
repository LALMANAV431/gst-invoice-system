import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { estimateCostRate, recordStockMovement } from "@/server/stock";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const note = await db.creditNote.findFirst({
    where: { id: params.id, companyId: ctx.company.id },
    include: { party: true, items: true },
  });
  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(note);
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const note = await db.creditNote.findFirst({
    where: { id: params.id, companyId: ctx.company.id },
    include: { items: true },
  });
  if (!note) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.$transaction(async (tx) => {
    // Reverse the stock effect applied at creation
    const reverseType = note.kind === "CREDIT" ? "OUT" : "IN";
    for (const it of note.items) {
      if (it.itemId) {
        const ratePaise =
          reverseType === "IN"
            ? await estimateCostRate(tx, ctx.company!.id, it.itemId)
            : undefined;
        await recordStockMovement(tx, {
          companyId: ctx.company!.id,
          itemId: it.itemId,
          direction: reverseType,
          quantity: it.quantity,
          reference: note.number,
          notes: `Reversed: ${note.number}`,
          sourceType: note.kind === "CREDIT" ? "SALE" : "PURCHASE",
          sourceId: note.id,
          ratePaise,
        });
      }
    }
    await tx.creditNote.delete({ where: { id: note.id } });
  });
  return NextResponse.json({ ok: true });
}
