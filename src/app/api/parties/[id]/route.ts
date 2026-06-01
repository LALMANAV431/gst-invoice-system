import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const party = await db.party.findFirst({
    where: { id: params.id, companyId: ctx.company.id },
  });
  if (!party) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(party);
}

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const existing = await db.party.findFirst({
    where: { id: params.id, companyId: ctx.company.id },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const updated = await db.party.update({
    where: { id: params.id },
    data: {
      name: body.name ?? existing.name,
      type: body.type ?? existing.type,
      gstin: body.gstin ?? existing.gstin,
      email: body.email ?? existing.email,
      phone: body.phone ?? existing.phone,
      addressLine1: body.addressLine1 ?? existing.addressLine1,
      addressLine2: body.addressLine2 ?? existing.addressLine2,
      city: body.city ?? existing.city,
      state: body.state ?? existing.state,
      stateCode: body.stateCode ?? existing.stateCode,
      pincode: body.pincode ?? existing.pincode,
      openingBalance:
        body.openingBalance != null ? parseFloat(body.openingBalance) : existing.openingBalance,
      balanceType: body.balanceType ?? existing.balanceType,
    },
  });
  return NextResponse.json(updated);
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await db.party.delete({
      where: { id: params.id },
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json(
      { error: "Cannot delete — party has linked transactions." },
      { status: 400 }
    );
  }
}
