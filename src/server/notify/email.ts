/**
 * Email delivery.
 *
 * Same shape as the AI and payment layers: a `mock` transport is the default, so
 * every send path — templating, logging, failure handling — runs in development
 * without SMTP credentials and without emailing a real customer by accident.
 *
 * WHY NO NODEMAILER
 * -----------------
 * SMTP would pull in a dependency and, more importantly, a long-lived socket that
 * does not suit serverless request handling. An HTTP transactional API (Resend,
 * Postmark, SES) is one `fetch` and works everywhere this app can be deployed.
 * SMTP config is still read so an operator who only has SMTP is told plainly that
 * it is unsupported rather than silently dropping their mail.
 */

import { db } from "@/lib/db";

export type EmailMessage = {
  to: string;
  subject: string;
  /** Plain text. HTML is generated from this, so callers cannot inject markup. */
  text: string;
  replyTo?: string;
};

export type SendResult = {
  status: "SENT" | "FAILED" | "SKIPPED";
  provider: string;
  error?: string;
};

export function emailProvider(): "mock" | "resend" | "unsupported-smtp" {
  if (process.env.RESEND_API_KEY) return "resend";
  // Configured SMTP is reported rather than ignored: silently not sending is
  // worse than saying it is unsupported.
  if (process.env.SMTP_HOST) return "unsupported-smtp";
  return "mock";
}

export function emailConfigured(): boolean {
  return emailProvider() === "resend";
}

function fromAddress(): string {
  return process.env.SMTP_FROM ?? process.env.EMAIL_FROM ?? "GST Invoice <noreply@example.com>";
}

/** Reject obviously invalid addresses before spending a send. */
export function isValidEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(value.trim());
}

/**
 * Escape text before embedding it in the HTML part.
 *
 * Invoice notes and party names are user-controlled and end up in an email body.
 * An unescaped `<script>` or broken tag would at best corrupt the layout and at
 * worst be an injection vector in webmail clients.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function toHtml(text: string): string {
  const paragraphs = text
    .split(/\n{2,}/)
    .map((p) => `<p style="margin:0 0 12px">${escapeHtml(p).replace(/\n/g, "<br>")}</p>`)
    .join("");

  return `<!doctype html><html><body style="margin:0;padding:24px;background:#f1f5f9;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#0f172a">
<div style="max-width:560px;margin:0 auto;background:#fff;border-radius:12px;padding:24px;font-size:14px;line-height:1.6">
${paragraphs}
</div></body></html>`;
}

/**
 * Send an email and record the attempt.
 *
 * Never throws: a failed notification must not fail the business operation that
 * triggered it. An invoice is still valid if its email bounced.
 */
export async function sendEmail(
  companyId: string,
  message: EmailMessage,
  source?: { type: string; id: string }
): Promise<SendResult> {
  const provider = emailProvider();

  if (!isValidEmail(message.to)) {
    await log(companyId, message, "FAILED", provider, "Invalid recipient address", source);
    return { status: "FAILED", provider, error: "Invalid recipient address" };
  }

  if (provider === "mock" || provider === "unsupported-smtp") {
    const reason =
      provider === "mock"
        ? "No email provider configured (set RESEND_API_KEY)"
        : "SMTP is configured but not supported; use RESEND_API_KEY";

    // Logged as SKIPPED, not SENT: the log must never claim a delivery that did
    // not happen.
    await log(companyId, message, "SKIPPED", provider, reason, source);
    return { status: "SKIPPED", provider, error: reason };
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 15_000);

  try {
    const res = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${process.env.RESEND_API_KEY}`,
      },
      body: JSON.stringify({
        from: fromAddress(),
        to: [message.to],
        subject: message.subject,
        text: message.text,
        html: toHtml(message.text),
        ...(message.replyTo ? { reply_to: message.replyTo } : {}),
      }),
      signal: controller.signal,
    });

    if (!res.ok) {
      const error = `Provider returned HTTP ${res.status}`;
      await log(companyId, message, "FAILED", provider, error, source);
      return { status: "FAILED", provider, error };
    }

    await log(companyId, message, "SENT", provider, undefined, source);
    return { status: "SENT", provider };
  } catch (e) {
    const error =
      (e as Error).name === "AbortError" ? "Provider timed out" : "Could not reach the provider";
    await log(companyId, message, "FAILED", provider, error, source);
    return { status: "FAILED", provider, error };
  } finally {
    clearTimeout(timer);
  }
}

async function log(
  companyId: string,
  message: EmailMessage,
  status: string,
  provider: string,
  error?: string,
  source?: { type: string; id: string }
): Promise<void> {
  try {
    await db.messageLog.create({
      data: {
        companyId,
        channel: "EMAIL",
        status,
        recipient: message.to,
        subject: message.subject,
        // Truncated: the full body can contain customer data we have no reason
        // to store a second copy of.
        preview: message.text.slice(0, 300),
        provider,
        error: error ?? null,
        sourceType: source?.type ?? null,
        sourceId: source?.id ?? null,
      },
    });
  } catch (e) {
    console.error("[email] could not write message log:", e);
  }
}

/**
 * Build a WhatsApp share URL.
 *
 * Deliberately a `wa.me` link rather than the Cloud API: it needs no credentials,
 * costs nothing per message, and works for a shopkeeper on day one. The Cloud API
 * requires business verification and approved templates, which is a reasonable
 * upgrade later but a poor default.
 */
export function whatsappShareUrl(phone: string, text: string): string {
  const digits = phone.replace(/\D/g, "");
  // wa.me needs a country code; assume India when a bare 10-digit number is given.
  const withCountry = digits.length === 10 ? `91${digits}` : digits;
  return `https://wa.me/${withCountry}?text=${encodeURIComponent(text)}`;
}
