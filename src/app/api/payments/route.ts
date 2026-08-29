import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { writeGuard } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { toPaise } from "@/lib/money";
import { allocateDocumentNumber, assertPeriodOpen, PeriodLockedError } from "@/server/numbering";
import {
  ensureChartOfAccounts,
  ensurePartyLedger,
  postJournalEntry,
} from "@/server/ledger";
import { buildPaymentPosting, ledgerForPaymentMode } from "@/lib/accounting";
import { refreshInvoiceStatus } from "@/server/services/invoice.service";
import { parsePagination, paginated } from "@/lib/pagination";

const createSchema = z.object({
  partyId: z.string().min(1, "Party is required"),
  invoiceId: z.string().nullish(),
  purchaseId: z.string().nullish(),
  type: z.enum(["RECEIVED", "PAID"]),
  mode: z.string().optional(),
  amount: z.union([z.string(), z.number()]),
  date: z.coerce.date().optional(),
  reference: z.string().nullish(),
  notes: z.string().nullish(),
});

export async function GET(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { skip, take, page, pageSize } = parsePagination(req);
  const where = { companyId: ctx.company.id };

  const [rows, total] = await Promise.all([
    db.payment.findMany({
      where,
      include: {
        party: { select: { id: true, name: true } },
        invoice: { select: { id: true, number: true, grandTotalPaise: true } },
        purchase: { select: { id: true, number: true, grandTotalPaise: true } },
      },
      orderBy: { date: "desc" },
      skip,
      take,
    }),
    db.payment.count({ where }),
  ]);

  return NextResponse.json(paginated(rows, total, page, pageSize));
}

export async function POST(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;

  const company = ctx.company;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }
  const input = parsed.data;
  const date = input.date ?? new Date();
  const amountPaise = toPaise(input.amount);

  if (amountPaise <= 0) {
    return NextResponse.json({ error: "Enter an amount greater than zero" }, { status: 400 });
  }

  const party = await db.party.findFirst({
    where: { id: input.partyId, companyId: company.id },
    select: { id: true, name: true, type: true, balanceType: true },
  });
  if (!party) return NextResponse.json({ error: "Invalid party" }, { status: 400 });

  // Verify any linked document belongs to this tenant before touching it.
  if (input.invoiceId) {
    const owned = await db.invoice.findFirst({
      where: { id: input.invoiceId, companyId: company.id },
      select: { id: true },
    });
    if (!owned) return NextResponse.json({ error: "Invalid invoice" }, { status: 400 });
  }
  if (input.purchaseId) {
    const owned = await db.purchase.findFirst({
      where: { id: input.purchaseId, companyId: company.id },
      select: { id: true },
    });
    if (!owned) return NextResponse.json({ error: "Invalid purchase" }, { status: 400 });
  }

  try {
    await assertPeriodOpen(db, company.id, date);

    const payment = await db.$transaction(async (tx) => {
      const { number } = await allocateDocumentNumber(tx, {
        companyId: company.id,
        documentType: "PAYMENT",
        prefix: company.paymentPrefix,
        date,
      });

      const created = await tx.payment.create({
        data: {
          companyId: company.id,
          partyId: party.id,
          invoiceId: input.invoiceId || null,
          purchaseId: input.purchaseId || null,
          number,
          type: input.type,
          mode: input.mode || "CASH",
          amountPaise,
          date,
          reference: input.reference ?? null,
          notes: input.notes ?? null,
        },
      });

      // Recompute from the payments table rather than incrementing a counter.
      // An incremented total drifts when a payment is edited or deleted; a
      // derived one cannot.
      if (input.invoiceId) {
        await refreshInvoiceStatus(tx, input.invoiceId);
      }
      if (input.purchaseId) {
        const paid = await tx.payment.aggregate({
          where: { purchaseId: input.purchaseId },
          _sum: { amountPaise: true },
        });
        const purchase = await tx.purchase.findUnique({
          where: { id: input.purchaseId },
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
          where: { id: input.purchaseId },
          data: { amountPaidPaise, status },
        });
      }

      await ensureChartOfAccounts(tx, company.id);
      const partyLedger = await ensurePartyLedger(tx, company.id, party);

      const posting = buildPaymentPosting({
        partyLedger: partyLedger.name,
        cashOrBankLedger: ledgerForPaymentMode(input.mode || "CASH"),
        date,
        number,
        paymentId: created.id,
        amountPaise,
        type: input.type,
      });

      await postJournalEntry(tx, {
        companyId: company.id,
        userId: ctx.user.id,
        posting,
        voucherNo: number,
        journalPrefix: company.journalPrefix,
      });

      return created;
    });

    await logAudit({
      companyId: company.id,
      userId: ctx.user.id,
      action: "CREATE",
      entity: "Payment",
      entityId: payment.id,
      changes: {
        number: payment.number,
        amountPaise: payment.amountPaise,
        type: payment.type,
      },
    });

    return NextResponse.json(payment);
  } catch (e) {
    if (e instanceof PeriodLockedError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    console.error("[payments] create failed:", e);
    return NextResponse.json({ error: "Could not record the payment" }, { status: 500 });
  }
}
