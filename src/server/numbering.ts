/**
 * Atomic document numbering.
 *
 * REPLACES the previous approach in src/lib/numbering.ts, which did:
 *
 *   const last = await db.invoice.findFirst({ orderBy: { createdAt: "desc" } });
 *   return computeNext(prefix, last?.number);
 *
 * and was called BEFORE and OUTSIDE the enclosing transaction. Two concurrent
 * requests read the same "last" value and computed the same next number. The
 * @@unique([companyId, number]) constraint stopped duplicates reaching the
 * database, so the failure surfaced as an unhandled 500 rather than corruption -
 * better, but still a bug, and one that produces gaps in the series.
 *
 * GST requires a consecutive, gap-free series per financial year, so this
 * matters for compliance and not only for correctness.
 *
 * HOW THIS WORKS
 * --------------
 * A DocumentCounter row per (company, documentType, financialYear) is updated
 * with an atomic `increment` INSIDE the caller's transaction. The row acts as a
 * lock: concurrent transactions serialise on it, so each gets a distinct number.
 *
 * Always pass the transaction client (`tx`), never the global `db`, or the
 * allocation will not be part of the document's transaction and the race
 * returns.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";

export type DocumentType =
  | "INVOICE"
  | "PURCHASE"
  | "PAYMENT"
  | "QUOTATION"
  | "CREDIT"
  | "DEBIT"
  | "EXPENSE"
  | "JOURNAL";

/** A Prisma client or an interactive transaction client. */
type Client = Prisma.TransactionClient | typeof db;

/**
 * Derive the Indian financial year label (April to March) for a date.
 * 29 Aug 2026 -> "2026-27";  15 Feb 2026 -> "2025-26".
 */
export function financialYearFor(date: Date): string {
  const year = date.getFullYear();
  // getMonth() is zero-based, so March is 2 and April is 3.
  const startYear = date.getMonth() >= 3 ? year : year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, "0")}`;
}

/** Start and end of the financial year containing `date`. */
export function financialYearRange(date: Date): { start: Date; end: Date; label: string } {
  const year = date.getFullYear();
  const startYear = date.getMonth() >= 3 ? year : year - 1;
  return {
    start: new Date(startYear, 3, 1, 0, 0, 0, 0),
    end: new Date(startYear + 1, 2, 31, 23, 59, 59, 999),
    label: financialYearFor(date),
  };
}

/**
 * Format a document number.
 *
 * GST caps the number at 16 characters and allows only letters, digits, `/` and
 * `-`, so the FY is abbreviated to its two-digit start.
 * Example: prefix "INV", FY "2026-27", sequence 42 -> "INV/26-27/0042".
 */
export function formatDocumentNumber(
  prefix: string,
  financialYear: string,
  sequence: number
): string {
  const shortFy = financialYear.slice(2); // "2026-27" -> "26-27"
  const number = `${prefix}/${shortFy}/${String(sequence).padStart(4, "0")}`;
  if (number.length > 16) {
    // Fall back to a compact form rather than emitting a non-compliant number.
    return `${prefix}${String(sequence).padStart(4, "0")}`.slice(0, 16);
  }
  return number;
}

/**
 * Allocate the next number for a document type, atomically.
 *
 * MUST be called with the transaction client that also writes the document.
 */
export async function allocateDocumentNumber(
  tx: Client,
  opts: {
    companyId: string;
    documentType: DocumentType;
    prefix: string;
    date?: Date;
  }
): Promise<{ number: string; sequence: number; financialYear: string }> {
  const date = opts.date ?? new Date();
  const financialYear = financialYearFor(date);

  // upsert + increment is atomic: the unique constraint serialises concurrent
  // callers on this row, so each receives a distinct lastNumber.
  const counter = await tx.documentCounter.upsert({
    where: {
      companyId_documentType_financialYear: {
        companyId: opts.companyId,
        documentType: opts.documentType,
        financialYear,
      },
    },
    create: {
      companyId: opts.companyId,
      documentType: opts.documentType,
      financialYear,
      prefix: opts.prefix,
      lastNumber: 1,
    },
    update: {
      lastNumber: { increment: 1 },
      // Keep the prefix in step if the company changed it in settings.
      prefix: opts.prefix,
    },
  });

  return {
    number: formatDocumentNumber(opts.prefix, financialYear, counter.lastNumber),
    sequence: counter.lastNumber,
    financialYear,
  };
}

/**
 * Seed counters from documents that already exist.
 *
 * Needed when migrating a company that has documents created under the old
 * numbering scheme: without this, the first allocation would restart at 1 and
 * collide with existing numbers.
 */
export async function backfillCounter(
  tx: Client,
  opts: {
    companyId: string;
    documentType: DocumentType;
    prefix: string;
    financialYear: string;
    highestExisting: number;
  }
): Promise<void> {
  await tx.documentCounter.upsert({
    where: {
      companyId_documentType_financialYear: {
        companyId: opts.companyId,
        documentType: opts.documentType,
        financialYear: opts.financialYear,
      },
    },
    create: {
      companyId: opts.companyId,
      documentType: opts.documentType,
      financialYear: opts.financialYear,
      prefix: opts.prefix,
      lastNumber: opts.highestExisting,
    },
    update: {},
  });
}

/**
 * Reject writes into a locked or closed period.
 *
 * Once a return has been filed, the entries behind it must not change, or the
 * books stop agreeing with the return.
 */
export async function assertPeriodOpen(
  client: Client,
  companyId: string,
  date: Date
): Promise<void> {
  const fy = await client.financialYear.findFirst({
    where: { companyId, startDate: { lte: date }, endDate: { gte: date } },
  });
  if (!fy) return; // No financial year configured: nothing to enforce.

  if (fy.isClosed) {
    throw new PeriodLockedError(
      `Financial year ${fy.label} is closed. Reopen it before posting entries dated ${date.toISOString().slice(0, 10)}.`
    );
  }
  if (fy.lockedTill && date <= fy.lockedTill) {
    throw new PeriodLockedError(
      `Entries on or before ${fy.lockedTill.toISOString().slice(0, 10)} are locked (period already filed).`
    );
  }
}

export class PeriodLockedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PeriodLockedError";
  }
}
