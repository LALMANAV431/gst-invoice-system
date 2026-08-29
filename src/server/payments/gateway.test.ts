import { beforeEach, describe, expect, it } from "vitest";
import crypto from "node:crypto";
import {
  configuredGateway,
  gatewayIsLive,
  generateLinkToken,
  signMockWebhook,
  timingSafeCompare,
  verifyMockWebhook,
  verifyRazorpayCheckout,
  verifyRazorpayWebhook,
} from "./gateway";

const SECRET = "test-webhook-secret-value";

function razorpaySignature(body: string, secret = SECRET): string {
  return crypto.createHmac("sha256", secret).update(body).digest("hex");
}

describe("timingSafeCompare", () => {
  it("matches identical strings", () => {
    expect(timingSafeCompare("abc123", "abc123")).toBe(true);
  });

  it("rejects different strings of equal length", () => {
    expect(timingSafeCompare("abc123", "abc124")).toBe(false);
  });

  it("rejects different lengths without throwing", () => {
    // crypto.timingSafeEqual throws on unequal lengths, so length is checked
    // first. A throw here would surface as a 500 on a forged webhook.
    expect(timingSafeCompare("short", "muchlongervalue")).toBe(false);
  });

  it("handles empty strings", () => {
    expect(timingSafeCompare("", "")).toBe(true);
    expect(timingSafeCompare("", "x")).toBe(false);
  });
});

describe("Razorpay webhook verification", () => {
  const body = JSON.stringify({ event: "payment.captured", id: "evt_1" });

  it("accepts a correctly signed body", () => {
    expect(verifyRazorpayWebhook(body, razorpaySignature(body), SECRET)).toBe(true);
  });

  it("rejects a tampered body", () => {
    // The signature is computed over the original, so any edit invalidates it.
    const signature = razorpaySignature(body);
    const tampered = JSON.stringify({ event: "payment.captured", id: "evt_1", extra: true });
    expect(verifyRazorpayWebhook(tampered, signature, SECRET)).toBe(false);
  });

  it("rejects a signature made with the wrong secret", () => {
    expect(verifyRazorpayWebhook(body, razorpaySignature(body, "attacker-secret"), SECRET)).toBe(
      false
    );
  });

  it("rejects a missing signature", () => {
    expect(verifyRazorpayWebhook(body, "", SECRET)).toBe(false);
  });

  it("rejects when no secret is configured", () => {
    // Without this, an unconfigured deployment would accept anything.
    expect(verifyRazorpayWebhook(body, razorpaySignature(body), "")).toBe(false);
  });

  it("is sensitive to byte-for-byte differences in the raw body", () => {
    // This is why the RAW body must be verified rather than re-serialised JSON:
    // whitespace and key order change the digest.
    const reserialised = JSON.stringify(JSON.parse(body), null, 2);
    expect(verifyRazorpayWebhook(reserialised, razorpaySignature(body), SECRET)).toBe(false);
  });
});

describe("Razorpay checkout callback verification", () => {
  const orderId = "order_ABC123";
  const paymentId = "pay_XYZ789";

  function checkoutSignature(secret = SECRET): string {
    return crypto.createHmac("sha256", secret).update(`${orderId}|${paymentId}`).digest("hex");
  }

  it("accepts a genuine callback", () => {
    expect(verifyRazorpayCheckout(orderId, paymentId, checkoutSignature(), SECRET)).toBe(true);
  });

  it("rejects a fabricated success", () => {
    // A browser can claim anything; only the signature proves it.
    expect(verifyRazorpayCheckout(orderId, paymentId, "deadbeef", SECRET)).toBe(false);
  });

  it("rejects a swapped payment id", () => {
    expect(
      verifyRazorpayCheckout(orderId, "pay_SOMEONE_ELSE", checkoutSignature(), SECRET)
    ).toBe(false);
  });

  it("rejects when any field is missing", () => {
    expect(verifyRazorpayCheckout("", paymentId, checkoutSignature(), SECRET)).toBe(false);
    expect(verifyRazorpayCheckout(orderId, "", checkoutSignature(), SECRET)).toBe(false);
    expect(verifyRazorpayCheckout(orderId, paymentId, "", SECRET)).toBe(false);
    expect(verifyRazorpayCheckout(orderId, paymentId, checkoutSignature(), "")).toBe(false);
  });
});

describe("mock webhook verification", () => {
  beforeEach(() => {
    process.env.JWT_SECRET = "mock-mode-signing-secret";
  });

  it("still requires a valid signature in mock mode", () => {
    // Mock mode must exercise the verification path, or the most
    // security-critical code would be untested until production.
    const body = JSON.stringify({ event: "payment.captured", referenceId: "tok" });
    expect(verifyMockWebhook(body, signMockWebhook(body))).toBe(true);
    expect(verifyMockWebhook(body, "not-a-signature")).toBe(false);
  });

  it("rejects a tampered mock body", () => {
    const body = JSON.stringify({ event: "payment.captured", amountPaise: 100 });
    const signature = signMockWebhook(body);
    const tampered = JSON.stringify({ event: "payment.captured", amountPaise: 100000 });
    expect(verifyMockWebhook(tampered, signature)).toBe(false);
  });

  it("rejects everything when JWT_SECRET is absent", () => {
    delete process.env.JWT_SECRET;
    expect(verifyMockWebhook("{}", "anything")).toBe(false);
    process.env.JWT_SECRET = "mock-mode-signing-secret";
  });
});

describe("gateway configuration", () => {
  const saved = { ...process.env };

  beforeEach(() => {
    delete process.env.PAYMENT_PROVIDER;
    delete process.env.RAZORPAY_KEY_ID;
    delete process.env.RAZORPAY_KEY_SECRET;
    delete process.env.STRIPE_SECRET_KEY;
  });

  it("defaults to mock", () => {
    expect(configuredGateway()).toBe("mock");
  });

  it("falls back to mock when razorpay is selected without credentials", () => {
    // A missing env var must not turn every payment request into a 500.
    process.env.PAYMENT_PROVIDER = "razorpay";
    expect(configuredGateway()).toBe("mock");
  });

  it("uses razorpay when fully configured", () => {
    process.env.PAYMENT_PROVIDER = "razorpay";
    process.env.RAZORPAY_KEY_ID = "rzp_test_abc";
    process.env.RAZORPAY_KEY_SECRET = "secret";
    expect(configuredGateway()).toBe("razorpay");
  });

  it("reports test keys as not live", () => {
    process.env.PAYMENT_PROVIDER = "razorpay";
    process.env.RAZORPAY_KEY_ID = "rzp_test_abc";
    process.env.RAZORPAY_KEY_SECRET = "secret";
    // The UI relies on this to warn that a link cannot take real money.
    expect(gatewayIsLive()).toBe(false);
  });

  it("reports production keys as live", () => {
    process.env.PAYMENT_PROVIDER = "razorpay";
    process.env.RAZORPAY_KEY_ID = "rzp_live_abc";
    process.env.RAZORPAY_KEY_SECRET = "secret";
    expect(gatewayIsLive()).toBe(true);
  });

  it("treats mock as never live", () => {
    expect(gatewayIsLive()).toBe(false);
  });

  it("restores env for other suites", () => {
    Object.assign(process.env, saved);
    expect(true).toBe(true);
  });
});

describe("generateLinkToken", () => {
  it("produces URL-safe tokens", () => {
    for (let i = 0; i < 20; i++) {
      expect(generateLinkToken()).toMatch(/^[A-Za-z0-9_-]+$/);
    }
  });

  it("produces unguessable, non-repeating tokens", () => {
    // Sequential ids would let anyone enumerate other tenants' links.
    const tokens = new Set(Array.from({ length: 500 }, () => generateLinkToken()));
    expect(tokens.size).toBe(500);
  });

  it("is long enough to resist guessing", () => {
    // 18 random bytes -> 24 base64url characters.
    expect(generateLinkToken().length).toBeGreaterThanOrEqual(20);
  });
});
