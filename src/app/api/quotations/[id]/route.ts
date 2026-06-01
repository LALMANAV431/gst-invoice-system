import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const quotation = await db.quotation.findFirst({
    where: { id: params.id, companyId: ctx.company.id },
    include: { party: true, items: true },
  });
  if (!quotation) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(quotation);
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const q = await db.quotation.findFirst({
    where: { id: params.id, companyId: ctx.company.id },
  });
  if (!q) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.quotation.delete({ where: { id: q.id } });
  return NextResponse.json({ ok: true });
}
