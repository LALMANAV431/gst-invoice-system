import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSuperAdmin } from "@/lib/auth";

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const admin = await getSuperAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const body = await req.json();
  const updated = await db.supportTicket.update({
    where: { id: params.id },
    data: {
      reply: body.reply ?? undefined,
      status: body.status ?? undefined,
    },
  });
  return NextResponse.json(updated);
}
