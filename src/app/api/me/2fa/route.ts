import { NextResponse } from "next/server";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany, revokeAllSessions } from "@/lib/auth";
import { logAudit } from "@/lib/audit";
import { clientIp, rateLimit } from "@/lib/rate-limit";
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  totpUri,
  verifyTotp,
} from "@/lib/totp";

/**
 * Two-factor authentication enrolment.
 *
 * ENROLMENT IS TWO-STEP by design:
 *   POST   — generate a secret and return the QR URI. Nothing is enabled yet.
 *   PUT    — confirm with a working code from the app. Only now is 2FA active.
 *   DELETE — turn it off, which requires the current password.
 *
 * Enabling in one step would let a user who mis-scanned the QR lock themselves
 * out of their own accounting records permanently.
 */

const ISSUER = "GST Invoice";

export async function GET() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const user = await db.user.findUnique({
    where: { id: ctx.user.id },
    select: { totpEnabledAt: true, recoveryCodeHashes: true },
  });

  const remaining = user?.recoveryCodeHashes
    ? user.recoveryCodeHashes.split(",").filter(Boolean).length
    : 0;

  return NextResponse.json({
    enabled: Boolean(user?.totpEnabledAt),
    enabledAt: user?.totpEnabledAt ?? null,
    recoveryCodesRemaining: remaining,
  });
}

/** Step 1: generate a secret and return the provisioning URI. */
export async function POST() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const existing = await db.user.findUnique({
    where: { id: ctx.user.id },
    select: { totpEnabledAt: true },
  });
  if (existing?.totpEnabledAt) {
    return NextResponse.json(
      { error: "Two-factor authentication is already on. Turn it off first to re-enrol." },
      { status: 409 }
    );
  }

  const secret = generateTotpSecret();

  // Stored but NOT enabled: `totpEnabledAt` stays null until a code verifies, so
  // an abandoned enrolment leaves the account exactly as it was.
  await db.user.update({
    where: { id: ctx.user.id },
    data: { totpSecret: secret, totpLastCounter: null },
  });

  return NextResponse.json({
    secret,
    uri: totpUri({ secret, accountName: ctx.user.email, issuer: ISSUER }),
    next: "Scan this in your authenticator app, then confirm with a code to switch it on.",
  });
}

const confirmSchema = z.object({
  code: z.string().min(6).max(10),
});

/** Step 2: confirm with a real code, then issue recovery codes. */
export async function PUT(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // A 6-digit code is only a million possibilities, so confirmation must be
  // rate limited or it is brute-forceable.
  const limit = rateLimit(`2fa-confirm:${ctx.user.id}`, 10, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${limit.retryAfter} seconds.` },
      { status: 429, headers: { "Retry-After": String(limit.retryAfter) } }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = confirmSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Enter the 6-digit code" }, { status: 400 });
  }

  const user = await db.user.findUnique({
    where: { id: ctx.user.id },
    select: { totpSecret: true, totpEnabledAt: true },
  });

  if (!user?.totpSecret) {
    return NextResponse.json(
      { error: "Start enrolment first." },
      { status: 400 }
    );
  }
  if (user.totpEnabledAt) {
    return NextResponse.json({ error: "Already enabled." }, { status: 409 });
  }

  const result = verifyTotp(user.totpSecret, parsed.data.code);
  if (!result.valid) {
    return NextResponse.json(
      {
        error:
          result.reason === "FORMAT"
            ? "Enter the 6-digit code from your app."
            : "That code is not correct. Check your phone's clock is accurate.",
      },
      { status: 400 }
    );
  }

  // Recovery codes are shown once and stored only as hashes.
  const recoveryCodes = generateRecoveryCodes(8);

  await db.user.update({
    where: { id: ctx.user.id },
    data: {
      totpEnabledAt: new Date(),
      totpLastCounter: result.counter,
      recoveryCodeHashes: recoveryCodes.map(hashRecoveryCode).join(","),
    },
  });

  await logAudit({
    companyId: ctx.company?.id ?? "",
    userId: ctx.user.id,
    action: "UPDATE",
    entity: "User",
    entityId: ctx.user.id,
    changes: { twoFactorEnabled: true },
  });

  return NextResponse.json({
    ok: true,
    recoveryCodes,
    warning:
      "Save these recovery codes now. They are shown once and each works only once. " +
      "Without them, losing your phone means losing access to this account.",
  });
}

const disableSchema = z.object({
  password: z.string().min(1, "Confirm your password"),
});

/** Turn 2FA off. Requires the current password. */
export async function DELETE(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const limit = rateLimit(`2fa-disable:${clientIp(req)}:${ctx.user.id}`, 5, 60_000);
  if (!limit.allowed) {
    return NextResponse.json(
      { error: `Too many attempts. Try again in ${limit.retryAfter} seconds.` },
      { status: 429 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = disableSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Confirm your password" }, { status: 400 });
  }

  const user = await db.user.findUnique({
    where: { id: ctx.user.id },
    select: { password: true, totpEnabledAt: true },
  });
  if (!user?.totpEnabledAt) {
    return NextResponse.json({ error: "Two-factor is not enabled." }, { status: 400 });
  }

  // Password required: a hijacked session must not be able to remove the second
  // factor that would have stopped it.
  const ok = await bcrypt.compare(parsed.data.password, user.password);
  if (!ok) {
    return NextResponse.json({ error: "Password is not correct." }, { status: 403 });
  }

  await db.user.update({
    where: { id: ctx.user.id },
    data: {
      totpSecret: null,
      totpEnabledAt: null,
      totpLastCounter: null,
      recoveryCodeHashes: null,
    },
  });

  // Removing a security control invalidates every other session, in case one of
  // them is the attacker's.
  await revokeAllSessions(ctx.user.id);

  await logAudit({
    companyId: ctx.company?.id ?? "",
    userId: ctx.user.id,
    action: "UPDATE",
    entity: "User",
    entityId: ctx.user.id,
    changes: { twoFactorEnabled: false },
  });

  return NextResponse.json({
    ok: true,
    note: "Two-factor authentication is off. All sessions have been signed out.",
  });
}
