import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { writeGuard } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { toPaise, toRupees } from "@/lib/money";
import { assertPeriodOpen, PeriodLockedError } from "@/server/numbering";
import {
  ensureChartOfAccounts,
  postJournalEntry,
} from "@/server/ledger";
import { assertBalanced, UnbalancedEntryError, type Posting } from "@/lib/accounting";
import { parsePagination, paginated } from "@/lib/pagination";

/**
 * Manual journal and contra vouchers.
 *
 * Every automatic posting already goes through the same engine; this exposes it
 * to the user for the entries no document covers: depreciation, provisions,
 * corrections, opening balances, and contra (cash <-> bank transfers).
 *
 * CONTRA is not a separate mechanism — it is a journal entry whose both sides are
 * cash-equivalent ledgers. Modelling it as its own voucher type only changes how
 * it is labelled and reported.
 */

const lineSchema = z.object({
  ledgerId: z.string().min(1),
  /** Rupees, as typed. Exactly one of debit/credit must be non-zero. */
  debit: z.union([z.string(), z.number()]).optional(),
  credit: z.union([z.string(), z.number()]).optional(),
  narration: z.string().max(300).nullish(),
});

const createSchema = z.object({
  voucherType: z.enum(["JOURNAL", "CONTRA"]).optional(),
  date: z.coerce.date().optional(),
  narration: z.string().min(1, "Add a narration so the entry is auditable").max(500),
  lines: z.array(lineSchema).min(2, "A journal entry needs at least two lines"),
});

export async function GET(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const voucherType = searchParams.get("voucherType");

  const where: { companyId: string; voucherType?: string } = { companyId: ctx.company.id };
  // Default to the manually-created types; automatic postings are visible via
  // the day book and their source documents.
  if (voucherType) where.voucherType = voucherType;

  const { skip, take, page, pageSize } = parsePagination(req);
  const [rows, total] = await Promise.all([
    db.journalEntry.findMany({
      where,
      include: {
        lines: {
          include: { ledger: { select: { id: true, name: true } } },
        },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      skip,
      take,
    }),
    db.journalEntry.count({ where }),
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
  const voucherType = input.voucherType ?? "JOURNAL";

  // Resolve ledger ids to names, and confirm every one belongs to this tenant.
  // Accepting ids without this check would let a crafted request post into
  // another company's ledger.
  const ledgerIds = [...new Set(input.lines.map((l) => l.ledgerId))];
  const ledgers = await db.ledger.findMany({
    where: { id: { in: ledgerIds }, companyId: company.id },
    select: {
      id: true,
      name: true,
      group: { select: { name: true } },
    },
  });

  if (ledgers.length !== ledgerIds.length) {
    return NextResponse.json(
      { error: "One or more ledgers were not found in your chart of accounts." },
      { status: 400 }
    );
  }
  const byId = new Map(ledgers.map((l) => [l.id, l]));

  // Build the posting in paise.
  const postingLines = input.lines.map((l) => {
    const debitPaise = toPaise(l.debit ?? 0);
    const creditPaise = toPaise(l.credit ?? 0);
    return {
      ledger: byId.get(l.ledgerId)!.name,
      debitPaise: debitPaise > 0 ? debitPaise : undefined,
      creditPaise: creditPaise > 0 ? creditPaise : undefined,
      narration: l.narration ?? undefined,
    };
  });

  // A contra voucher must move money between cash-equivalent accounts only.
  // Without this check "contra" becomes a meaningless label on any entry.
  if (voucherType === "CONTRA") {
    const cashGroups = new Set(["Cash-in-Hand", "Bank Accounts"]);
    const allCash = ledgerIds.every((id) => cashGroups.has(byId.get(id)!.group.name));
    if (!allCash) {
      return NextResponse.json(
        {
          error:
            "A contra voucher may only move money between cash and bank accounts. Use a journal voucher instead.",
        },
        { status: 400 }
      );
    }
  }

  const posting: Posting = {
    voucherType,
    date,
    narration: input.narration,
    lines: postingLines,
  };

  try {
    // Fail before touching the database, with a message that names the gap.
    assertBalanced(posting);
    await assertPeriodOpen(db, company.id, date);

    const entry = await db.$transaction(async (tx) => {
      await ensureChartOfAccounts(tx, company.id);
      const { id, voucherNo } = await postJournalEntry(tx, {
        companyId: company.id,
        userId: ctx.user.id,
        posting,
        journalPrefix: company.journalPrefix,
      });
      return { id, voucherNo };
    });

    await logAudit({
      companyId: company.id,
      userId: ctx.user.id,
      action: "CREATE",
      entity: "JournalEntry",
      entityId: entry.id,
      changes: { voucherNo: entry.voucherNo, voucherType, lines: postingLines.length },
    });

    return NextResponse.json({ id: entry.id, voucherNo: entry.voucherNo, voucherType });
  } catch (e) {
    if (e instanceof UnbalancedEntryError) {
      // The most common user error, so the message states the actual difference
      // in rupees rather than saying "unbalanced".
      const difference = Math.abs(e.debit - e.credit);
      return NextResponse.json(
        {
          error: `Debits and credits must be equal. They differ by Rs ${toRupees(difference).toFixed(2)}.`,
          debit: toRupees(e.debit),
          credit: toRupees(e.credit),
        },
        { status: 400 }
      );
    }
    if (e instanceof PeriodLockedError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    if (e instanceof Error && /exactly one side|non-integer|negative/.test(e.message)) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    console.error("[journal-entries] create failed:", e);
    return NextResponse.json({ error: "Could not post the voucher" }, { status: 500 });
  }
}
