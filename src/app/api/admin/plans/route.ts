import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSuperAdmin } from "@/lib/auth";
import { getEffectivePlans } from "@/lib/plan";

export async function GET() {
  const admin = await getSuperAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const plans = await getEffectivePlans();
  return NextResponse.json(plans);
}

export async function PUT(req: Request) {
  const admin = await getSuperAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json();
  const id = body.id as string;
  if (!["FREE", "BASIC", "PREMIUM"].includes(id))
    return NextResponse.json({ error: "Invalid plan id" }, { status: 400 });

  const data = {
    name: body.name || id,
    tagline: body.tagline || null,
    priceMonthlyPaise: parseFloat(body.priceMonthlyPaise) || 0,
    priceAnnualPaise: parseFloat(body.priceAnnualPaise) || 0,
    invoiceLimit: body.invoiceLimit === "" || body.invoiceLimit == null ? -1 : parseInt(body.invoiceLimit),
    userLimit: parseInt(body.userLimit) || 1,
    active: body.active !== false,
  };

  const updated = await db.planSetting.upsert({
    where: { id },
    update: data,
    create: { id, ...data },
  });
  return NextResponse.json(updated);
}
