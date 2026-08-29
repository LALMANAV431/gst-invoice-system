import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { hasFeature, planActive } from "@/lib/plan";

const EWAY_THRESHOLD = 50000; // ₹50,000 statutory threshold

/**
 * Generate an E-Way Bill number.
 *
 * NOTE: Functional simulation. In production this calls the NIC E-Way Bill API
 * which returns a 12-digit EWB number + validity. Here we generate a 12-digit
 * number so the flow works end to end.
 */
export async function POST(_: Request, { params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  if (!hasFeature(planActive(ctx.company.plan, ctx.company.planExpiry), "eway_bill"))
    return NextResponse.json(
      { error: "E-Way Bill requires the Premium plan. Please upgrade.", code: "PLAN_LIMIT", upgrade: true },
      { status: 402 }
    );

  const invoice = await db.invoice.findFirst({
    where: { id: params.id, companyId: ctx.company.id },
  });
  if (!invoice) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (invoice.ewayBillNo)
    return NextResponse.json({ error: "E-Way Bill already generated" }, { status: 400 });
  if (invoice.grandTotalPaise < EWAY_THRESHOLD)
    return NextResponse.json(
      { error: `E-Way Bill is only required for invoices above ₹${EWAY_THRESHOLD.toLocaleString("en-IN")}.` },
      { status: 400 }
    );

  // 12-digit EWB number
  const ewayBillNo = String(Math.floor(1e11 + Math.random() * 9e11));
  const ewayBillDate = new Date();

  const updated = await db.invoice.update({
    where: { id: invoice.id },
    data: { ewayBillNo, ewayBillDate },
  });

  return NextResponse.json({
    ok: true,
    ewayBillNo: updated.ewayBillNo,
    ewayBillDate: updated.ewayBillDate,
  });
}
