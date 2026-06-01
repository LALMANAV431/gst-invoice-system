import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { nextPaymentNumber } from "@/lib/numbering";
import { writeGuard } from "@/lib/guard";
import { logAudit } from "@/lib/audit";

export async function GET() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const payments = await db.payment.findMany({
    where: { companyId: ctx.company.id },
    include: { party: true, invoice: true, purchase: true },
    orderBy: { date: "desc" },
  });
  return NextResponse.json(payments);
}

export async function POST(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;
  const company = ctx.company;
  const body = await req.json();
  const { partyId, invoiceId, purchaseId, type, mode, amount, date, reference, notes } = body;
  if (!partyId || !type || !amount)
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });

  const number = await nextPaymentNumber(company.id, company.paymentPrefix);
  const amt = parseFloat(amount);

  const payment = await db.$transaction(async (tx) => {
    const created = await tx.payment.create({
      data: {
        companyId: company.id,
        partyId,
        invoiceId: invoiceId || null,
        purchaseId: purchaseId || null,
        number,
        type,
        mode: mode || "CASH",
        amount: amt,
        date: date ? new Date(date) : new Date(),
        reference: reference || null,
        notes: notes || null,
      },
    });

    if (invoiceId) {
      const inv = await tx.invoice.findUnique({ where: { id: invoiceId } });
      if (inv) {
        const newPaid = +(inv.amountPaid + amt).toFixed(2);
        const status =
          newPaid >= inv.grandTotal - 0.01 ? "PAID" : newPaid > 0 ? "PARTIAL" : "UNPAID";
        await tx.invoice.update({
          where: { id: invoiceId },
          data: { amountPaid: newPaid, status },
        });
      }
    }
    if (purchaseId) {
      const pur = await tx.purchase.findUnique({ where: { id: purchaseId } });
      if (pur) {
        const newPaid = +(pur.amountPaid + amt).toFixed(2);
        const status =
          newPaid >= pur.grandTotal - 0.01 ? "PAID" : newPaid > 0 ? "PARTIAL" : "UNPAID";
        await tx.purchase.update({
          where: { id: purchaseId },
          data: { amountPaid: newPaid, status },
        });
      }
    }
    return created;
  });
  await logAudit({
    companyId: company.id,
    userId: ctx.user.id,
    action: "CREATE",
    entity: "Payment",
    entityId: payment.id,
    changes: { number: payment.number, amount: payment.amount, type: payment.type },
  });
  return NextResponse.json(payment);
}
