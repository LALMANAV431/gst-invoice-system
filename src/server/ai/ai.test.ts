import { describe, expect, it } from "vitest";
import { MockAiProvider, estimateTokens } from "./providers/mock";
import { redactPii, rehydrate, shouldRedact } from "./redact";
import { parseJsonResponse, configuredProviderId } from "./service";

describe("PII redaction", () => {
  it("redacts a GSTIN", () => {
    const { text, count } = redactPii("Supplier GSTIN is 29AAACR9876H1ZP for this bill");
    expect(text).not.toContain("29AAACR9876H1ZP");
    expect(text).toContain("[GSTIN_1]");
    expect(count).toBe(1);
  });

  it("redacts GSTIN before PAN, so a GSTIN is not split", () => {
    // A GSTIN contains a PAN at characters 3-12. If PAN matched first it would
    // carve the middle out of every GSTIN and leave the rest exposed.
    const { text } = redactPii("GSTIN 29AAACR9876H1ZP");
    expect(text).toBe("GSTIN [GSTIN_1]");
    expect(text).not.toContain("AAACR9876H");
  });

  it("redacts a standalone PAN", () => {
    const { text } = redactPii("PAN ABCDE1234F on file");
    expect(text).toContain("[PAN_1]");
    expect(text).not.toContain("ABCDE1234F");
  });

  it("redacts emails and Indian mobile numbers", () => {
    const { text } = redactPii("Contact anita@example.com or +91 9876543210");
    expect(text).not.toContain("anita@example.com");
    expect(text).not.toContain("9876543210");
    expect(text).toContain("[EMAIL_1]");
    expect(text).toContain("[PHONE_1]");
  });

  it("redacts IFSC and Aadhaar", () => {
    const { text } = redactPii("IFSC HDFC0001234, Aadhaar 4123 5678 9012");
    expect(text).toContain("[IFSC_1]");
    expect(text).not.toContain("HDFC0001234");
    expect(text).toContain("[AADHAAR_1]");
  });

  it("gives a repeated value the same placeholder", () => {
    // The model should still be able to see that one party appears twice.
    const { text, count } = redactPii(
      "a@x.com sent it, then a@x.com confirmed"
    );
    expect(text).toBe("[EMAIL_1] sent it, then [EMAIL_1] confirmed");
    expect(count).toBe(1);
  });

  it("round-trips through rehydrate", () => {
    const original = "Call 9876543210 about GSTIN 29AAACR9876H1ZP";
    const { text, map } = redactPii(original);
    expect(rehydrate(text, map)).toBe(original);
  });

  it("leaves ordinary text untouched", () => {
    const input = "Sales this month were Rs 1,25,000 across 42 invoices";
    const { text, count } = redactPii(input);
    expect(text).toBe(input);
    expect(count).toBe(0);
  });

  it("handles empty input", () => {
    expect(redactPii("").count).toBe(0);
  });

  it("is skipped for local and mock providers", () => {
    // Nothing leaves the machine, so redacting would only degrade the answer.
    expect(shouldRedact("local")).toBe(false);
    expect(shouldRedact("mock")).toBe(false);
  });

  it("is on by default for third-party providers", () => {
    expect(shouldRedact("openai")).toBe(true);
    expect(shouldRedact("anthropic")).toBe(true);
  });
});

describe("mock provider", () => {
  const provider = new MockAiProvider();

  it("is always configured, so AI paths are testable without a key", () => {
    expect(provider.isConfigured()).toBe(true);
  });

  it("accepts images so the OCR flow can be exercised", () => {
    expect(provider.supportsVision()).toBe(true);
  });

  it("is deterministic: the same prompt gives the same answer", async () => {
    const req = {
      feature: "ASSISTANT" as const,
      system: "s",
      prompt: "how much did I sell today?",
    };
    const a = await provider.complete(req);
    const b = await provider.complete(req);
    expect(a.text).toBe(b.text);
  });

  it("varies its answer across different questions", async () => {
    // With a small pool of canned replies, two specific prompts colliding is
    // expected and harmless. The property that matters is that the provider is
    // not returning one single answer to everything.
    const prompts = [
      "top customers",
      "low stock items please",
      "what is my GST liability",
      "how much did I sell today",
      "who owes me the most",
      "profit this month",
    ];
    const answers = new Set<string>();
    for (const prompt of prompts) {
      const res = await provider.complete({ feature: "ASSISTANT", system: "s", prompt });
      answers.add(res.text);
    }
    expect(answers.size).toBeGreaterThan(1);
  });

  it("returns OCR output shaped like a real extraction", async () => {
    const res = await provider.complete({
      feature: "OCR",
      system: "s",
      prompt: "extract",
      imageBase64: "x",
    });
    const parsed = parseJsonResponse<{
      supplierGstin: string;
      totalAmount: number;
      confidence: number;
    }>(res.text);
    expect(parsed).not.toBeNull();
    expect(parsed!.supplierGstin).toBeTruthy();
    expect(parsed!.totalAmount).toBeGreaterThan(0);
    // Below 1, so the UI is forced to show uncertainty rather than presenting
    // an extraction as fact.
    expect(parsed!.confidence).toBeLessThan(1);
  });

  it("suggests an expense head from keywords, in Hindi or English", async () => {
    const english = await provider.complete({
      feature: "CATEGORISE",
      system: "s",
      prompt: "monthly office rent payment",
    });
    expect(parseJsonResponse<{ suggestedLedger: string }>(english.text)!.suggestedLedger).toBe(
      "Office Rent"
    );

    const hindi = await provider.complete({
      feature: "CATEGORISE",
      system: "s",
      prompt: "दुकान का किराया",
    });
    expect(parseJsonResponse<{ suggestedLedger: string }>(hindi.text)!.suggestedLedger).toBe(
      "Office Rent"
    );
  });

  it("falls back to a general head for an unrecognised expense", async () => {
    const res = await provider.complete({
      feature: "CATEGORISE",
      system: "s",
      prompt: "zzzz unknown thing",
    });
    expect(parseJsonResponse<{ suggestedLedger: string }>(res.text)!.suggestedLedger).toBe(
      "Miscellaneous Expenses"
    );
  });

  it("reports token usage, so metering and budgets work in mock mode", async () => {
    const res = await provider.complete({
      feature: "ASSISTANT",
      system: "system prompt here",
      prompt: "a question",
    });
    expect(res.usage.inputTokens).toBeGreaterThan(0);
    expect(res.usage.outputTokens).toBeGreaterThan(0);
    expect(res.provider).toBe("mock");
  });
});

describe("estimateTokens", () => {
  it("scales with length and never returns zero", () => {
    expect(estimateTokens("")).toBe(1);
    expect(estimateTokens("abcd")).toBe(1);
    expect(estimateTokens("a".repeat(400))).toBe(100);
  });
});

describe("parseJsonResponse", () => {
  it("parses plain JSON", () => {
    expect(parseJsonResponse<{ a: number }>('{"a":1}')).toEqual({ a: 1 });
  });

  it("parses JSON wrapped in a markdown fence", () => {
    // Models add fences even when told not to.
    expect(parseJsonResponse<{ a: number }>('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonResponse<{ a: number }>('```\n{"a":2}\n```')).toEqual({ a: 2 });
  });

  it("extracts JSON embedded in prose", () => {
    expect(
      parseJsonResponse<{ a: number }>('Here is the result: {"a":3} — hope that helps')
    ).toEqual({ a: 3 });
  });

  it("returns null rather than throwing on unparseable output", () => {
    // The caller surfaces "could not read that" instead of a 500.
    expect(parseJsonResponse("not json at all")).toBeNull();
    expect(parseJsonResponse("{broken")).toBeNull();
  });
});

describe("provider configuration", () => {
  it("defaults to mock", () => {
    const previous = process.env.AI_PROVIDER;
    delete process.env.AI_PROVIDER;
    expect(configuredProviderId()).toBe("mock");
    if (previous !== undefined) process.env.AI_PROVIDER = previous;
  });

  it("falls back to mock for an unrecognised provider name", () => {
    const previous = process.env.AI_PROVIDER;
    process.env.AI_PROVIDER = "not-a-provider";
    expect(configuredProviderId()).toBe("mock");
    if (previous === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = previous;
  });

  it("accepts the supported providers", () => {
    const previous = process.env.AI_PROVIDER;
    for (const id of ["openai", "gemini", "anthropic", "local", "mock"]) {
      process.env.AI_PROVIDER = id;
      expect(configuredProviderId()).toBe(id);
    }
    if (previous === undefined) delete process.env.AI_PROVIDER;
    else process.env.AI_PROVIDER = previous;
  });
});
