import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const expense = await db.expense.findFirst({
    where: { id: params.id, companyId: ctx.company.id },
  });
  if (!expense) return NextResponse.json({ error: "Not found" }, { status: 404 });
  await db.expense.delete({ where: { id: expense.id } });
  return NextResponse.json({ ok: true });
}
