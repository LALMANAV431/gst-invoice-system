/**
 * Ledger service: writes journal entries and reads balances.
 *
 * This is the only place that persists accounting entries. `src/lib/accounting.ts`
 * decides WHAT to post (pure, unit-tested); this module decides HOW it is stored
 * and enforces the balance invariant before anything reaches the database.
 *
 * Always pass the transaction client so the posting is atomic with the document
 * that caused it. A saved invoice with no ledger entry is corrupt data.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import {
  assertBalanced,
  buildBalanceSheet,
  buildProfitAndLoss,
  computeClosing,
  LedgerBalance,
  LedgerNature,
  Posting,
  SYSTEM_GROUPS,
  SYSTEM_LEDGERS,
} from "@/lib/accounting";
import { allocateDocumentNumber } from "./numbering";

type Client = Prisma.TransactionClient | typeof db;

// ---------------------------------------------------------------------------
// Chart of accounts
// ---------------------------------------------------------------------------

/**
 * Create the default chart of accounts for a company, if absent.
 *
 * Idempotent: safe to call on every company creation and from a backfill.
 * Groups are inserted parents-first so `parentId` can be resolved.
 */
export async function ensureChartOfAccounts(client: Client, companyId: string): Promise<void> {
  const existing = await client.ledgerGroup.count({ where: { companyId } });
  if (existing > 0) return;

  const groupIds = new Map<string, string>();

  // Parents before children.
  const ordered = [...SYSTEM_GROUPS].sort((a, b) => {
    if (!a.parent && b.parent) return -1;
    if (a.parent && !b.parent) return 1;
    return a.sortOrder - b.sortOrder;
  });

  for (const g of ordered) {
    const created = await client.ledgerGroup.create({
      data: {
        companyId,
        name: g.name,
        nature: g.nature,
        parentId: g.parent ? groupIds.get(g.parent) ?? null : null,
        isSystem: true,
        sortOrder: g.sortOrder,
      },
    });
    groupIds.set(g.name, created.id);
  }

  for (const l of SYSTEM_LEDGERS) {
    const groupId = groupIds.get(l.group);
    if (!groupId) continue;
    await client.ledger.create({
      data: {
        companyId,
        groupId,
        name: l.name,
        isSystem: true,
        openingIsDebit: l.openingIsDebit,
      },
    });
  }
}

/**
 * Get or create a party's control ledger.
 *
 * A party has exactly one ledger, so its ledger balance and its outstanding
 * figure can never disagree. Customers land under Sundry Debtors, suppliers
 * under Sundry Creditors.
 */
export async function ensurePartyLedger(
  client: Client,
  companyId: string,
  party: { id: string; name: string; type: string; openingBalancePaise?: number; balanceType?: string }
): Promise<{ id: string; name: string }> {
  const existing = await client.ledger.findUnique({ where: { partyId: party.id } });
  if (existing) return { id: existing.id, name: existing.name };

  const groupName = party.type === "VENDOR" ? "Sundry Creditors" : "Sundry Debtors";
  const group = await client.ledgerGroup.findFirst({ where: { companyId, name: groupName } });
  if (!group) {
    throw new Error(
      `Ledger group "${groupName}" is missing for this company. Run ensureChartOfAccounts first.`
    );
  }

  // Ledger names are unique per company, so disambiguate a party whose name
  // collides with an existing ledger.
  let name = party.name;
  if (await client.ledger.findFirst({ where: { companyId, name } })) {
    name = `${party.name} (${party.id.slice(-4)})`;
  }

  const created = await client.ledger.create({
    data: {
      companyId,
      groupId: group.id,
      name,
      partyId: party.id,
      openingBalancePaise: party.openingBalancePaise ?? 0,
      openingIsDebit: (party.balanceType ?? "RECEIVABLE") === "RECEIVABLE",
    },
  });
  return { id: created.id, name: created.name };
}

/**
 * Get or create a named ledger in a group. Used for expense heads, which users
 * create implicitly by typing a category.
 */
export async function ensureLedger(
  client: Client,
  companyId: string,
  name: string,
  groupName: string
): Promise<{ id: string; name: string }> {
  const existing = await client.ledger.findFirst({ where: { companyId, name } });
  if (existing) return { id: existing.id, name: existing.name };

  const group = await client.ledgerGroup.findFirst({ where: { companyId, name: groupName } });
  if (!group) throw new Error(`Ledger group "${groupName}" not found for company ${companyId}`);

  const created = await client.ledger.create({
    data: { companyId, groupId: group.id, name },
  });
  return { id: created.id, name: created.name };
}

// ---------------------------------------------------------------------------
// Posting
// ---------------------------------------------------------------------------

/**
 * Persist a posting as a journal entry.
 *
 * Refuses to write unless debits equal credits. Ledger names are resolved to
 * ids; an unknown name is an error rather than a silently dropped line, because
 * a dropped line would unbalance the books.
 */
export async function postJournalEntry(
  tx: Client,
  opts: {
    companyId: string;
    userId: string;
    posting: Posting;
    /** Provide to reuse a document number; otherwise one is allocated. */
    voucherNo?: string;
    journalPrefix?: string;
  }
): Promise<{ id: string; voucherNo: string }> {
  // Enforce the invariant BEFORE any write.
  assertBalanced(opts.posting);

  const names = [...new Set(opts.posting.lines.map((l) => l.ledger))];
  const ledgers = await tx.ledger.findMany({
    where: { companyId: opts.companyId, name: { in: names } },
    select: { id: true, name: true },
  });
  const byName = new Map(ledgers.map((l) => [l.name, l.id]));

  const missing = names.filter((n) => !byName.has(n));
  if (missing.length) {
    throw new Error(
      `Cannot post ${opts.posting.voucherType}: ledger(s) not found: ${missing.join(", ")}. ` +
        `The chart of accounts may not be initialised for this company.`
    );
  }

  const voucherNo =
    opts.voucherNo ??
    (
      await allocateDocumentNumber(tx, {
        companyId: opts.companyId,
        documentType: "JOURNAL",
        prefix: opts.journalPrefix ?? "JV",
        date: opts.posting.date,
      })
    ).number;

  const entry = await tx.journalEntry.create({
    data: {
      companyId: opts.companyId,
      voucherType: opts.posting.voucherType,
      voucherNo,
      date: opts.posting.date,
      narration: opts.posting.narration,
      sourceType: opts.posting.sourceType ?? null,
      sourceId: opts.posting.sourceId ?? null,
      createdBy: opts.userId,
      lines: {
        create: opts.posting.lines.map((l) => ({
          ledgerId: byName.get(l.ledger)!,
          debitPaise: l.debitPaise ?? 0,
          creditPaise: l.creditPaise ?? 0,
          narration: l.narration ?? null,
        })),
      },
    },
  });

  return { id: entry.id, voucherNo };
}

/**
 * Remove the journal entry produced by a document.
 *
 * Used when a document is deleted or edited. Cascade on JournalEntryLine
 * removes the lines. Editing is implemented as reverse-and-repost rather than
 * mutating lines in place, which keeps the audit trail intact.
 */
export async function deletePostingsFor(
  tx: Client,
  companyId: string,
  sourceType: string,
  sourceId: string
): Promise<number> {
  const result = await tx.journalEntry.deleteMany({
    where: { companyId, sourceType, sourceId },
  });
  return result.count;
}

// ---------------------------------------------------------------------------
// Reading balances
// ---------------------------------------------------------------------------

/**
 * Compute closing balances for every ledger in a company.
 *
 * Aggregates in the database rather than loading lines into memory, so this
 * stays viable for a tenant with a large number of entries.
 *
 * `from` is optional: profit & loss needs movements within a period, whereas a
 * balance sheet needs everything up to a date.
 */
export async function getLedgerBalances(
  companyId: string,
  opts: { from?: Date; to?: Date; includeOpening?: boolean } = {}
): Promise<LedgerBalance[]> {
  const includeOpening = opts.includeOpening ?? true;

  const ledgers = await db.ledger.findMany({
    where: { companyId },
    select: {
      id: true,
      name: true,
      openingBalancePaise: true,
      openingIsDebit: true,
      group: { select: { name: true, nature: true } },
    },
    orderBy: { name: "asc" },
  });

  const dateFilter: Prisma.JournalEntryWhereInput = { companyId };
  if (opts.from || opts.to) {
    dateFilter.date = {};
    if (opts.from) (dateFilter.date as Prisma.DateTimeFilter).gte = opts.from;
    if (opts.to) (dateFilter.date as Prisma.DateTimeFilter).lte = opts.to;
  }

  const grouped = await db.journalEntryLine.groupBy({
    by: ["ledgerId"],
    where: { entry: dateFilter },
    _sum: { debitPaise: true, creditPaise: true },
  });

  const movements = new Map(
    grouped.map((g) => [
      g.ledgerId,
      { debit: g._sum.debitPaise ?? 0, credit: g._sum.creditPaise ?? 0 },
    ])
  );

  return ledgers.map((l) => {
    const m = movements.get(l.id) ?? { debit: 0, credit: 0 };
    const closingPaise = computeClosing(
      includeOpening ? l.openingBalancePaise : 0,
      l.openingIsDebit,
      m.debit,
      m.credit
    );
    return {
      ledgerId: l.id,
      ledgerName: l.name,
      groupName: l.group.name,
      nature: l.group.nature as LedgerNature,
      debitPaise: m.debit,
      creditPaise: m.credit,
      closingPaise,
    };
  });
}

/** Trial balance: every ledger with a non-zero balance or movement. */
export async function getTrialBalance(companyId: string, to?: Date) {
  const balances = await getLedgerBalances(companyId, { to });
  const rows = balances.filter(
    (b) => b.closingPaise !== 0 || b.debitPaise !== 0 || b.creditPaise !== 0
  );

  // A trial balance is conventionally shown as two columns that must agree.
  const totalDebitPaise = rows.reduce((s, r) => s + Math.max(0, r.closingPaise), 0);
  const totalCreditPaise = rows.reduce((s, r) => s + Math.max(0, -r.closingPaise), 0);

  return {
    rows,
    totalDebitPaise,
    totalCreditPaise,
    /** Zero when the books balance. Non-zero indicates a real problem. */
    differencePaise: totalDebitPaise - totalCreditPaise,
    isBalanced: totalDebitPaise === totalCreditPaise,
  };
}

/** Profit & loss for a period. Only movements in the window count. */
export async function getProfitAndLoss(companyId: string, from: Date, to: Date) {
  // Opening balances are excluded: income and expense ledgers should not carry
  // a brought-forward balance into a period's P&L.
  const balances = await getLedgerBalances(companyId, { from, to, includeOpening: false });
  return buildProfitAndLoss(balances);
}

/** Balance sheet as at a date. Includes opening balances and all movements. */
export async function getBalanceSheet(companyId: string, asOn: Date) {
  const balances = await getLedgerBalances(companyId, { to: asOn });
  return buildBalanceSheet(balances);
}

/** Statement of one ledger: opening, each entry, running balance, closing. */
export async function getLedgerStatement(
  companyId: string,
  ledgerId: string,
  from: Date,
  to: Date
) {
  const ledger = await db.ledger.findFirst({
    where: { id: ledgerId, companyId },
    select: {
      id: true,
      name: true,
      openingBalancePaise: true,
      openingIsDebit: true,
      group: { select: { name: true, nature: true } },
    },
  });
  if (!ledger) return null;

  // Everything before `from` collapses into the opening figure.
  const prior = await db.journalEntryLine.aggregate({
    where: { ledgerId, entry: { companyId, date: { lt: from } } },
    _sum: { debitPaise: true, creditPaise: true },
  });

  const openingPaise = computeClosing(
    ledger.openingBalancePaise,
    ledger.openingIsDebit,
    prior._sum.debitPaise ?? 0,
    prior._sum.creditPaise ?? 0
  );

  const lines = await db.journalEntryLine.findMany({
    where: { ledgerId, entry: { companyId, date: { gte: from, lte: to } } },
    include: {
      entry: {
        select: {
          id: true,
          date: true,
          voucherType: true,
          voucherNo: true,
          narration: true,
          sourceType: true,
          sourceId: true,
        },
      },
    },
    orderBy: [{ entry: { date: "asc" } }, { id: "asc" }],
  });

  let running = openingPaise;
  const rows = lines.map((l) => {
    running = running + l.debitPaise - l.creditPaise;
    return {
      id: l.id,
      date: l.entry.date,
      voucherType: l.entry.voucherType,
      voucherNo: l.entry.voucherNo,
      narration: l.narration ?? l.entry.narration,
      sourceType: l.entry.sourceType,
      sourceId: l.entry.sourceId,
      debitPaise: l.debitPaise,
      creditPaise: l.creditPaise,
      runningPaise: running,
    };
  });

  return {
    ledger: {
      id: ledger.id,
      name: ledger.name,
      groupName: ledger.group.name,
      nature: ledger.group.nature as LedgerNature,
    },
    openingPaise,
    rows,
    closingPaise: running,
    totalDebitPaise: rows.reduce((s, r) => s + r.debitPaise, 0),
    totalCreditPaise: rows.reduce((s, r) => s + r.creditPaise, 0),
  };
}

/**
 * GST liability for a period: output tax collected, input credit available, and
 * the net payable. This is the core of GSTR-3B.
 */
export async function getGstSummary(companyId: string, from: Date, to: Date) {
  const balances = await getLedgerBalances(companyId, { from, to, includeOpening: false });
  const find = (name: string) => balances.find((b) => b.ledgerName === name);

  // Output tax is a liability, so its movement shows as a net credit (negative).
  const outputCgst = -(find("Output CGST")?.closingPaise ?? 0);
  const outputSgst = -(find("Output SGST")?.closingPaise ?? 0);
  const outputIgst = -(find("Output IGST")?.closingPaise ?? 0);
  const outputCess = -(find("Output Cess")?.closingPaise ?? 0);

  // Input tax is an asset, so its movement shows as a net debit (positive).
  const inputCgst = find("Input CGST")?.closingPaise ?? 0;
  const inputSgst = find("Input SGST")?.closingPaise ?? 0;
  const inputIgst = find("Input IGST")?.closingPaise ?? 0;
  const inputCess = find("Input Cess")?.closingPaise ?? 0;

  return {
    outputCgstPaise: outputCgst,
    outputSgstPaise: outputSgst,
    outputIgstPaise: outputIgst,
    outputCessPaise: outputCess,
    outputTotalPaise: outputCgst + outputSgst + outputIgst + outputCess,

    inputCgstPaise: inputCgst,
    inputSgstPaise: inputSgst,
    inputIgstPaise: inputIgst,
    inputCessPaise: inputCess,
    inputTotalPaise: inputCgst + inputSgst + inputIgst + inputCess,

    // Cess credit can only offset cess, so it is netted separately.
    netCgstPaise: outputCgst - inputCgst,
    netSgstPaise: outputSgst - inputSgst,
    netIgstPaise: outputIgst - inputIgst,
    netCessPaise: outputCess - inputCess,
    netPayablePaise:
      outputCgst - inputCgst + (outputSgst - inputSgst) + (outputIgst - inputIgst) +
      (outputCess - inputCess),
  };
}
