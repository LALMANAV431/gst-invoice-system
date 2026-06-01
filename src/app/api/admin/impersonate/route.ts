import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSuperAdmin, setSessionCookie } from "@/lib/auth";

// Super-admin starts impersonating a company (logs in as its owner).
export async function POST(req: Request) {
  const admin = await getSuperAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });

  const { companyId } = await req.json();
  const company = await db.company.findUnique({
    where: { id: companyId },
    include: { owner: true },
  });
  if (!company) return NextResponse.json({ error: "Company not found" }, { status: 404 });

  await setSessionCookie({
    userId: company.owner.id,
    email: company.owner.email,
    companyId: company.id,
    impersonatorId: admin.id,
  });

  return NextResponse.json({ ok: true });
}
