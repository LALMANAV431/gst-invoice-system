import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { percentOf, toPaise, toRupees } from "@/lib/money";

const schema = z.object({
  code: z.string().min(1, "Enter a coupon code"),
  plan: z.string().optional(),
  /** Plan price in rupees, as shown on the pricing page. */
  price: z.union([z.string(), z.number()]),
});

/** Validate a coupon against a plan and price, returning the discounted amount. */
export async function POST(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const code = parsed.data.code.trim().toUpperCase();
  const pricePaise = toPaise(parsed.data.price);

  const coupon = await db.coupon.findUnique({ where: { code } });
  if (!coupon || !coupon.active) {
    return NextResponse.json({ error: "Invalid coupon" }, { status: 404 });
  }
  if (coupon.expiresAt && coupon.expiresAt.getTime() < Date.now()) {
    return NextResponse.json({ error: "Coupon expired" }, { status: 400 });
  }
  if (coupon.maxRedemptions != null && coupon.timesRedeemed >= coupon.maxRedemptions) {
    return NextResponse.json({ error: "Coupon usage limit reached" }, { status: 400 });
  }
  if (coupon.appliesToPlan && coupon.appliesToPlan !== parsed.data.plan) {
    return NextResponse.json(
      { error: `Coupon valid only for the ${coupon.appliesToPlan} plan` },
      { status: 400 }
    );
  }

  // A percentage coupon carries `percentOff`; a flat one carries `flatOffPaise`.
  // Keeping them in separate columns avoids the previous single `value` field
  // that meant "percent" or "rupees" depending on `type`.
  const discountPaise =
    coupon.type === "PERCENT"
      ? percentOf(pricePaise, coupon.percentOff)
      : Math.min(pricePaise, coupon.flatOffPaise);

  const finalPricePaise = Math.max(0, pricePaise - discountPaise);

  return NextResponse.json({
    ok: true,
    code: coupon.code,
    type: coupon.type,
    percentOff: coupon.percentOff,
    flatOffPaise: coupon.flatOffPaise,
    discountPaise,
    finalPricePaise,
    // Rupee values for convenience in the pricing UI.
    discount: toRupees(discountPaise),
    finalPrice: toRupees(finalPricePaise),
  });
}
