import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const purchase = await db.purchase.findFirst({
    where: { id: params.id, companyId: ctx.company.id },
    include: { party: true, items: true, payments: true },
  });
  if (!purchase) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(purchase);
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const purchase = await db.purchase.findFirst({
    where: { id: params.id, companyId: ctx.company.id },
    include: { items: true },
  });
  if (!purchase) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.$transaction(async (tx) => {
    for (const it of purchase.items) {
      if (it.itemId) {
        await tx.item.update({
          where: { id: it.itemId },
          data: { currentStock: { decrement: it.quantity } },
        });
        await tx.stockMovement.create({
          data: {
            companyId: ctx.company!.id,
            itemId: it.itemId,
            type: "OUT",
            quantity: it.quantity,
            reference: purchase.number,
            notes: `Reversed: ${purchase.number}`,
          },
        });
      }
    }
    await tx.payment.deleteMany({ where: { purchaseId: purchase.id } });
    await tx.purchase.delete({ where: { id: purchase.id } });
  });
  return NextResponse.json({ ok: true });
}
