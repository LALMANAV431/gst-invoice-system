/**
 * AI provider contract.
 *
 * DESIGN CONSTRAINTS (from the product requirements, and they are not negotiable)
 * ------------------------------------------------------------------------------
 * 1. The application must work FULLY without AI. Every feature degrades to
 *    "unavailable" rather than erroring, and no code path assumes a provider
 *    exists.
 * 2. AI is the only cost that scales with usage, so spend is capped per tenant
 *    and checked BEFORE the call, never after.
 * 3. AI never writes to the ledger. It proposes; a human approves. An
 *    AI-suggested journal entry is a draft until a user confirms it.
 * 4. Tenant data is not sent to a third party unless the tenant has opted in,
 *    and PII is redacted by default.
 *
 * The `mock` provider is the DEFAULT so that developers, CI and demos exercise
 * every AI code path with no API key and no bill, and so tests stay
 * deterministic.
 */

export type AiProviderId = "mock" | "openai" | "gemini" | "anthropic" | "local";

export type AiFeature = "OCR" | "ASSISTANT" | "CATEGORISE" | "FORECAST" | "SUMMARY";

/** Token counts, used for metering and budget enforcement. */
export type AiUsage = {
  inputTokens: number;
  outputTokens: number;
};

export type AiCompletionRequest = {
  feature: AiFeature;
  /** System instruction. Kept separate so providers can map it natively. */
  system: string;
  /** User content. Already PII-redacted by the service layer. */
  prompt: string;
  /**
   * When set, the provider must return JSON matching this shape description.
   * Structured output means a malformed response is a validation failure rather
   * than a corrupt record.
   */
  jsonSchema?: Record<string, unknown>;
  maxTokens?: number;
  /** Base64 image, for OCR. Providers without vision must reject it. */
  imageBase64?: string;
  imageMimeType?: string;
};

export type AiCompletionResponse = {
  text: string;
  usage: AiUsage;
  model: string;
  provider: AiProviderId;
};

export interface AiProvider {
  readonly id: AiProviderId;
  readonly model: string;
  /** False when the provider is missing configuration (e.g. no API key). */
  isConfigured(): boolean;
  /** True when the provider can accept `imageBase64`. */
  supportsVision(): boolean;
  complete(req: AiCompletionRequest): Promise<AiCompletionResponse>;
}

/** Raised when a provider is asked for something it cannot do. */
export class AiUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AiUnavailableError";
  }
}

/** Raised when the tenant has spent its allowance for the period. */
export class AiBudgetExceededError extends Error {
  constructor(
    public readonly usedTokens: number,
    public readonly budgetTokens: number
  ) {
    super(
      `AI budget exhausted for this month: ${usedTokens} of ${budgetTokens} tokens used.`
    );
    this.name = "AiBudgetExceededError";
  }
}
