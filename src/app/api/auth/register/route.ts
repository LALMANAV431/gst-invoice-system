import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { setSessionCookie } from "@/lib/auth";

const schema = z.object({
  name: z.string().min(1).max(120),
  email: z.string().email(),
  password: z.string().min(6, "Password must be at least 6 characters").max(200),
  companyName: z.string().min(1).max(160),
  gstin: z.string().max(15).optional().or(z.literal("")),
  state: z.string().max(80).optional().or(z.literal("")),
  stateCode: z.string().max(2).optional().or(z.literal("")),
});

export async function POST(req: Request) {
  try {
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      const msg = parsed.error.issues[0]?.message || "Invalid input";
      return NextResponse.json({ error: msg }, { status: 400 });
    }
    const { name, email, password, companyName, gstin, state, stateCode } = parsed.data;

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
    return NextResponse.json({ error: "Registration failed" }, { status: 500 });
  }
}
