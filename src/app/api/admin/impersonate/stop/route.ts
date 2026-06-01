import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSession, setSessionCookie } from "@/lib/auth";

// Stop impersonating and return to the super-admin's own session.
export async function POST() {
  const session = await getSession();
  if (!session?.impersonatorId)
    return NextResponse.json({ error: "Not impersonating" }, { status: 400 });

  const admin = await db.user.findUnique({ where: { id: session.impersonatorId } });
  if (!admin) return NextResponse.json({ error: "Admin not found" }, { status: 404 });

  await setSessionCookie({
    userId: admin.id,
    email: admin.email,
    companyId: undefined,
  });

  return NextResponse.json({ ok: true });
}
