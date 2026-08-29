import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { writeGuard } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { addPaise, percentOf, toPaise } from "@/lib/money";
import { allocateDocumentNumber, assertPeriodOpen, PeriodLockedError } from "@/server/numbering";
import {
  ensureChartOfAccounts,
  ensureLedger,
  postJournalEntry,
} from "@/server/ledger";
import { buildExpensePosting, ledgerForPaymentMode } from "@/lib/accounting";
import { parsePagination, paginated } from "@/lib/pagination";

const createSchema = z.object({
  category: z.string().optional(),
  paymentMode: z.string().optional(),
  amount: z.union([z.string(), z.number()]),
  gstRate: z.coerce.number().min(0).max(100).optional(),
  date: z.coerce.date().optional(),
  reference: z.string().nullish(),
  notes: z.string().nullish(),
  partyId: z.string().nullish(),
  itcEligible: z.coerce.boolean().optional(),
  isInterState: z.coerce.boolean().optional(),
});

export async function GET(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { skip, take, page, pageSize } = parsePagination(req);
  const where = { companyId: ctx.company.id };

  const [rows, total] = await Promise.all([
    db.expense.findMany({
      where,
      include: { party: { select: { id: true, name: true } } },
      orderBy: { date: "desc" },
      skip,
      take,
    }),
    db.expense.count({ where }),
  ]);

  return NextResponse.json(paginated(rows, total, page, pageSize));
}

export async function POST(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // This route previously had no write guard.
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

  const gstRate = input.gstRate ?? 0;
  const taxPaise = percentOf(amountPaise, gstRate);
  const totalPaise = addPaise(amountPaise, taxPaise);
  const category = input.category?.trim() || "General";

  if (input.partyId) {
    const owned = await db.party.findFirst({
      where: { id: input.partyId, companyId: company.id },
      select: { id: true },
    });
    if (!owned) return NextResponse.json({ error: "Invalid party" }, { status: 400 });
  }

  try {
    await assertPeriodOpen(db, company.id, date);

    const expense = await db.$transaction(async (tx) => {
      const { number } = await allocateDocumentNumber(tx, {
        companyId: company.id,
        documentType: "EXPENSE",
        prefix: company.expensePrefix,
        date,
      });

      const created = await tx.expense.create({
        data: {
          companyId: company.id,
          partyId: input.partyId || null,
          number,
          category,
          paymentMode: input.paymentMode || "CASH",
          amountPaise,
          gstRate,
          taxPaise,
          totalPaise,
          itcEligible: input.itcEligible ?? false,
          reference: input.reference ?? null,
          notes: input.notes ?? null,
          date,
        },
      });

      await ensureChartOfAccounts(tx, company.id);
      // The user's free-text category becomes an expense ledger, so expense
      // heads appear in the P&L without a separate master-data step.
      const expenseLedger = await ensureLedger(tx, company.id, category, "Indirect Expenses");

      const posting = buildExpensePosting({
        expenseLedger: expenseLedger.name,
        cashOrBankLedger: ledgerForPaymentMode(input.paymentMode || "CASH"),
        date,
        number,
        expenseId: created.id,
        amountPaise,
        taxPaise,
        totalPaise,
        isInterState: input.isInterState ?? false,
        itcEligible: input.itcEligible ?? false,
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
      entity: "Expense",
      entityId: expense.id,
      changes: { number: expense.number, totalPaise: expense.totalPaise, category },
    });

    return NextResponse.json(expense);
  } catch (e) {
    if (e instanceof PeriodLockedError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    console.error("[expenses] create failed:", e);
    return NextResponse.json({ error: "Could not record the expense" }, { status: 500 });
  }
}
