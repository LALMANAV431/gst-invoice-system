import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";

// Validates a coupon for a given plan + price and returns the discounted amount.
export async function POST(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const code = (body.code || "").toString().trim().toUpperCase();
  const plan = body.plan as string;
  const price = parseFloat(body.price) || 0;

  if (!code) return NextResponse.json({ error: "Enter a coupon code" }, { status: 400 });

  const coupon = await db.coupon.findUnique({ where: { code } });
  if (!coupon || !coupon.active)
    return NextResponse.json({ error: "Invalid coupon" }, { status: 404 });
  if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now())
    return NextResponse.json({ error: "Coupon expired" }, { status: 400 });
  if (coupon.maxRedemptions != null && coupon.timesRedeemed >= coupon.maxRedemptions)
    return NextResponse.json({ error: "Coupon usage limit reached" }, { status: 400 });
  if (coupon.appliesToPlan && coupon.appliesToPlan !== plan)
    return NextResponse.json(
      { error: `Coupon valid only for ${coupon.appliesToPlan} plan` },
      { status: 400 }
    );

  const discount =
    coupon.type === "PERCENT"
      ? Math.round((price * coupon.value) / 100)
      : Math.min(price, coupon.value);
  const finalPrice = Math.max(0, +(price - discount).toFixed(2));

  return NextResponse.json({
    ok: true,
    code: coupon.code,
    type: coupon.type,
    value: coupon.value,
    discount,
    finalPrice,
  });
}
