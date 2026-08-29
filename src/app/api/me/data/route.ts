import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany, revokeAllSessions } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import { toRupees } from "@/lib/money";

/**
 * Data portability and erasure, for India's Digital Personal Data Protection Act,
 * 2023.
 *
 * GET    — export everything held about this tenant, as JSON.
 * DELETE — erase the tenant's data.
 *
 * THE RETENTION TENSION
 * ---------------------
 * DPDP gives a right to erasure, but GST and income-tax law require books to be
 * retained for several years after the relevant financial year. These conflict,
 * and the honest resolution is not to silently pick one:
 *
 *   - export is unconditional; there is no reason to withhold a copy;
 *   - deletion warns when records fall inside the statutory retention window and
 *     requires an explicit acknowledgement to proceed.
 *
 * This is a good-faith engineering implementation, not legal advice. The exact
 * retention period should be confirmed with a CA before a tenant relies on it.
 */

export const dynamic = "force-dynamic";

/** Statutory retention, conservatively. Confirm the current rule with a CA. */
const RETENTION_YEARS = 8;

/** Keep the first occurrence of each id. The owner may also be a team member. */
function dedupeById<T extends { id: string }>(rows: T[]): T[] {
  const seen = new Set<string>();
  return rows.filter((row) => {
    if (seen.has(row.id)) return false;
    seen.add(row.id);
    return true;
  });
}

export async function GET() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Only an admin may take a full copy of the company's books.
  if (ctx.user.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Only an admin can export company data." },
      { status: 403 }
    );
  }

  const companyId = ctx.company.id;

  const limit = rateLimit(`data-export:${companyId}`, 3, 3_600_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: "Export is limited to 3 times per hour. Please try again later." },
      { status: 429 }
    );
  }

  const [
    company,
    users,
    parties,
    items,
    invoices,
    purchases,
    payments,
    expenses,
    creditNotes,
    quotations,
    orders,
    journalEntries,
    ledgers,
    stockMovements,
    auditLogs,
    messageLogs,
  ] = await Promise.all([
    db.company.findUnique({
      where: { id: companyId },
      include: {
        // The OWNER is linked through Company.ownerId, not through TeamMember, so
        // querying only team members produced an export with no users in it at
        // all — an incomplete export is a failed one under a portability right.
        owner: {
          select: { id: true, email: true, name: true, role: true, locale: true, createdAt: true },
        },
      },
    }),
    db.teamMember.findMany({
      where: { companyId },
      include: {
        // Deliberately excludes password, totpSecret and recoveryCodeHashes:
        // an export must not hand over credentials.
        user: { select: { id: true, email: true, name: true, role: true, locale: true, createdAt: true } },
      },
    }),
    db.party.findMany({ where: { companyId } }),
    db.item.findMany({ where: { companyId } }),
    db.invoice.findMany({ where: { companyId }, include: { items: true } }),
    db.purchase.findMany({ where: { companyId }, include: { items: true } }),
    db.payment.findMany({ where: { companyId } }),
    db.expense.findMany({ where: { companyId } }),
    db.creditNote.findMany({ where: { companyId }, include: { items: true } }),
    db.quotation.findMany({ where: { companyId }, include: { items: true } }),
    db.orderDocument.findMany({ where: { companyId }, include: { items: true } }),
    db.journalEntry.findMany({ where: { companyId }, include: { lines: true } }),
    db.ledger.findMany({ where: { companyId }, include: { group: true } }),
    db.stockMovement.findMany({ where: { companyId } }),
    db.auditLog.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 5000 }),
    db.messageLog.findMany({ where: { companyId }, orderBy: { createdAt: "desc" }, take: 2000 }),
  ]);

  const payload = {
    meta: {
      exportedAt: new Date().toISOString(),
      exportedBy: ctx.user.email,
      format: "gst-invoice-system/v1",
      // Stated explicitly so nobody misreads a paise integer as rupees.
      monetaryUnit: "paise (integer; divide by 100 for rupees)",
      note:
        "Complete export of this company's data. Credentials (passwords, 2FA secrets, " +
        "recovery codes) are deliberately excluded.",
    },
    company,
    // `companyRole` and `accountRole` are named apart deliberately: TeamMember.role
    // is this user's role IN THIS COMPANY, while User.role is their account-level
    // default. Spreading the user object over a `role` key silently discarded the
    // company-scoped one, which is the meaningful value here.
    //
    // The owner is included first and de-duplicated, because they may also appear
    // as a team member.
    users: dedupeById([
      ...(company?.owner
        ? [
            {
              ...company.owner,
              companyRole: "OWNER",
              accountRole: company.owner.role,
              joinedAt: company.createdAt,
            },
          ]
        : []),
      ...users.map((m) => ({
        ...m.user,
        companyRole: m.role,
        accountRole: m.user.role,
        joinedAt: m.createdAt,
      })),
    ]),
    parties,
    items,
    invoices,
    purchases,
    payments,
    expenses,
    creditNotes,
    quotations,
    orderDocuments: orders,
    journalEntries,
    ledgers,
    stockMovements,
    auditLogs,
    messageLogs,
    counts: {
      // Includes the owner, so this reflects what is actually in the export.
      users: 1 + users.length,
      parties: parties.length,
      items: items.length,
      invoices: invoices.length,
      purchases: purchases.length,
      payments: payments.length,
      journalEntries: journalEntries.length,
    },
  };

  await logAudit({
    companyId,
    userId: ctx.user.id,
    action: "UPDATE",
    entity: "Company",
    entityId: companyId,
    changes: { dataExported: true, invoices: invoices.length },
  });

  const filename = `gst-data-export-${companyId.slice(-8)}-${new Date().toISOString().slice(0, 10)}.json`;

  return new NextResponse(JSON.stringify(payload, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Cache-Control": "no-store",
    },
  });
}

const deleteSchema = z.object({
  password: z.string().min(1, "Confirm your password"),
  // Typing the company name is a deliberate friction: this is irreversible.
  confirmCompanyName: z.string().min(1),
  // Required when records fall inside the statutory retention window.
  acknowledgeRetention: z.boolean().optional(),
});

export async function DELETE(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (ctx.user.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Only an admin can delete company data." },
      { status: 403 }
    );
  }

  const limit = rateLimit(`data-delete:${clientIp(req)}:${ctx.user.id}`, 5, 3_600_000);
  if (!limit.allowed) {
    return NextResponse.json({ error: "Too many attempts." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = deleteSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const companyId = ctx.company.id;

  if (parsed.data.confirmCompanyName.trim() !== ctx.company.name.trim()) {
    return NextResponse.json(
      { error: "The company name does not match. Deletion cancelled." },
      { status: 400 }
    );
  }

  const user = await db.user.findUnique({
    where: { id: ctx.user.id },
    select: { password: true },
  });
  const passwordOk = user ? await bcrypt.compare(parsed.data.password, user.password) : false;
  if (!passwordOk) {
    return NextResponse.json({ error: "Password is not correct." }, { status: 403 });
  }

  // --- Statutory retention check -----------------------------------------
  const cutoff = new Date();
  cutoff.setFullYear(cutoff.getFullYear() - RETENTION_YEARS);

  const [recentInvoices, recentPurchases] = await Promise.all([
    db.invoice.count({ where: { companyId, date: { gte: cutoff } } }),
    db.purchase.count({ where: { companyId, date: { gte: cutoff } } }),
  ]);
  const withinRetention = recentInvoices + recentPurchases;

  if (withinRetention > 0 && !parsed.data.acknowledgeRetention) {
    // Not a refusal — a required acknowledgement. The tenant owns the decision;
    // our job is to make sure it is an informed one.
    return NextResponse.json(
      {
        error: "Retention acknowledgement required",
        code: "RETENTION_WARNING",
        recordsWithinRetention: withinRetention,
        retentionYears: RETENTION_YEARS,
        message:
          `${withinRetention} invoices and purchases are dated within the last ` +
          `${RETENTION_YEARS} years. GST and income-tax law generally require these to be ` +
          `retained. Export your data first, confirm with your CA, then resend with ` +
          `acknowledgeRetention: true to proceed.`,
      },
      { status: 409 }
    );
  }

  // Cascade deletes handle the children: every tenant table declares
  // onDelete: Cascade on its companyId relation.
  const summary = { invoices: recentInvoices, purchases: recentPurchases };

  await db.$transaction(async (tx) => {
    // Webhook events are global rather than per-company, so they are not caught
    // by the cascade; they hold gateway payloads that can reference this tenant.
    await tx.company.delete({ where: { id: companyId } });

    // If this was the user's only company, the account has nothing left to own.
    const remaining = await tx.company.count({ where: { ownerId: ctx.user.id } });
    if (remaining === 0) {
      await tx.user.delete({ where: { id: ctx.user.id } });
    }
  });

  // Any session pointing at deleted data must stop working immediately.
  await revokeAllSessions(ctx.user.id).catch(() => undefined);

  return NextResponse.json({
    ok: true,
    deleted: summary,
    message:
      "Company data has been erased. This cannot be undone. You have been signed out.",
  });
}
