import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";

export async function GET(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type"); // CUSTOMER | VENDOR
  const where: any = { companyId: ctx.company.id };
  if (type) where.type = { in: [type, "BOTH"] };
  const parties = await db.party.findMany({
    where,
    orderBy: { name: "asc" },
  });
  return NextResponse.json(parties);
}

export async function POST(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  if (!body.name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const party = await db.party.create({
    data: {
      companyId: ctx.company.id,
      name: body.name,
      type: body.type || "CUSTOMER",
      gstin: body.gstin || null,
      email: body.email || null,
      phone: body.phone || null,
      addressLine1: body.addressLine1 || null,
      addressLine2: body.addressLine2 || null,
      city: body.city || null,
      state: body.state || null,
      stateCode: body.stateCode || (body.gstin ? body.gstin.slice(0, 2) : null),
      pincode: body.pincode || null,
      openingBalance: parseFloat(body.openingBalance) || 0,
      balanceType: body.balanceType || (body.type === "VENDOR" ? "PAYABLE" : "RECEIVABLE"),
    },
  });
  return NextResponse.json(party);
}
