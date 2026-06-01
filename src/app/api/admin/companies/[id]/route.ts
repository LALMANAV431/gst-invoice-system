import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSuperAdmin } from "@/lib/auth";

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const admin = await getSuperAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json();

  const data: any = {};
  if (body.plan && ["FREE", "BASIC", "PREMIUM"].includes(body.plan)) {
    data.plan = body.plan;
    data.planExpiry =
      body.plan === "FREE" ? null : new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  }
  if (typeof body.isSuspended === "boolean") data.isSuspended = body.isSuspended;

  const updated = await db.company.update({ where: { id: params.id }, data });
  return NextResponse.json(updated);
}
