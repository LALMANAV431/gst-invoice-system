import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { writeGuard } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { closeFinancialYear } from "@/server/ledger";
import { financialYearFor } from "@/server/numbering";

/**
 * Financial years: create, lock a period, and close a year.
 *
 * Period locking is what stops a filed return from silently disagreeing with the
 * books afterwards. Closing transfers the year's profit to Retained Earnings so
 * the next year's P&L starts from zero while the balance sheet carries forward.
 */

const createSchema = z.object({
  label: z.string().regex(/^\d{4}-\d{2}$/, 'Use the form "2026-27"'),
  startDate: z.coerce.date(),
  endDate: z.coerce.date(),
});

const patchSchema = z.object({
  id: z.string().min(1),
  action: z.enum(["LOCK", "UNLOCK", "CLOSE", "REOPEN"]),
  /** Required for LOCK: no entries on or before this date. */
  lockedTill: z.coerce.date().nullish(),
});

export async function GET() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const years = await db.financialYear.findMany({
    where: { companyId: ctx.company.id },
    orderBy: { startDate: "desc" },
  });

  return NextResponse.json({ years, current: financialYearFor(new Date()) });
}

export async function POST(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;

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

  if (parsed.data.endDate <= parsed.data.startDate) {
    return NextResponse.json(
      { error: "The end date must be after the start date." },
      { status: 400 }
    );
  }

  const existing = await db.financialYear.findFirst({
    where: { companyId: ctx.company.id, label: parsed.data.label },
  });
  if (existing) {
    return NextResponse.json(
      { error: `Financial year ${parsed.data.label} already exists.` },
      { status: 409 }
    );
  }

  const year = await db.financialYear.create({
    data: {
      companyId: ctx.company.id,
      label: parsed.data.label,
      startDate: parsed.data.startDate,
      endDate: parsed.data.endDate,
    },
  });

  return NextResponse.json(year);
}

export async function PATCH(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;

  // Closing or reopening a year rewrites the accounting position, so it is
  // restricted to the tenant's own admins rather than every role that can write.
  if (ctx.user.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Only an admin can lock or close a financial year." },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const { id, action } = parsed.data;
  const companyId = ctx.company.id;

  const year = await db.financialYear.findFirst({ where: { id, companyId } });
  if (!year) return NextResponse.json({ error: "Not found" }, { status: 404 });

  try {
    switch (action) {
      case "LOCK": {
        if (!parsed.data.lockedTill) {
          return NextResponse.json(
            { error: "Provide the date to lock entries up to." },
            { status: 400 }
          );
        }
        const updated = await db.financialYear.update({
          where: { id },
          data: { lockedTill: parsed.data.lockedTill },
        });
        await logAudit({
          companyId,
          userId: ctx.user.id,
          action: "UPDATE",
          entity: "FinancialYear",
          entityId: id,
          changes: { lockedTill: parsed.data.lockedTill.toISOString() },
        });
        return NextResponse.json(updated);
      }

      case "UNLOCK": {
        const updated = await db.financialYear.update({
          where: { id },
          data: { lockedTill: null },
        });
        // Unlocking a filed period is exactly the action an auditor would want to
        // see, so it is always recorded.
        await logAudit({
          companyId,
          userId: ctx.user.id,
          action: "UPDATE",
          entity: "FinancialYear",
          entityId: id,
          changes: { lockedTill: null, note: "Period unlocked" },
        });
        return NextResponse.json(updated);
      }

      case "CLOSE": {
        const result = await closeFinancialYear({
          companyId,
          userId: ctx.user.id,
          financialYearId: id,
        });
        await logAudit({
          companyId,
          userId: ctx.user.id,
          action: "UPDATE",
          entity: "FinancialYear",
          entityId: id,
          changes: {
            closed: true,
            netProfitPaise: result.netProfitPaise,
            voucherNo: result.voucherNo,
          },
        });
        return NextResponse.json({ ok: true, ...result });
      }

      case "REOPEN": {
        // The closing voucher must go with the reopening, or the year's income and
        // expense ledgers would stay zeroed while the year is open again.
        const removed = await db.$transaction(async (tx) => {
          const count = await tx.journalEntry.deleteMany({
            where: { companyId, sourceType: "FinancialYear", sourceId: id },
          });
          await tx.financialYear.update({
            where: { id },
            data: { isClosed: false, lockedTill: null },
          });
          return count.count;
        });

        await logAudit({
          companyId,
          userId: ctx.user.id,
          action: "UPDATE",
          entity: "FinancialYear",
          entityId: id,
          changes: { closed: false, closingVouchersRemoved: removed },
        });
        return NextResponse.json({ ok: true, closingVouchersRemoved: removed });
      }
    }
  } catch (e) {
    const message = e instanceof Error ? e.message : "Could not update the financial year";
    // These are expected states (already closed, nothing to close), so they are
    // 400s with the reason rather than 500s.
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
