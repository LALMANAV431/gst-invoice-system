/**
 * Payment gateway abstraction.
 *
 * Same principle as the AI layer: `mock` is the default, so the whole payment
 * flow — link creation, webhook handling, signature verification, idempotency,
 * receipt posting — is exercisable with no credentials and no real money.
 *
 * SIGNATURE VERIFICATION IS THE SECURITY BOUNDARY.
 * A webhook endpoint has to be publicly reachable, so anyone can POST to it.
 * Without verifying the gateway's HMAC signature, a forged request could mark any
 * invoice paid. Verification uses a TIMING-SAFE comparison, because a plain `===`
 * on a secret-derived digest leaks information through response timing.
 */

import crypto from "node:crypto";

export type GatewayId = "mock" | "razorpay" | "stripe";

export type CreateOrderResult = {
  providerOrderId: string;
  /** Public key the browser checkout needs. Null in mock mode. */
  publicKey: string | null;
  amountPaise: number;
  currency: "INR";
};

export type VerifiedEvent = {
  eventId: string;
  eventType: string;
  /** Our own reference, round-tripped through the gateway. */
  referenceId: string | null;
  providerPaymentId: string | null;
  amountPaise: number | null;
  /** Normalised outcome, so callers do not switch on provider-specific strings. */
  outcome: "PAID" | "FAILED" | "REFUNDED" | "OTHER";
};

export class GatewayError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GatewayError";
  }
}

/** Raised when a webhook's signature does not verify. Always a 400, never a 500. */
export class InvalidSignatureError extends Error {
  constructor() {
    super("Webhook signature verification failed");
    this.name = "InvalidSignatureError";
  }
}

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export function configuredGateway(): GatewayId {
  const raw = (process.env.PAYMENT_PROVIDER || "").toLowerCase();
  if (raw === "razorpay" && process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    return "razorpay";
  }
  if (raw === "stripe" && process.env.STRIPE_SECRET_KEY) return "stripe";
  // Unconfigured or unknown falls back to mock rather than failing a request.
  return "mock";
}

export function gatewayIsLive(): boolean {
  const id = configuredGateway();
  if (id === "mock") return false;
  // Razorpay test keys are prefixed rzp_test_; Stripe test keys sk_test_.
  const key = process.env.RAZORPAY_KEY_ID ?? process.env.STRIPE_SECRET_KEY ?? "";
  return !key.includes("_test_");
}

// ---------------------------------------------------------------------------
// Signature verification
// ---------------------------------------------------------------------------

/**
 * Compare two hex digests without leaking length or content through timing.
 *
 * `crypto.timingSafeEqual` throws when the buffers differ in length, so length is
 * checked first — and a length mismatch is itself a failed verification.
 */
export function timingSafeCompare(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

/**
 * Verify a Razorpay webhook.
 *
 * Razorpay signs the RAW request body with the webhook secret using HMAC-SHA256
 * and sends it in `x-razorpay-signature`. The raw body must be used: re-serialising
 * parsed JSON changes key order and whitespace, and the digest would never match.
 */
export function verifyRazorpayWebhook(rawBody: string, signature: string, secret: string): boolean {
  if (!signature || !secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return timingSafeCompare(expected, signature);
}

/**
 * Verify a Razorpay checkout callback (the browser-side handler response).
 *
 * Signed over `order_id|payment_id`, with the API secret rather than the webhook
 * secret. This is what proves a client-reported success is genuine — a browser
 * response on its own can be fabricated by the user.
 */
export function verifyRazorpayCheckout(
  orderId: string,
  paymentId: string,
  signature: string,
  secret: string
): boolean {
  if (!orderId || !paymentId || !signature || !secret) return false;
  const expected = crypto
    .createHmac("sha256", secret)
    .update(`${orderId}|${paymentId}`)
    .digest("hex");
  return timingSafeCompare(expected, signature);
}

/**
 * Verify a mock webhook.
 *
 * Mock mode still requires a signature, using JWT_SECRET as the shared secret, so
 * the verification path is genuinely exercised in development. Making mock skip
 * verification would leave the most security-critical code untested until
 * production.
 */
export function verifyMockWebhook(rawBody: string, signature: string): boolean {
  const secret = process.env.JWT_SECRET ?? "";
  if (!secret) return false;
  const expected = crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
  return timingSafeCompare(expected, signature);
}

/** Sign a payload the way the mock gateway would. Used by tests and the simulator. */
export function signMockWebhook(rawBody: string): string {
  const secret = process.env.JWT_SECRET ?? "";
  return crypto.createHmac("sha256", secret).update(rawBody).digest("hex");
}

// ---------------------------------------------------------------------------
// Order creation
// ---------------------------------------------------------------------------

/**
 * Create a gateway order for an amount.
 *
 * `referenceId` is our own identifier (a payment link token or subscription id);
 * it comes back on the webhook so the event can be matched to a record without
 * trusting anything else in the payload.
 */
export async function createGatewayOrder(opts: {
  amountPaise: number;
  referenceId: string;
  description: string;
}): Promise<CreateOrderResult> {
  const gateway = configuredGateway();

  if (opts.amountPaise <= 0) {
    throw new GatewayError("Amount must be greater than zero");
  }

  if (gateway === "mock") {
    return {
      providerOrderId: `mock_order_${opts.referenceId}`,
      publicKey: null,
      amountPaise: opts.amountPaise,
      currency: "INR",
    };
  }

  if (gateway === "razorpay") {
    const keyId = process.env.RAZORPAY_KEY_ID!;
    const keySecret = process.env.RAZORPAY_KEY_SECRET!;
    const auth = Buffer.from(`${keyId}:${keySecret}`).toString("base64");

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), 20_000);

    try {
      const res = await fetch("https://api.razorpay.com/v1/orders", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Basic ${auth}`,
        },
        body: JSON.stringify({
          // Razorpay works in the smallest currency unit, which is paise — the
          // same unit this application stores, so no conversion is needed.
          amount: opts.amountPaise,
          currency: "INR",
          receipt: opts.referenceId,
          notes: { referenceId: opts.referenceId, description: opts.description },
        }),
        signal: controller.signal,
      });

      if (!res.ok) {
        // The gateway body can echo our notes; do not surface it to the client.
        throw new GatewayError(`Payment gateway rejected the request (HTTP ${res.status}).`);
      }

      const data = await res.json();
      return {
        providerOrderId: data.id,
        publicKey: keyId,
        amountPaise: opts.amountPaise,
        currency: "INR",
      };
    } catch (e) {
      if (e instanceof GatewayError) throw e;
      if ((e as Error).name === "AbortError") {
        throw new GatewayError("The payment gateway timed out.");
      }
      throw new GatewayError("Could not reach the payment gateway.");
    } finally {
      clearTimeout(timer);
    }
  }

  throw new GatewayError(`The ${gateway} gateway is not implemented yet.`);
}

// ---------------------------------------------------------------------------
// Webhook parsing
// ---------------------------------------------------------------------------

/**
 * Verify and normalise an incoming webhook.
 *
 * Verification happens on the RAW body before any parsing, and returns a
 * provider-agnostic shape so handlers do not depend on gateway payload layouts.
 */
export function parseWebhook(rawBody: string, headers: Headers): VerifiedEvent {
  const gateway = configuredGateway();

  if (gateway === "razorpay") {
    const signature = headers.get("x-razorpay-signature") ?? "";
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET ?? "";
    if (!verifyRazorpayWebhook(rawBody, signature, secret)) {
      throw new InvalidSignatureError();
    }
    return normaliseRazorpay(JSON.parse(rawBody));
  }

  const signature = headers.get("x-mock-signature") ?? "";
  if (!verifyMockWebhook(rawBody, signature)) {
    throw new InvalidSignatureError();
  }
  return normaliseMock(JSON.parse(rawBody));
}

function normaliseRazorpay(payload: Record<string, any>): VerifiedEvent {
  const event: string = payload.event ?? "unknown";
  const entity =
    payload.payload?.payment?.entity ?? payload.payload?.order?.entity ?? {};

  const outcome: VerifiedEvent["outcome"] =
    event === "payment.captured"
      ? "PAID"
      : event === "payment.failed"
        ? "FAILED"
        : event.startsWith("refund.")
          ? "REFUNDED"
          : "OTHER";

  return {
    // Razorpay does not always send an id at the top level, so fall back to a
    // deterministic composite. A stable id is what makes idempotency work.
    eventId: payload.id ?? `${event}:${entity.id ?? "unknown"}`,
    eventType: event,
    referenceId: entity.notes?.referenceId ?? entity.receipt ?? null,
    providerPaymentId: entity.id ?? null,
    amountPaise: typeof entity.amount === "number" ? entity.amount : null,
    outcome,
  };
}

function normaliseMock(payload: Record<string, any>): VerifiedEvent {
  const event: string = payload.event ?? "payment.captured";
  return {
    eventId: payload.id ?? `mock:${payload.referenceId}:${event}`,
    eventType: event,
    referenceId: payload.referenceId ?? null,
    providerPaymentId: payload.paymentId ?? `mock_pay_${payload.referenceId}`,
    amountPaise: typeof payload.amountPaise === "number" ? payload.amountPaise : null,
    outcome:
      event === "payment.captured"
        ? "PAID"
        : event === "payment.failed"
          ? "FAILED"
          : event.startsWith("refund.")
            ? "REFUNDED"
            : "OTHER",
  };
}

/** Unguessable public token for a payment link. */
export function generateLinkToken(): string {
  // 24 URL-safe characters from a CSPRNG. Sequential ids would let anyone
  // enumerate other tenants' links by counting.
  return crypto.randomBytes(18).toString("base64url");
}
