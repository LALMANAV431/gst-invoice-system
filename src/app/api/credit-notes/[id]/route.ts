import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";

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
        await tx.item.update({
          where: { id: it.itemId },
          data: {
            currentStock:
              reverseType === "IN" ? { increment: it.quantity } : { decrement: it.quantity },
          },
        });
        await tx.stockMovement.create({
          data: {
            companyId: ctx.company!.id,
            itemId: it.itemId,
            type: reverseType,
            quantity: it.quantity,
            reference: note.number,
            notes: `Reversed: ${note.number}`,
          },
        });
      }
    }
    await tx.creditNote.delete({ where: { id: note.id } });
  });
  return NextResponse.json({ ok: true });
}
