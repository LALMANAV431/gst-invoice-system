import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";

export async function GET() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const budgets = await db.budget.findMany({
    where: { companyId: ctx.company.id },
    orderBy: [{ period: "desc" }, { category: "asc" }],
  });
  return NextResponse.json(budgets);
}

export async function POST(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const { name, category, period, amount } = body;
  if (!category || !period || !amount)
    return NextResponse.json({ error: "Category, period and amount required" }, { status: 400 });

  const budget = await db.budget.upsert({
    where: {
      companyId_category_period: {
        companyId: ctx.company.id,
        category,
        period,
      },
    },
    update: { amount: parseFloat(amount), name: name || category },
    create: {
      companyId: ctx.company.id,
      name: name || category,
      category,
      period,
      amount: parseFloat(amount),
    },
  });
  return NextResponse.json(budget);
}
