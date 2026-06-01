import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSuperAdmin } from "@/lib/auth";

export async function GET() {
  const admin = await getSuperAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const [broadcasts, companies] = await Promise.all([
    db.broadcast.findMany({ orderBy: { createdAt: "desc" }, take: 20 }),
    db.company.findMany({
      select: { name: true, email: true, phone: true },
    }),
  ]);
  const recipients = companies
    .map((c) => ({ name: c.name, email: c.email || "", phone: (c.phone || "").replace(/\D/g, "") }))
    .filter((r) => r.email || r.phone);
  return NextResponse.json({ broadcasts, recipients });
}

export async function POST(req: Request) {
  const admin = await getSuperAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json();
  if (!body.title || !body.message)
    return NextResponse.json({ error: "Title and message required" }, { status: 400 });
  const broadcast = await db.broadcast.create({
    data: {
      title: body.title,
      message: body.message,
      channel: body.channel || "ALL",
    },
  });
  return NextResponse.json(broadcast);
}
