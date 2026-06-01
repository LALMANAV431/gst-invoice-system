import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";

export async function GET() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const tickets = await db.supportTicket.findMany({
    where: { companyId: ctx.company.id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json(tickets);
}

export async function POST(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  if (!body.subject || !body.message)
    return NextResponse.json({ error: "Subject and message required" }, { status: 400 });

  const ticket = await db.supportTicket.create({
    data: {
      companyId: ctx.company.id,
      userName: ctx.user.name,
      userEmail: ctx.user.email,
      subject: body.subject,
      message: body.message,
      status: "OPEN",
    },
  });
  return NextResponse.json(ticket);
}
