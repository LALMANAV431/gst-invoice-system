import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSuperAdmin } from "@/lib/auth";
import { toPaise } from "@/lib/money";

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const admin = await getSuperAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json();
  const updated = await db.coupon.update({
    where: { id: params.id },
    data: {
      description: body.description ?? undefined,
      type: body.type ?? undefined,
      percentOff: body.percentOff != null ? parseFloat(body.percentOff) : undefined,
      flatOffPaise: body.flatOff != null ? toPaise(body.flatOff) : undefined,
      appliesToPlan: body.appliesToPlan ?? undefined,
      maxRedemptions:
        body.maxRedemptions != null ? parseInt(body.maxRedemptions) || null : undefined,
      active: body.active ?? undefined,
      expiresAt: body.expiresAt ? new Date(body.expiresAt) : undefined,
    },
  });
  return NextResponse.json(updated);
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const admin = await getSuperAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  await db.coupon.delete({ where: { id: params.id } });
  return NextResponse.json({ ok: true });
}
