/**
 * Real AI providers, over plain `fetch`.
 *
 * No vendor SDKs: each is one HTTP call, and four SDKs would add far more
 * dependency weight and version churn than the request shapes are worth. It also
 * keeps `isConfigured()` honest — a missing key is a missing env var, not an SDK
 * that throws on import.
 *
 * Every provider:
 *   - reports `isConfigured()` false when its key is absent, so the service can
 *     fall back to mock instead of failing a user request;
 *   - enforces a timeout, because a hung provider must not hang an invoice screen;
 *   - returns real token counts when the API supplies them, estimating only as a
 *     fallback, since budgets depend on these numbers.
 */

import type {
  AiCompletionRequest,
  AiCompletionResponse,
  AiProvider,
  AiProviderId,
} from "../types";
import { AiUnavailableError } from "../types";
import { estimateTokens } from "./mock";

const TIMEOUT_MS = 30_000;

async function postJson(
  url: string,
  body: unknown,
  headers: Record<string, string>
): Promise<any> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...headers },
      body: JSON.stringify(body),
      signal: controller.signal,
    });

    if (!res.ok) {
      // Deliberately do not echo the provider's body to the caller: it can
      // contain the prompt, and therefore tenant data.
      const status = res.status;
      throw new AiUnavailableError(
        status === 429
          ? "The AI provider is rate limiting requests. Try again shortly."
          : `The AI provider returned an error (HTTP ${status}).`
      );
    }
    return res.json();
  } catch (e) {
    if (e instanceof AiUnavailableError) throw e;
    if ((e as Error).name === "AbortError") {
      throw new AiUnavailableError("The AI provider timed out.");
    }
    throw new AiUnavailableError("Could not reach the AI provider.");
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// OpenAI-compatible (also covers the `local` provider: Ollama, vLLM, LM Studio)
// ---------------------------------------------------------------------------

class OpenAiCompatibleProvider implements AiProvider {
  constructor(
    readonly id: AiProviderId,
    readonly model: string,
    private readonly baseUrl: string,
    private readonly apiKey: string | undefined,
    private readonly requireKey: boolean
  ) {}

  isConfigured(): boolean {
    if (!this.baseUrl) return false;
    return this.requireKey ? Boolean(this.apiKey) : true;
  }

  supportsVision(): boolean {
    return true;
  }

  async complete(req: AiCompletionRequest): Promise<AiCompletionResponse> {
    const content: unknown[] = [{ type: "text", text: req.prompt }];
    if (req.imageBase64) {
      content.push({
        type: "image_url",
        image_url: {
          url: `data:${req.imageMimeType ?? "image/jpeg"};base64,${req.imageBase64}`,
        },
      });
    }

    const data = await postJson(
      `${this.baseUrl.replace(/\/$/, "")}/chat/completions`,
      {
        model: this.model,
        messages: [
          { role: "system", content: req.system },
          { role: "user", content },
        ],
        max_tokens: req.maxTokens ?? 1024,
        temperature: 0,
        ...(req.jsonSchema ? { response_format: { type: "json_object" } } : {}),
      },
      this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : {}
    );

    const text: string = data?.choices?.[0]?.message?.content ?? "";
    return {
      text,
      usage: {
        inputTokens: data?.usage?.prompt_tokens ?? estimateTokens(req.system + req.prompt),
        outputTokens: data?.usage?.completion_tokens ?? estimateTokens(text),
      },
      model: data?.model ?? this.model,
      provider: this.id,
    };
  }
}

// ---------------------------------------------------------------------------
// Anthropic
// ---------------------------------------------------------------------------

class AnthropicProvider implements AiProvider {
  readonly id = "anthropic" as const;

  constructor(
    readonly model: string,
    private readonly apiKey: string | undefined
  ) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  supportsVision(): boolean {
    return true;
  }

  async complete(req: AiCompletionRequest): Promise<AiCompletionResponse> {
    const content: unknown[] = [{ type: "text", text: req.prompt }];
    if (req.imageBase64) {
      content.unshift({
        type: "image",
        source: {
          type: "base64",
          media_type: req.imageMimeType ?? "image/jpeg",
          data: req.imageBase64,
        },
      });
    }

    const data = await postJson(
      "https://api.anthropic.com/v1/messages",
      {
        model: this.model,
        max_tokens: req.maxTokens ?? 1024,
        temperature: 0,
        system: req.system,
        messages: [{ role: "user", content }],
      },
      {
        "x-api-key": this.apiKey ?? "",
        "anthropic-version": "2023-06-01",
      }
    );

    const text: string = data?.content?.[0]?.text ?? "";
    return {
      text,
      usage: {
        inputTokens: data?.usage?.input_tokens ?? estimateTokens(req.system + req.prompt),
        outputTokens: data?.usage?.output_tokens ?? estimateTokens(text),
      },
      model: data?.model ?? this.model,
      provider: this.id,
    };
  }
}

// ---------------------------------------------------------------------------
// Gemini
// ---------------------------------------------------------------------------

class GeminiProvider implements AiProvider {
  readonly id = "gemini" as const;

  constructor(
    readonly model: string,
    private readonly apiKey: string | undefined
  ) {}

  isConfigured(): boolean {
    return Boolean(this.apiKey);
  }

  supportsVision(): boolean {
    return true;
  }

  async complete(req: AiCompletionRequest): Promise<AiCompletionResponse> {
    const parts: unknown[] = [{ text: req.prompt }];
    if (req.imageBase64) {
      parts.push({
        inline_data: {
          mime_type: req.imageMimeType ?? "image/jpeg",
          data: req.imageBase64,
        },
      });
    }

    const data = await postJson(
      `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:generateContent?key=${encodeURIComponent(this.apiKey ?? "")}`,
      {
        systemInstruction: { parts: [{ text: req.system }] },
        contents: [{ role: "user", parts }],
        generationConfig: {
          temperature: 0,
          maxOutputTokens: req.maxTokens ?? 1024,
          ...(req.jsonSchema ? { responseMimeType: "application/json" } : {}),
        },
      },
      {}
    );

    const text: string =
      data?.candidates?.[0]?.content?.parts?.map((p: any) => p.text ?? "").join("") ?? "";

    return {
      text,
      usage: {
        inputTokens:
          data?.usageMetadata?.promptTokenCount ?? estimateTokens(req.system + req.prompt),
        outputTokens: data?.usageMetadata?.candidatesTokenCount ?? estimateTokens(text),
      },
      model: this.model,
      provider: this.id,
    };
  }
}

// ---------------------------------------------------------------------------
// Factory
// ---------------------------------------------------------------------------

export function createHttpProvider(id: AiProviderId): AiProvider | null {
  const model = process.env.AI_MODEL || "gpt-4o-mini";

  switch (id) {
    case "openai":
      return new OpenAiCompatibleProvider(
        "openai",
        model,
        "https://api.openai.com/v1",
        process.env.OPENAI_API_KEY,
        true
      );
    case "local":
      // Self-hosted OpenAI-compatible servers usually need no key.
      return new OpenAiCompatibleProvider(
        "local",
        model,
        process.env.LOCAL_AI_BASE_URL || "http://localhost:11434/v1",
        process.env.LOCAL_AI_API_KEY,
        false
      );
    case "anthropic":
      return new AnthropicProvider(
        process.env.AI_MODEL || "claude-3-5-haiku-latest",
        process.env.ANTHROPIC_API_KEY
      );
    case "gemini":
      return new GeminiProvider(
        process.env.AI_MODEL || "gemini-1.5-flash",
        process.env.GEMINI_API_KEY
      );
    default:
      return null;
  }
}
