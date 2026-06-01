import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payment = await db.payment.findFirst({
    where: { id: params.id, companyId: ctx.company.id },
  });
  if (!payment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  await db.$transaction(async (tx) => {
    if (payment.invoiceId) {
      const inv = await tx.invoice.findUnique({ where: { id: payment.invoiceId } });
      if (inv) {
        const newPaid = Math.max(0, +(inv.amountPaid - payment.amount).toFixed(2));
        const status =
          newPaid >= inv.grandTotal - 0.01 ? "PAID" : newPaid > 0 ? "PARTIAL" : "UNPAID";
        await tx.invoice.update({
          where: { id: inv.id },
          data: { amountPaid: newPaid, status },
        });
      }
    }
    if (payment.purchaseId) {
      const pur = await tx.purchase.findUnique({ where: { id: payment.purchaseId } });
      if (pur) {
        const newPaid = Math.max(0, +(pur.amountPaid - payment.amount).toFixed(2));
        const status =
          newPaid >= pur.grandTotal - 0.01 ? "PAID" : newPaid > 0 ? "PARTIAL" : "UNPAID";
        await tx.purchase.update({
          where: { id: pur.id },
          data: { amountPaid: newPaid, status },
        });
      }
    }
    await tx.payment.delete({ where: { id: payment.id } });
  });
  return NextResponse.json({ ok: true });
}
