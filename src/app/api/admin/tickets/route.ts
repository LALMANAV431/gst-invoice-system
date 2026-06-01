import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSuperAdmin } from "@/lib/auth";

export async function GET() {
  const admin = await getSuperAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const tickets = await db.supportTicket.findMany({ orderBy: { createdAt: "desc" } });
  return NextResponse.json(tickets);
}
