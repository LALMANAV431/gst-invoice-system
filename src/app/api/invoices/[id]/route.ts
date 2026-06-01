import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { writeGuard } from "@/lib/guard";
import { logAudit } from "@/lib/audit";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const invoice = await db.invoice.findFirst({
    where: { id: params.id, companyId: ctx.company.id },
    include: { party: true, items: true, payments: true },
  });
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(invoice);
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;

  const invoice = await db.invoice.findFirst({
    where: { id: params.id, companyId: ctx.company.id },
    include: { items: true },
  });
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.$transaction(async (tx) => {
    // Reverse stock movements
    for (const it of invoice.items) {
      if (it.itemId) {
        await tx.item.update({
          where: { id: it.itemId },
          data: { currentStock: { increment: it.quantity } },
        });
        await tx.stockMovement.create({
          data: {
            companyId: ctx.company!.id,
            itemId: it.itemId,
            type: "IN",
            quantity: it.quantity,
            reference: invoice.number,
            notes: `Reversed: ${invoice.number}`,
          },
        });
      }
    }
    await tx.payment.deleteMany({ where: { invoiceId: invoice.id } });
    await tx.invoice.delete({ where: { id: invoice.id } });
  });
  await logAudit({
    companyId: ctx.company.id,
    userId: ctx.user.id,
    action: "DELETE",
    entity: "Invoice",
    entityId: invoice.id,
    changes: { number: invoice.number },
  });
  return NextResponse.json({ ok: true });
}
