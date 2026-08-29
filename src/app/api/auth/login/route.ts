import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { setSessionCookie } from "@/lib/auth";
import { clientIp, LOGIN_LIMIT, rateLimit, resetRateLimit } from "@/lib/rate-limit";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export async function POST(req: Request) {
  try {
    const ip = clientIp(req);
    const parsed = schema.safeParse(await req.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "Enter a valid email and password" }, { status: 400 });
    }
    const email = parsed.data.email.toLowerCase();
    const { password } = parsed.data;

    // Two independent limits.
    //
    // Per IP+email stops brute force against one account. Per IP alone stops
    // credential stuffing that sprays many accounts from one address. Limiting
    // on email alone would let an attacker lock a victim out of their own
    // account, so that is deliberately not done.
    const perAccount = rateLimit(`login:${ip}:${email}`, LOGIN_LIMIT, 60_000);
    const perIp = rateLimit(`login:${ip}`, LOGIN_LIMIT * 4, 60_000);

    if (!perAccount.allowed || !perIp.allowed) {
      const retryAfter = Math.max(perAccount.retryAfter, perIp.retryAfter);
      return NextResponse.json(
        { error: `Too many login attempts. Try again in ${retryAfter} seconds.` },
        { status: 429, headers: { "Retry-After": String(retryAfter) } }
      );
    }

    const user = await db.user.findUnique({
      where: { email },
      include: { companies: { orderBy: { createdAt: "asc" } } },
    });

    // Identical response for unknown email and wrong password, so the endpoint
    // cannot be used to enumerate which accounts exist.
    if (!user) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });

    const ok = await bcrypt.compare(password, user.password);
    if (!ok) return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });

    // Clear the per-account counter so a legitimate user who mistyped once is
    // not left throttled.
    resetRateLimit(`login:${ip}:${email}`);

    await setSessionCookie({
      userId: user.id,
      email: user.email,
      companyId: user.companies[0]?.id,
      tokenVersion: user.tokenVersion,
    });
    return NextResponse.json({ ok: true });
  } catch (e) {
    console.error("[auth/login] failed:", e);
    return NextResponse.json({ error: "Login failed" }, { status: 500 });
  }
}
