/**
 * Mock AI provider — the DEFAULT.
 *
 * WHY THIS IS THE DEFAULT
 * -----------------------
 * Every AI code path (budget checks, metering, redaction, caching, JSON parsing,
 * error handling) must be exercisable with no API key and no spend. Otherwise
 * those paths only run in production, which is exactly where they must not fail
 * for the first time.
 *
 * Responses are DETERMINISTIC — derived from the prompt, not random — so tests
 * can assert on them and a demo behaves the same way twice.
 *
 * It returns plausibly-shaped output for each feature so the UI can be built and
 * reviewed without a provider. It is not pretending to be intelligent: the
 * assistant answers say plainly that they are demo responses.
 */

import type {
  AiCompletionRequest,
  AiCompletionResponse,
  AiProvider,
} from "../types";

/** Rough token estimate: ~4 characters per token for English/Hindi mixed text. */
export function estimateTokens(text: string): number {
  return Math.max(1, Math.ceil(text.length / 4));
}

/** Stable hash, so the same prompt always picks the same canned answer. */
function hash(input: string): number {
  let h = 2166136261;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h);
}

const ASSISTANT_REPLIES = [
  "Demo response: based on your posted invoices, sales are tracking slightly above last month. Switch on a real AI provider for actual analysis.",
  "Demo response: your largest outstanding balance is with the customer at the top of the Outstanding report. Open Reports -> Outstanding for the real figures.",
  "Demo response: stock is low on a handful of items. Open Items and sort by current stock to see which.",
  "Demo response: this month's GST liability is shown on Reports -> GST Summary, which is computed from your ledger rather than estimated.",
];

export class MockAiProvider implements AiProvider {
  readonly id = "mock" as const;
  readonly model = "mock-deterministic-v1";

  isConfigured(): boolean {
    // Always available: that is the point.
    return true;
  }

  supportsVision(): boolean {
    // Accepts images so the OCR flow is testable end to end.
    return true;
  }

  async complete(req: AiCompletionRequest): Promise<AiCompletionResponse> {
    const text = this.respond(req);
    return {
      text,
      usage: {
        inputTokens: estimateTokens(req.system + req.prompt),
        outputTokens: estimateTokens(text),
      },
      model: this.model,
      provider: this.id,
    };
  }

  private respond(req: AiCompletionRequest): string {
    switch (req.feature) {
      case "OCR":
        // Shaped like a real extraction so the review-before-post flow can be
        // exercised, with confidence deliberately below 1 to prove the UI
        // surfaces uncertainty.
        return JSON.stringify({
          supplierName: "Reliable Suppliers",
          supplierGstin: "29AAACR9876H1ZP",
          invoiceNumber: "RS/2025/8891",
          invoiceDate: "2025-11-14",
          taxableAmount: 12500,
          taxAmount: 2250,
          totalAmount: 14750,
          gstRate: 18,
          confidence: 0.72,
          notes: "Demo extraction. Enable a real AI provider for actual OCR.",
        });

      case "CATEGORISE":
        return JSON.stringify({
          suggestedLedger: this.guessExpenseHead(req.prompt),
          confidence: 0.65,
          reason: "Demo suggestion based on keywords in the description.",
        });

      case "FORECAST":
        return JSON.stringify({
          horizonDays: 30,
          expectedInflow: 0,
          expectedOutflow: 0,
          note: "Demo forecast. Enable a real AI provider for a projection based on your history.",
        });

      case "SUMMARY":
        return "Demo summary: no real analysis was performed because AI is running in mock mode.";

      case "ASSISTANT":
      default:
        return ASSISTANT_REPLIES[hash(req.prompt) % ASSISTANT_REPLIES.length];
    }
  }

  /** Keyword match over the default chart of accounts. Intentionally simple. */
  private guessExpenseHead(prompt: string): string {
    const p = prompt.toLowerCase();
    const rules: [string[], string][] = [
      [["rent", "किराया", "lease"], "Office Rent"],
      [["salary", "wages", "वेतन", "staff"], "Salaries"],
      [["electric", "power", "बिजली"], "Electricity"],
      [["internet", "broadband", "wifi", "phone", "mobile"], "Internet & Telephone"],
      [["transport", "freight", "courier", "भाड़ा"], "Freight & Transport"],
      [["tea", "snack", "food", "canteen", "चाय"], "Staff Welfare"],
      [["repair", "maintenance", "मरम्मत"], "Repairs & Maintenance"],
      [["petrol", "diesel", "fuel", "पेट्रोल"], "Fuel & Vehicle"],
      [["print", "stationery", "paper"], "Printing & Stationery"],
    ];
    for (const [keywords, ledger] of rules) {
      if (keywords.some((k) => p.includes(k))) return ledger;
    }
    return "Miscellaneous Expenses";
  }
}
