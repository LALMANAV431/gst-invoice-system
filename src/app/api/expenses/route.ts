import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { nextExpenseNumber } from "@/lib/numbering";

export async function GET() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const expenses = await db.expense.findMany({
    where: { companyId: ctx.company.id },
    include: { party: true },
    orderBy: { date: "desc" },
  });
  return NextResponse.json(expenses);
}

export async function POST(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const company = ctx.company;
  const body = await req.json();
  const { category, paymentMode, amount, gstRate, date, reference, notes, partyId } = body;

  const amt = parseFloat(amount) || 0;
  if (amt <= 0) return NextResponse.json({ error: "Enter a valid amount" }, { status: 400 });
  const rate = parseFloat(gstRate) || 0;
  const taxAmount = +((amt * rate) / 100).toFixed(2);
  const total = +(amt + taxAmount).toFixed(2);
  const number = await nextExpenseNumber(company.id, company.expensePrefix);

  const expense = await db.expense.create({
    data: {
      companyId: company.id,
      partyId: partyId || null,
      number,
      category: category || "General",
      paymentMode: paymentMode || "CASH",
      amount: amt,
      gstRate: rate,
      taxAmount,
      total,
      reference: reference || null,
      notes: notes || null,
      date: date ? new Date(date) : new Date(),
    },
  });
  return NextResponse.json(expense);
}
