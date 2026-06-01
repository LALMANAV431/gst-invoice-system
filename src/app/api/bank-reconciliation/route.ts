import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { hasFeature, planActive } from "@/lib/plan";

export async function GET() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const transactions = await db.bankTransaction.findMany({
    where: { companyId: ctx.company.id },
    orderBy: { date: "desc" },
  });
  return NextResponse.json(transactions);
}

// Import bank statement (array of transactions)
export async function POST(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasFeature(planActive(ctx.company.plan, ctx.company.planExpiry), "bank_reconciliation"))
    return NextResponse.json(
      { error: "Bank reconciliation requires the Premium plan. Please upgrade.", code: "PLAN_LIMIT", upgrade: true },
      { status: 402 }
    );
  const body = await req.json();

  if (!Array.isArray(body.transactions) || body.transactions.length === 0)
    return NextResponse.json({ error: "Provide transactions array" }, { status: 400 });

  const created = await db.bankTransaction.createMany({
    data: body.transactions.map((t: any) => ({
      companyId: ctx.company!.id,
      date: new Date(t.date),
      description: t.description || "",
      reference: t.reference || null,
      debit: parseFloat(t.debit) || 0,
      credit: parseFloat(t.credit) || 0,
      balance: parseFloat(t.balance) || 0,
    })),
  });

  return NextResponse.json({ imported: created.count });
}
