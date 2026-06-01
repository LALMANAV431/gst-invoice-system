import { NextResponse } from "next/server";

type Ctx = {
  user: { role?: string | null } | null;
  company: { isSuspended?: boolean } | null;
} | null;

/**
 * Guard for write/mutation API routes.
 * - Blocks suspended companies (403)
 * - Blocks read-only VIEWER role (403)
 * Returns a NextResponse to short-circuit, or null if the request may proceed.
 */
export function writeGuard(ctx: Ctx): NextResponse | null {
  if (!ctx?.company) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  if (ctx.company.isSuspended) {
    return NextResponse.json(
      { error: "This company account is suspended. Contact support." },
      { status: 403 }
    );
  }
  if (ctx.user?.role === "VIEWER") {
    return NextResponse.json(
      { error: "Your role is read-only and cannot make changes." },
      { status: 403 }
    );
  }
  return null;
}
