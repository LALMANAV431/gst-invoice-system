import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { writeGuard } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { toPaise } from "@/lib/money";
import { ensureChartOfAccounts } from "@/server/ledger";

/**
 * Chart of accounts.
 *
 * GET returns the tenant's ledgers grouped for a picker; POST creates a new one.
 * The chart is created on demand, so a company that predates the accounting
 * engine gets one the first time it is asked for rather than showing an empty
 * list.
 */

const createSchema = z.object({
  name: z.string().min(1, "Ledger name is required").max(100),
  groupId: z.string().min(1, "Choose a group"),
  code: z.string().max(30).nullish(),
  openingBalance: z.union([z.string(), z.number()]).optional(),
  openingIsDebit: z.coerce.boolean().optional(),
});

export async function GET() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const companyId = ctx.company.id;

  // Create the chart on first access rather than returning nothing.
  const count = await db.ledgerGroup.count({ where: { companyId } });
  if (count === 0) await ensureChartOfAccounts(db, companyId);

  const groups = await db.ledgerGroup.findMany({
    where: { companyId },
    select: {
      id: true,
      name: true,
      nature: true,
      sortOrder: true,
      ledgers: {
        select: {
          id: true,
          name: true,
          code: true,
          isSystem: true,
          partyId: true,
          openingBalancePaise: true,
          openingIsDebit: true,
        },
        orderBy: { name: "asc" },
      },
    },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
  });

  return NextResponse.json({
    groups: groups.filter((g) => g.ledgers.length > 0 || !g.name.includes("(")),
  });
}

export async function POST(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;

  const companyId = ctx.company.id;

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

  // The group must belong to this tenant.
  const group = await db.ledgerGroup.findFirst({
    where: { id: input.groupId, companyId },
    select: { id: true },
  });
  if (!group) return NextResponse.json({ error: "Invalid group" }, { status: 400 });

  const name = input.name.trim();
  const existing = await db.ledger.findFirst({ where: { companyId, name } });
  if (existing) {
    return NextResponse.json(
      { error: `A ledger named "${name}" already exists.` },
      { status: 409 }
    );
  }

  const ledger = await db.ledger.create({
    data: {
      companyId,
      groupId: group.id,
      name,
      code: input.code ?? null,
      openingBalancePaise: toPaise(input.openingBalance ?? 0),
      openingIsDebit: input.openingIsDebit ?? true,
    },
  });

  await logAudit({
    companyId,
    userId: ctx.user.id,
    action: "CREATE",
    entity: "Ledger",
    entityId: ledger.id,
    changes: { name: ledger.name },
  });

  return NextResponse.json(ledger);
}
