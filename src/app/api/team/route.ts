import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import bcrypt from "bcryptjs";

export async function GET() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const members = await db.teamMember.findMany({
    where: { companyId: ctx.company.id },
    include: { user: { select: { id: true, name: true, email: true } } },
    orderBy: { createdAt: "asc" },
  });
  return NextResponse.json(members);
}

export async function POST(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const { email, name, password, role } = body;
  if (!email || !name || !password)
    return NextResponse.json({ error: "Name, email and password required" }, { status: 400 });

  // Create user if not exists, then add as team member
  let user = await db.user.findUnique({ where: { email: email.toLowerCase() } });
  if (!user) {
    const hashed = await bcrypt.hash(password, 10);
    user = await db.user.create({
      data: { name, email: email.toLowerCase(), password: hashed, role: role || "ACCOUNTANT" },
    });
  }

  const existing = await db.teamMember.findUnique({
    where: { userId_companyId: { userId: user.id, companyId: ctx.company.id } },
  });
  if (existing) return NextResponse.json({ error: "User already in team" }, { status: 409 });

  const member = await db.teamMember.create({
    data: {
      userId: user.id,
      companyId: ctx.company.id,
      role: role || "ACCOUNTANT",
    },
    include: { user: { select: { id: true, name: true, email: true } } },
  });
  return NextResponse.json(member);
}
