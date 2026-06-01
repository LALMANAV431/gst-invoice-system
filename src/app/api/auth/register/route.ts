import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { setSessionCookie } from "@/lib/auth";

export async function POST(req: Request) {
  try {
    const body = await req.json();
    const { name, email, password, companyName, gstin, state, stateCode } = body;
    if (!name || !email || !password || !companyName) {
      return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
    }
    const exists = await db.user.findUnique({ where: { email: email.toLowerCase() } });
    if (exists) {
      return NextResponse.json({ error: "Email already registered" }, { status: 409 });
    }
    const hashed = await bcrypt.hash(password, 10);
    const user = await db.user.create({
      data: {
        name,
        email: email.toLowerCase(),
        password: hashed,
        companies: {
          create: {
            name: companyName,
            gstin: gstin || null,
            state: state || null,
            stateCode: stateCode || (gstin ? gstin.slice(0, 2) : null),
          },
        },
      },
      include: { companies: true },
    });
    await setSessionCookie({
      userId: user.id,
      email: user.email,
      companyId: user.companies[0]?.id,
    });
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message || "Failed" }, { status: 500 });
  }
}
