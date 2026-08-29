import { NextResponse } from "next/server";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { writeGuard } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { sendPaymentReminder } from "@/server/notify/notify.service";
import { clientIp, rateLimit } from "@/lib/rate-limit";

/**
 * Send a payment reminder for an invoice.
 *
 * Rate limited per company as well as per IP: an accidental loop that emails a
 * customer fifty times is a reputation problem, and the outbound address is
 * shared across all tenants.
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;

  const companyId = ctx.company.id;

  const perCompany = rateLimit(`reminder:${companyId}`, 30, 60_000);
  const perIp = rateLimit(`reminder-ip:${clientIp(req)}`, 30, 60_000);
  if (!perCompany.allowed || !perIp.allowed) {
    const retryAfter = Math.max(perCompany.retryAfter, perIp.retryAfter);
    return NextResponse.json(
      { error: `Too many reminders sent. Try again in ${retryAfter} seconds.` },
      { status: 429, headers: { "Retry-After": String(retryAfter) } }
    );
  }

  const result = await sendPaymentReminder(companyId, params.id);

  if (!result.ok) {
    return NextResponse.json({ error: result.error }, { status: 400 });
  }

  await logAudit({
    companyId,
    userId: ctx.user.id,
    action: "UPDATE",
    entity: "Invoice",
    entityId: params.id,
    changes: { reminderSent: true, emailStatus: result.email.status },
  });

  return NextResponse.json({
    ok: true,
    email: result.email,
    // A wa.me link works with no credentials and no per-message cost, so it is
    // offered even when email could not be sent.
    whatsappUrl: result.whatsappUrl,
    message: result.message,
  });
}
