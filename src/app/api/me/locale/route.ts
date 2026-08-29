import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { normaliseLocale } from "@/lib/i18n";

const schema = z.object({ locale: z.enum(["en", "hi"]) });

/**
 * Change the signed-in user's UI language.
 *
 * Persisted on the user rather than in a cookie so the choice follows them to
 * any device. Deliberately not gated by `writeGuard()`: a read-only VIEWER still
 * needs to be able to read the app in their own language, and a suspended
 * company's users should still be able to see why they are suspended.
 */
export async function PUT(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "Unsupported language. Choose 'en' or 'hi'." },
      { status: 400 }
    );
  }

  const locale = normaliseLocale(parsed.data.locale);
  await db.user.update({ where: { id: ctx.user.id }, data: { locale } });

  return NextResponse.json({ ok: true, locale });
}
