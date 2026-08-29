import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { writeGuard } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { deletePostingsFor } from "@/server/ledger";
import { refreshInvoiceStatus } from "@/server/services/invoice.service";
import { assertPeriodOpen, PeriodLockedError } from "@/server/numbering";

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;

  const companyId = ctx.company.id;
  const payment = await db.payment.findFirst({
    where: { id: params.id, companyId },
  });
  if (!payment) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    await assertPeriodOpen(db, companyId, payment.date);

    await db.$transaction(async (tx) => {
      // Delete first, then recompute the parent document's paid amount from
      // what remains. Deriving the total avoids the drift an incremented
      // counter accumulates when payments are edited or removed.
      await tx.payment.delete({ where: { id: payment.id } });

      if (payment.invoiceId) {
        await refreshInvoiceStatus(tx, payment.invoiceId);
      }

      if (payment.purchaseId) {
        const paid = await tx.payment.aggregate({
          where: { purchaseId: payment.purchaseId },
          _sum: { amountPaise: true },
        });
        const purchase = await tx.purchase.findUnique({
          where: { id: payment.purchaseId },
          select: { grandTotalPaise: true },
        });
        const amountPaidPaise = paid._sum.amountPaise ?? 0;
        const status =
          purchase && amountPaidPaise >= purchase.grandTotalPaise
            ? "PAID"
            : amountPaidPaise > 0
              ? "PARTIAL"
              : "UNPAID";
        await tx.purchase.update({
          where: { id: payment.purchaseId },
          data: { amountPaidPaise, status },
        });
      }

      // Remove the ledger effect, or the books would keep the receipt.
      await deletePostingsFor(tx, companyId, "Payment", payment.id);
    });

    await logAudit({
      companyId,
      userId: ctx.user.id,
      action: "DELETE",
      entity: "Payment",
      entityId: payment.id,
      changes: { number: payment.number, amountPaise: payment.amountPaise },
    });

    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof PeriodLockedError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    console.error("[payments] delete failed:", e);
    return NextResponse.json({ error: "Could not delete the payment" }, { status: 500 });
  }
}
