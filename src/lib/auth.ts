import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { db } from "./db";

const DEFAULT_DEV_SECRET = "dev-secret-change-me";
const SECRET = process.env.JWT_SECRET || DEFAULT_DEV_SECRET;

// Fail fast in production if the secret is missing or left at the insecure
// default — prevents forgeable session tokens.
if (process.env.NODE_ENV === "production" && (!process.env.JWT_SECRET || SECRET === DEFAULT_DEV_SECRET)) {
  throw new Error(
    "JWT_SECRET is not set (or uses the insecure default). Set a long, random JWT_SECRET environment variable before running in production."
  );
}

const COOKIE_NAME = "gst_session";

export type SessionPayload = {
  userId: string;
  email: string;
  companyId?: string;
  impersonatorId?: string;
  /**
   * Snapshot of `User.tokenVersion` when the token was issued.
   *
   * Previously a JWT was valid for its full 30 days on signature alone, so
   * logout only deleted the cookie and a captured token kept working. Bumping
   * `User.tokenVersion` now invalidates every token issued before the bump -
   * which is what makes logout-everywhere and password changes meaningful.
   *
   * Optional so tokens issued before this field existed still resolve; they are
   * treated as version 0.
   */
  tokenVersion?: number;
};

export function signSession(payload: SessionPayload): string {
  return jwt.sign(payload, SECRET, { expiresIn: "30d" });
}

export function verifySession(token: string): SessionPayload | null {
  try {
    return jwt.verify(token, SECRET) as SessionPayload;
  } catch {
    return null;
  }
}

export async function setSessionCookie(payload: SessionPayload) {
  const token = signSession(payload);
  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    sameSite: "lax",
    path: "/",
    // Without this the session cookie could be sent over plain HTTP and
    // captured in transit. Not set in development, where there is no TLS and
    // the browser would refuse to store the cookie at all.
    secure: process.env.NODE_ENV === "production",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSessionCookie() {
  cookies().delete(COOKIE_NAME);
}

export async function getSession(): Promise<SessionPayload | null> {
  const c = cookies().get(COOKIE_NAME);
  if (!c) return null;
  return verifySession(c.value);
}

export async function requireSession(): Promise<SessionPayload> {
  const s = await getSession();
  if (!s) throw new Error("UNAUTHORIZED");
  return s;
}

/**
 * Reject a session whose token was issued before the user's current
 * `tokenVersion`. This is what gives the system real session revocation.
 */
function isTokenCurrent(session: SessionPayload, userTokenVersion: number): boolean {
  return (session.tokenVersion ?? 0) >= userTokenVersion;
}

export async function getCurrentUserAndCompany() {
  const s = await getSession();
  if (!s) return null;
  const user = await db.user.findUnique({
    where: { id: s.userId },
    include: { companies: { orderBy: { createdAt: "asc" } } },
  });
  if (!user) return null;
  if (!isTokenCurrent(s, user.tokenVersion)) return null;

  const company = s.companyId
    ? user.companies.find((c) => c.id === s.companyId) ?? user.companies[0]
    : user.companies[0];
  return { user, company, companies: user.companies };
}

/** Returns the current user if they are a platform super-admin, else null. */
export async function getSuperAdmin() {
  const s = await getSession();
  if (!s) return null;
  const user = await db.user.findUnique({ where: { id: s.userId } });
  if (!user || !user.isSuperAdmin) return null;
  if (!isTokenCurrent(s, user.tokenVersion)) return null;
  return user;
}

/**
 * Invalidate every existing session for a user.
 *
 * Call on logout-everywhere, password change, or when suspending an account.
 */
export async function revokeAllSessions(userId: string): Promise<void> {
  await db.user.update({
    where: { id: userId },
    data: { tokenVersion: { increment: 1 } },
  });
}
