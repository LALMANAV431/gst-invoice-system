import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { hasFeature, planActive } from "@/lib/plan";

export async function GET() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const godowns = await db.godown.findMany({
    where: { companyId: ctx.company.id },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(godowns);
}

export async function POST(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasFeature(planActive(ctx.company.plan, ctx.company.planExpiry), "godowns"))
    return NextResponse.json(
      { error: "Godowns require the Basic plan. Please upgrade.", code: "PLAN_LIMIT", upgrade: true },
      { status: 402 }
    );
  const body = await req.json();
  if (!body.name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const godown = await db.godown.create({
    data: {
      companyId: ctx.company.id,
      name: body.name,
      address: body.address || null,
      city: body.city || null,
      isDefault: body.isDefault || false,
    },
  });
  return NextResponse.json(godown);
}
