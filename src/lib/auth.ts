import jwt from "jsonwebtoken";
import { cookies } from "next/headers";
import { db } from "./db";

const SECRET = process.env.JWT_SECRET || "dev-secret-change-me";
const COOKIE_NAME = "gst_session";

export type SessionPayload = {
  userId: string;
  email: string;
  companyId?: string;
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

export async function getCurrentUserAndCompany() {
  const s = await getSession();
  if (!s) return null;
  const user = await db.user.findUnique({
    where: { id: s.userId },
    include: { companies: { orderBy: { createdAt: "asc" } } },
  });
  if (!user) return null;
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
  return user;
}
