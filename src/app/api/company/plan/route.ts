import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { PLANS, type PlanId } from "@/lib/plan";

// Simulated subscription activation.
// In production, this would be called by a payment-gateway webhook
// (Razorpay/Stripe) AFTER successful payment.
export async function POST(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const body = await req.json();
  const planId = body.plan as PlanId;
  if (!planId || !PLANS[planId]) {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }

  // Set expiry 30 days out for paid plans; FREE has no expiry
  const expiry =
    planId === "FREE" ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);

  const updated = await db.company.update({
    where: { id: ctx.company.id },
    data: { plan: planId, planExpiry: expiry },
  });

  return NextResponse.json({
    ok: true,
    plan: updated.plan,
    planExpiry: updated.planExpiry,
  });
}
