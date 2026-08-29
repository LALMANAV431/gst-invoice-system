import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { writeGuard } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { generateWebhookSecret } from "@/server/notify/notify.service";

/**
 * Tenant-configured outbound webhooks, so a business can push events into their
 * own systems.
 *
 * The secret is returned ONCE, on creation. Storing it retrievable would mean a
 * compromised session leaks every integration's signing key, and there is no need
 * — the tenant can rotate it.
 */

const EVENT_NAMES = [
  "invoice.created",
  "invoice.paid",
  "payment.received",
  "purchase.created",
  "stock.low",
  "order.created",
] as const;

const createSchema = z.object({
  url: z
    .string()
    .url("Enter a valid URL")
    .refine((u) => u.startsWith("https://"), "The URL must use HTTPS"),
  events: z.array(z.enum(EVENT_NAMES)).optional(),
});

export async function GET() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const hooks = await db.outboundWebhook.findMany({
    where: { companyId: ctx.company.id },
    // `secret` is deliberately excluded.
    select: {
      id: true,
      url: true,
      events: true,
      active: true,
      lastStatus: true,
      lastAttemptAt: true,
      consecutiveFailures: true,
      createdAt: true,
      _count: { select: { deliveries: true } },
    },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({ webhooks: hooks, availableEvents: EVENT_NAMES });
}

export async function POST(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;

  // Only an admin should be able to point company data at an external URL.
  if (ctx.user.role !== "ADMIN") {
    return NextResponse.json(
      { error: "Only an admin can configure webhooks." },
      { status: 403 }
    );
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  // Block internal addresses: an outbound webhook that can be pointed at
  // localhost or a cloud metadata endpoint is an SSRF primitive.
  const host = new URL(parsed.data.url).hostname.toLowerCase();
  const blockedHost =
    host === "localhost" ||
    host === "127.0.0.1" ||
    host === "0.0.0.0" ||
    host === "169.254.169.254" ||
    host.endsWith(".localhost") ||
    host.endsWith(".internal") ||
    /^10\./.test(host) ||
    /^192\.168\./.test(host) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(host);

  if (blockedHost) {
    return NextResponse.json(
      { error: "That host is not allowed. Use a public HTTPS endpoint." },
      { status: 400 }
    );
  }

  const secret = generateWebhookSecret();

  const hook = await db.outboundWebhook.create({
    data: {
      companyId: ctx.company.id,
      url: parsed.data.url,
      events: parsed.data.events?.length ? parsed.data.events.join(",") : "*",
      secret,
    },
  });

  await logAudit({
    companyId: ctx.company.id,
    userId: ctx.user.id,
    action: "CREATE",
    entity: "OutboundWebhook",
    entityId: hook.id,
    changes: { url: hook.url, events: hook.events },
  });

  return NextResponse.json({
    id: hook.id,
    url: hook.url,
    events: hook.events,
    // Shown once. Never returned again.
    secret,
    note:
      "Save this secret now — it will not be shown again. Verify our X-Signature header " +
      "as HMAC-SHA256 of the raw request body using this secret.",
  });
}
