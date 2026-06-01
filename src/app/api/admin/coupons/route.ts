import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSuperAdmin } from "@/lib/auth";

export async function GET() {
  const admin = await getSuperAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const coupons = await db.coupon.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(coupons);
}

export async function POST(req: Request) {
  const admin = await getSuperAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json();
  const code = (body.code || "").toString().trim().toUpperCase();
  if (!code) return NextResponse.json({ error: "Code required" }, { status: 400 });
  const exists = await db.coupon.findUnique({ where: { code } });
  if (exists) return NextResponse.json({ error: "Coupon code already exists" }, { status: 409 });

  const coupon = await db.coupon.create({
    data: {
      code,
      description: body.description || null,
      type: body.type === "FLAT" ? "FLAT" : "PERCENT",
      value: parseFloat(body.value) || 0,
      appliesToPlan: body.appliesToPlan || null,
      maxRedemptions: body.maxRedemptions ? parseInt(body.maxRedemptions) : null,
      active: body.active !== false,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : null,
    },
  });
  return NextResponse.json(coupon);
}
