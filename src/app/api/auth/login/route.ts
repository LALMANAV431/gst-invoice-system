import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db } from "@/lib/db";
import { setSessionCookie } from "@/lib/auth";
import { clientIp, LOGIN_LIMIT, rateLimit, resetRateLimit } from "@/lib/rate-limit";
import { findRecoveryCodeMatch, verifyTotp } from "@/lib/totp";

const schema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  // TOTP code or a recovery code. Absent on the first step of a 2FA login.
  code: z.string().max(20).optional(),
});

/**
 * Check a TOTP code, falling back to a single-use recovery code.
 *
 * A used TOTP counter is recorded so the same code cannot be replayed inside its
 * 30-second window, and a used recovery code is removed rather than merely
 * marked — a "used" flag someone forgets to check is a code that still works.
 */
async function verifySecondFactor(
  user: { id: string; totpSecret: string | null; totpLastCounter: number | null; recoveryCodeHashes: string | null },
  code: string
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!user.totpSecret) return { ok: false, error: "Two-factor is not set up correctly." };

  const totp = verifyTotp(user.totpSecret, code, { lastUsedCounter: user.totpLastCounter });

  if (totp.valid) {
    await db.user.update({
      where: { id: user.id },
      data: { totpLastCounter: totp.counter },
    });
    return { ok: true };
  }

  if (totp.reason === "REPLAY") {
    return { ok: false, error: "That code has already been used. Wait for the next one." };
  }

  // Not a valid TOTP — try the recovery codes.
  const hashes = user.recoveryCodeHashes?.split(",").filter(Boolean) ?? [];
  if (hashes.length > 0) {
    const match = findRecoveryCodeMatch(code, hashes);
    if (match.matched) {
      const remaining = hashes.filter((h) => h !== match.hash);
      await db.user.update({
        where: { id: user.id },
        // Consumed by removal, so it can never be accepted a second time.
        data: { recoveryCodeHashes: remaining.join(",") },
      });
      return { ok: true };
    }
  }

  return { ok: false, error: "That code is not correct." };
}

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

    // --- Second factor ------------------------------------------------------
    // The password is correct but no session is issued yet. The code is checked
    // in the same request when supplied, so there is no half-authenticated
    // intermediate session to steal.
    if (user.totpEnabledAt && user.totpSecret) {
      if (!parsed.data.code) {
        return NextResponse.json(
          { twoFactorRequired: true, message: "Enter the code from your authenticator app." },
          { status: 200 }
        );
      }

      const outcome = await verifySecondFactor(user, parsed.data.code);
      if (!outcome.ok) {
        return NextResponse.json({ error: outcome.error, twoFactorRequired: true }, { status: 401 });
      }
    }

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
