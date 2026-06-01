import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { hasFeature, planActive } from "@/lib/plan";

export async function GET() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const list = await db.recurringInvoice.findMany({
    where: { companyId: ctx.company.id },
    orderBy: { nextRunDate: "asc" },
  });
  return NextResponse.json(list);
}

export async function POST(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasFeature(planActive(ctx.company.plan, ctx.company.planExpiry), "recurring_invoices"))
    return NextResponse.json(
      { error: "Recurring invoices require the Premium plan. Please upgrade.", code: "PLAN_LIMIT", upgrade: true },
      { status: 402 }
    );
  const body = await req.json();
  const { name, partyId, frequency, dayOfMonth, template } = body;

  if (!name || !partyId || !template)
    return NextResponse.json({ error: "Missing fields" }, { status: 400 });

  // Calculate next run date
  const now = new Date();
  const nextRun = new Date(now.getFullYear(), now.getMonth() + 1, dayOfMonth || 1);

  const recurring = await db.recurringInvoice.create({
    data: {
      companyId: ctx.company.id,
      name,
      partyId,
      frequency: frequency || "MONTHLY",
      dayOfMonth: parseInt(dayOfMonth) || 1,
      nextRunDate: nextRun,
      template: typeof template === "string" ? template : JSON.stringify(template),
      isActive: true,
    },
  });
  return NextResponse.json(recurring);
}
