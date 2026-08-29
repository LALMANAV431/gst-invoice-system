/**
 * Notifications: in-app records, email delivery and outbound webhooks.
 *
 * DESIGN
 * ------
 * Reminders are DERIVED FROM STATE, not scheduled events. `generateReminders()`
 * looks at the current position (overdue invoices, low stock, un-invoiced GRNs)
 * and creates any notification that is missing. That means:
 *
 *   - it is safe to run repeatedly — a `dedupeKey` unique per company makes
 *     re-creation a no-op, so no cron-lock is needed;
 *   - a reminder disappears on its own when the underlying condition clears,
 *     rather than needing a compensating "cancel" event;
 *   - it works without a job queue, which this deployment does not have yet.
 *
 * The trade-off is that reminders only appear when something triggers a run
 * (a page load or a cron hit), rather than at an exact time. For "this invoice is
 * overdue" that is the right trade.
 */

import crypto from "node:crypto";
import { db } from "@/lib/db";
import { toRupees } from "@/lib/money";
import { sendEmail } from "./email";
import { getTrialBalance } from "../ledger";
import { getGoodsReceivedNotInvoiced } from "../services/order.service";

export type NotificationKind =
  | "INVOICE_OVERDUE"
  | "PAYMENT_RECEIVED"
  | "LOW_STOCK"
  | "GST_DUE"
  | "GRN_NOT_INVOICED"
  | "BOOKS_UNBALANCED"
  | "SUBSCRIPTION"
  | "AI_BUDGET"
  | "SYSTEM";

export type Severity = "INFO" | "WARNING" | "CRITICAL";

export type CreateNotification = {
  companyId: string;
  kind: NotificationKind;
  severity?: Severity;
  title: string;
  body: string;
  actionUrl?: string;
  dedupeKey: string;
  userId?: string | null;
  sourceType?: string;
  sourceId?: string;
};

/**
 * Create a notification unless one with the same dedupe key already exists.
 *
 * Returns null when it was a duplicate, so callers can count what was genuinely
 * new without treating a repeat as an error.
 */
export async function notify(input: CreateNotification) {
  try {
    return await db.notification.create({
      data: {
        companyId: input.companyId,
        kind: input.kind,
        severity: input.severity ?? "INFO",
        title: input.title,
        body: input.body,
        actionUrl: input.actionUrl ?? null,
        dedupeKey: input.dedupeKey,
        userId: input.userId ?? null,
        sourceType: input.sourceType ?? null,
        sourceId: input.sourceId ?? null,
      },
    });
  } catch {
    // Unique violation on (companyId, dedupeKey) — already notified.
    return null;
  }
}

export type ReminderSummary = {
  created: number;
  byKind: Record<string, number>;
};

/**
 * Look at the company's current position and create any missing reminders.
 *
 * Idempotent. Safe to call from a cron hit, an admin action, or a dashboard load.
 */
export async function generateReminders(companyId: string): Promise<ReminderSummary> {
  const byKind: Record<string, number> = {};
  let created = 0;

  const record = (kind: string, result: unknown) => {
    if (result === null) return;
    created += 1;
    byKind[kind] = (byKind[kind] ?? 0) + 1;
  };

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // --- Overdue invoices ---------------------------------------------------
  const overdue = await db.invoice.findMany({
    where: {
      companyId,
      status: { notIn: ["PAID", "CANCELLED"] },
      dueDate: { not: null, lt: today },
    },
    select: {
      id: true,
      number: true,
      dueDate: true,
      grandTotalPaise: true,
      amountPaidPaise: true,
      party: { select: { name: true } },
    },
    orderBy: { dueDate: "asc" },
    take: 100,
  });

  for (const inv of overdue) {
    const days = Math.floor((today.getTime() - inv.dueDate!.getTime()) / 86_400_000);
    // Bucketed so a customer is nudged at 1, 7, 30 and 60 days rather than every
    // single day, which would be noise the user learns to ignore.
    const bucket = days >= 60 ? 60 : days >= 30 ? 30 : days >= 7 ? 7 : 1;
    const outstanding = inv.grandTotalPaise - inv.amountPaidPaise;

    record(
      "INVOICE_OVERDUE",
      await notify({
        companyId,
        kind: "INVOICE_OVERDUE",
        severity: bucket >= 30 ? "CRITICAL" : "WARNING",
        title: `${inv.number} is ${days} day${days === 1 ? "" : "s"} overdue`,
        body: `${inv.party.name} owes Rs ${toRupees(outstanding).toFixed(2)}.`,
        actionUrl: `/invoices/${inv.id}`,
        // The bucket is part of the key, so each escalation is a new reminder.
        dedupeKey: `INVOICE_OVERDUE:${inv.id}:${bucket}`,
        sourceType: "Invoice",
        sourceId: inv.id,
      })
    );
  }

  // --- Low stock ----------------------------------------------------------
  const lowStock = await db.item.findMany({
    where: { companyId, lowStockAlert: { gt: 0 } },
    select: { id: true, name: true, currentStock: true, lowStockAlert: true },
    take: 200,
  });

  const below = lowStock.filter((i) => i.currentStock <= i.lowStockAlert);
  for (const item of below) {
    record(
      "LOW_STOCK",
      await notify({
        companyId,
        kind: "LOW_STOCK",
        severity: item.currentStock <= 0 ? "CRITICAL" : "WARNING",
        title:
          item.currentStock <= 0
            ? `${item.name} is out of stock`
            : `${item.name} is running low`,
        body: `${item.currentStock} left, reorder level is ${item.lowStockAlert}.`,
        actionUrl: `/items/${item.id}`,
        // Keyed on whether it is low or fully out, so crossing to zero re-notifies.
        dedupeKey: `LOW_STOCK:${item.id}:${item.currentStock <= 0 ? "OUT" : "LOW"}`,
        sourceType: "Item",
        sourceId: item.id,
      })
    );
  }

  // --- GST filing reminder ------------------------------------------------
  // GSTR-1 and GSTR-3B are due in the month AFTER the period, around the 11th
  // and 20th. Reminders are raised from the 5th so there is time to act.
  if (today.getDate() >= 5) {
    const period = new Date(today.getFullYear(), today.getMonth() - 1, 1);
    const label = period.toLocaleDateString("en-IN", { month: "long", year: "numeric" });

    record(
      "GST_DUE",
      await notify({
        companyId,
        kind: "GST_DUE",
        severity: today.getDate() >= 15 ? "CRITICAL" : "WARNING",
        title: `GST returns for ${label} are due`,
        body: "GSTR-1 is due around the 11th and GSTR-3B around the 20th. Check the GST Summary before filing.",
        actionUrl: "/reports/gst-summary",
        dedupeKey: `GST_DUE:${period.getFullYear()}-${period.getMonth() + 1}`,
      })
    );
  }

  // --- Goods received but not invoiced ------------------------------------
  const grni = await getGoodsReceivedNotInvoiced(companyId);
  // Only nudge once the receipt is old enough that a bill should have arrived.
  const stale = grni.rows.filter((r) => r.ageDays >= 7);
  if (stale.length > 0) {
    record(
      "GRN_NOT_INVOICED",
      await notify({
        companyId,
        kind: "GRN_NOT_INVOICED",
        severity: "WARNING",
        title: `${stale.length} goods receipt${stale.length === 1 ? "" : "s"} still not invoiced`,
        body: `You hold goods worth Rs ${toRupees(
          stale.reduce((s, r) => s + r.valuePaise, 0)
        ).toFixed(2)} with no payable recorded. Convert each GRN when the bill arrives.`,
        actionUrl: "/orders?docType=GRN",
        // Weekly, so it recurs until dealt with without being daily noise.
        dedupeKey: `GRN_NOT_INVOICED:${isoWeek(today)}`,
      })
    );
  }

  // --- Books out of balance ----------------------------------------------
  // The most important alert in the product: if this fires, no financial
  // statement can be trusted.
  const tb = await getTrialBalance(companyId, new Date());
  if (!tb.isBalanced) {
    record(
      "BOOKS_UNBALANCED",
      await notify({
        companyId,
        kind: "BOOKS_UNBALANCED",
        severity: "CRITICAL",
        title: "The books do not balance",
        body: `Debits and credits differ by Rs ${toRupees(Math.abs(tb.differencePaise)).toFixed(
          2
        )}. Reports are unreliable until this is resolved — please contact support.`,
        actionUrl: "/reports/trial-balance",
        dedupeKey: `BOOKS_UNBALANCED:${tb.differencePaise}`,
      })
    );
  }

  return { created, byKind };
}

/** ISO week key, used to make a reminder recur weekly rather than daily. */
function isoWeek(date: Date): string {
  const d = new Date(Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()));
  const dayNumber = d.getUTCDay() || 7;
  d.setUTCDate(d.getUTCDate() + 4 - dayNumber);
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((d.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

// ---------------------------------------------------------------------------
// Payment reminder to the customer
// ---------------------------------------------------------------------------

/**
 * Email a payment reminder for an overdue invoice.
 *
 * Returns a WhatsApp URL alongside the email result, because for this audience
 * WhatsApp is the channel that actually gets read — and a `wa.me` link costs
 * nothing and needs no approval.
 */
export async function sendPaymentReminder(companyId: string, invoiceId: string) {
  const invoice = await db.invoice.findFirst({
    where: { id: invoiceId, companyId },
    select: {
      id: true,
      number: true,
      date: true,
      dueDate: true,
      grandTotalPaise: true,
      amountPaidPaise: true,
      status: true,
      party: { select: { name: true, email: true, phone: true } },
      company: { select: { name: true, upiId: true, email: true } },
    },
  });
  if (!invoice) return { ok: false as const, error: "Invoice not found" };
  if (invoice.status === "PAID") return { ok: false as const, error: "This invoice is paid" };
  if (invoice.status === "CANCELLED") {
    return { ok: false as const, error: "This invoice is cancelled" };
  }

  const outstanding = invoice.grandTotalPaise - invoice.amountPaidPaise;
  const amount = `Rs ${toRupees(outstanding).toFixed(2)}`;

  const lines = [
    `Dear ${invoice.party.name},`,
    `This is a reminder that invoice ${invoice.number} for ${amount} is outstanding${
      invoice.dueDate ? ` (due ${invoice.dueDate.toLocaleDateString("en-IN")})` : ""
    }.`,
    invoice.company.upiId ? `You can pay by UPI to ${invoice.company.upiId}.` : "",
    "If you have already paid, please ignore this message and let us know.",
    `Thank you,\n${invoice.company.name}`,
  ].filter(Boolean);

  const text = lines.join("\n\n");

  const email = invoice.party.email
    ? await sendEmail(
        companyId,
        {
          to: invoice.party.email,
          subject: `Payment reminder: invoice ${invoice.number} (${amount})`,
          text,
          replyTo: invoice.company.email ?? undefined,
        },
        { type: "Invoice", id: invoice.id }
      )
    : { status: "SKIPPED" as const, provider: "none", error: "Customer has no email address" };

  const { whatsappShareUrl } = await import("./email");

  return {
    ok: true as const,
    email,
    whatsappUrl: invoice.party.phone ? whatsappShareUrl(invoice.party.phone, text) : null,
    message: text,
  };
}

// ---------------------------------------------------------------------------
// Outbound webhooks
// ---------------------------------------------------------------------------

/**
 * Sign an outbound payload so the receiver can verify it came from us.
 *
 * Same scheme we require of inbound gateway webhooks: HMAC-SHA256 over the exact
 * body. Anything less asks integrators to trust an unauthenticated POST.
 */
export function signOutbound(body: string, secret: string): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

/** Generate a secret for a new webhook subscription. */
export function generateWebhookSecret(): string {
  return `whsec_${crypto.randomBytes(24).toString("base64url")}`;
}

/**
 * Deliver an event to every matching webhook for a company.
 *
 * Never throws: a subscriber's broken endpoint must not fail the business
 * operation that produced the event.
 */
export async function dispatchWebhook(
  companyId: string,
  eventType: string,
  data: Record<string, unknown>
): Promise<void> {
  let hooks;
  try {
    hooks = await db.outboundWebhook.findMany({
      where: { companyId, active: true },
    });
  } catch {
    return;
  }

  const matching = hooks.filter(
    (h) => h.events === "*" || h.events.split(",").map((e) => e.trim()).includes(eventType)
  );
  if (matching.length === 0) return;

  const body = JSON.stringify({
    event: eventType,
    createdAt: new Date().toISOString(),
    data,
  });

  await Promise.all(
    matching.map(async (hook) => {
      const delivery = await db.webhookDelivery
        .create({
          data: { webhookId: hook.id, eventType, payload: body.slice(0, 20_000) },
        })
        .catch(() => null);

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 10_000);

      try {
        const res = await fetch(hook.url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "X-Signature": signOutbound(body, hook.secret),
            "X-Event-Type": eventType,
          },
          body,
          signal: controller.signal,
        });

        const ok = res.ok;
        await Promise.all([
          delivery
            ? db.webhookDelivery.update({
                where: { id: delivery.id },
                data: {
                  status: ok ? "DELIVERED" : "FAILED",
                  statusCode: res.status,
                  attempts: 1,
                  deliveredAt: ok ? new Date() : null,
                  error: ok ? null : `HTTP ${res.status}`,
                },
              })
            : Promise.resolve(),
          db.outboundWebhook.update({
            where: { id: hook.id },
            data: {
              lastStatus: res.status,
              lastAttemptAt: new Date(),
              // Auto-disable after repeated failure, so a dead endpoint stops
              // consuming a request on every event forever.
              consecutiveFailures: ok ? 0 : hook.consecutiveFailures + 1,
              active: ok ? true : hook.consecutiveFailures + 1 < 20,
            },
          }),
        ]);
      } catch (e) {
        const error =
          (e as Error).name === "AbortError" ? "Timed out" : "Could not reach the endpoint";
        await Promise.all([
          delivery
            ? db.webhookDelivery.update({
                where: { id: delivery.id },
                data: { status: "FAILED", attempts: 1, error },
              })
            : Promise.resolve(),
          db.outboundWebhook.update({
            where: { id: hook.id },
            data: {
              lastAttemptAt: new Date(),
              consecutiveFailures: hook.consecutiveFailures + 1,
              active: hook.consecutiveFailures + 1 < 20,
            },
          }),
        ]);
      } finally {
        clearTimeout(timer);
      }
    })
  );
}
