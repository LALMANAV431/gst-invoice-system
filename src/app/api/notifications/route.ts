import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { generateReminders } from "@/server/notify/notify.service";
import { parsePagination, paginated } from "@/lib/pagination";

/**
 * In-app notifications.
 *
 * GET returns the current list and, unless asked not to, refreshes reminders
 * first. Reminders are derived from state and de-duplicated, so generating them
 * on read is safe and means the product works without a job scheduler.
 */
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const companyId = ctx.company.id;
  const { searchParams } = new URL(req.url);
  const unreadOnly = searchParams.get("unread") === "true";
  const skipGenerate = searchParams.get("generate") === "false";

  if (!skipGenerate) {
    // A failure here must not stop the user seeing existing notifications.
    try {
      await generateReminders(companyId);
    } catch (e) {
      console.error("[notifications] reminder generation failed:", e);
    }
  }

  const where = {
    companyId,
    dismissedAt: null,
    // Company-wide notifications have no userId; personal ones match this user.
    OR: [{ userId: null }, { userId: ctx.user.id }],
    ...(unreadOnly ? { readAt: null } : {}),
  };

  const { skip, take, page, pageSize } = parsePagination(req);

  const [rows, total, unread] = await Promise.all([
    db.notification.findMany({
      where,
      // Critical first, then newest: an unbalanced-books alert must not be pushed
      // off the list by routine low-stock noise.
      orderBy: [{ severity: "asc" }, { createdAt: "desc" }],
      skip,
      take,
    }),
    db.notification.count({ where }),
    db.notification.count({ where: { ...where, readAt: null } }),
  ]);

  // "asc" on severity gives CRITICAL, INFO, WARNING alphabetically, which is not
  // the intended order, so rank explicitly.
  const rank: Record<string, number> = { CRITICAL: 0, WARNING: 1, INFO: 2 };
  const sorted = [...rows].sort(
    (a, b) =>
      (rank[a.severity] ?? 3) - (rank[b.severity] ?? 3) ||
      b.createdAt.getTime() - a.createdAt.getTime()
  );

  return NextResponse.json({ ...paginated(sorted, total, page, pageSize), unread });
}

const patchSchema = z.object({
  action: z.enum(["READ", "READ_ALL", "DISMISS"]),
  id: z.string().optional(),
});

export async function PATCH(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid request" }, { status: 400 });
  }

  const companyId = ctx.company.id;
  const { action, id } = parsed.data;

  // Marking something read is not a business write, so this is deliberately not
  // behind writeGuard: a read-only VIEWER still needs to clear their own alerts.
  if (action === "READ_ALL") {
    const result = await db.notification.updateMany({
      where: { companyId, readAt: null, OR: [{ userId: null }, { userId: ctx.user.id }] },
      data: { readAt: new Date() },
    });
    return NextResponse.json({ ok: true, updated: result.count });
  }

  if (!id) return NextResponse.json({ error: "id is required" }, { status: 400 });

  // Scoped by companyId so one tenant cannot dismiss another's notification.
  const result = await db.notification.updateMany({
    where: { id, companyId },
    data: action === "READ" ? { readAt: new Date() } : { dismissedAt: new Date() },
  });

  if (result.count === 0) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
