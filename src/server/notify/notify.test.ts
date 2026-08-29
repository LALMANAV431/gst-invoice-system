import { describe, expect, it } from "vitest";
import crypto from "node:crypto";
import { isValidEmail, whatsappShareUrl, emailProvider } from "./email";
import { generateWebhookSecret, signOutbound } from "./notify.service";

describe("isValidEmail", () => {
  it("accepts ordinary addresses", () => {
    expect(isValidEmail("anita@example.com")).toBe(true);
    expect(isValidEmail("a.b+tag@sub.example.co.in")).toBe(true);
  });

  it("rejects malformed addresses before a send is spent", () => {
    expect(isValidEmail("")).toBe(false);
    expect(isValidEmail("no-at-sign")).toBe(false);
    expect(isValidEmail("two@@example.com")).toBe(false);
    expect(isValidEmail("trailing@")).toBe(false);
    expect(isValidEmail("@leading.com")).toBe(false);
    expect(isValidEmail("spaces in@example.com")).toBe(false);
    // A single-letter TLD is not valid.
    expect(isValidEmail("x@y.c")).toBe(false);
  });

  it("tolerates surrounding whitespace", () => {
    expect(isValidEmail("  anita@example.com  ")).toBe(true);
  });
});

describe("whatsappShareUrl", () => {
  it("adds the India country code to a bare 10-digit number", () => {
    // wa.me requires a country code; a shopkeeper will type 10 digits.
    expect(whatsappShareUrl("9876543210", "hi")).toContain("wa.me/919876543210");
  });

  it("keeps a number that already has a country code", () => {
    expect(whatsappShareUrl("919876543210", "hi")).toContain("wa.me/919876543210");
  });

  it("strips punctuation and spacing", () => {
    expect(whatsappShareUrl("+91 98765-43210", "hi")).toContain("wa.me/919876543210");
  });

  it("URL-encodes the message, including newlines and rupee symbols", () => {
    const url = whatsappShareUrl("9876543210", "Invoice INV/26-27/0001\nAmount ₹1,180 & due");
    expect(url).toContain("%0A"); // newline
    expect(url).toContain("%26"); // ampersand, which would otherwise split the query
    expect(url).not.toContain("\n");
  });

  it("handles Hindi text", () => {
    const url = whatsappShareUrl("9876543210", "आपका बिल तैयार है");
    expect(url).toMatch(/^https:\/\/wa\.me\/91\d+\?text=%/);
  });
});

describe("emailProvider", () => {
  const saved = { ...process.env };

  function reset() {
    delete process.env.RESEND_API_KEY;
    delete process.env.SMTP_HOST;
  }

  it("defaults to mock so nothing is emailed by accident in development", () => {
    reset();
    expect(emailProvider()).toBe("mock");
    Object.assign(process.env, saved);
  });

  it("reports configured SMTP as unsupported rather than silently dropping mail", () => {
    reset();
    process.env.SMTP_HOST = "smtp.example.com";
    // Silently not sending would be worse than saying it is unsupported.
    expect(emailProvider()).toBe("unsupported-smtp");
    Object.assign(process.env, saved);
  });

  it("uses the HTTP provider when its key is present", () => {
    reset();
    process.env.RESEND_API_KEY = "re_test_key";
    expect(emailProvider()).toBe("resend");
    Object.assign(process.env, saved);
  });

  it("prefers the HTTP provider over SMTP when both are set", () => {
    reset();
    process.env.RESEND_API_KEY = "re_test_key";
    process.env.SMTP_HOST = "smtp.example.com";
    expect(emailProvider()).toBe("resend");
    Object.assign(process.env, saved);
  });
});

describe("outbound webhook signing", () => {
  it("produces an HMAC-SHA256 hex digest of the exact body", () => {
    const body = JSON.stringify({ event: "invoice.paid", data: { id: "inv_1" } });
    const secret = "whsec_example";
    const expected = crypto.createHmac("sha256", secret).update(body).digest("hex");
    expect(signOutbound(body, secret)).toBe(expected);
    expect(signOutbound(body, secret)).toHaveLength(64);
  });

  it("changes when the body changes by a single byte", () => {
    const secret = "whsec_example";
    const a = signOutbound('{"amount":100}', secret);
    const b = signOutbound('{"amount":101}', secret);
    expect(a).not.toBe(b);
  });

  it("changes when the secret changes", () => {
    const body = '{"event":"x"}';
    expect(signOutbound(body, "secret-a")).not.toBe(signOutbound(body, "secret-b"));
  });

  it("is deterministic, so a receiver can reproduce it", () => {
    const body = '{"event":"invoice.paid"}';
    expect(signOutbound(body, "s")).toBe(signOutbound(body, "s"));
  });
});

describe("generateWebhookSecret", () => {
  it("is prefixed so it is recognisable in a config file", () => {
    expect(generateWebhookSecret()).toMatch(/^whsec_[A-Za-z0-9_-]+$/);
  });

  it("is long enough to resist guessing", () => {
    // 24 random bytes -> 32 base64url characters after the prefix.
    expect(generateWebhookSecret().length).toBeGreaterThanOrEqual(38);
  });

  it("never repeats", () => {
    const secrets = new Set(Array.from({ length: 500 }, () => generateWebhookSecret()));
    expect(secrets.size).toBe(500);
  });
});
