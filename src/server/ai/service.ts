/**
 * AI service: the only entry point the application uses.
 *
 * Responsibilities, in the order they are applied:
 *
 *   1. Is AI switched on at all?            -> return unavailable, never throw
 *   2. Is the provider configured?          -> fall back to mock rather than fail
 *   3. Is the tenant within budget?         -> checked BEFORE the call
 *   4. Cache hit?                           -> identical questions cost nothing twice
 *   5. Redact PII                           -> unless the provider is local/mock
 *   6. Call the provider
 *   7. Meter the usage                      -> so cost is attributable per tenant
 *   8. Re-hydrate placeholders locally
 *
 * The ordering matters: budget before call means the tenant cannot overspend by
 * one large request, and metering after the call means real token counts are
 * recorded rather than estimates.
 */

import { db } from "@/lib/db";
import { MockAiProvider } from "./providers/mock";
import { createHttpProvider } from "./providers/http";
import { redactPii, rehydrate, shouldRedact } from "./redact";
import {
  AiBudgetExceededError,
  AiUnavailableError,
  type AiFeature,
  type AiProvider,
  type AiProviderId,
} from "./types";

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

export function aiEnabled(): boolean {
  return process.env.AI_ENABLED === "true";
}

export function configuredProviderId(): AiProviderId {
  const raw = (process.env.AI_PROVIDER || "mock").toLowerCase();
  const valid: AiProviderId[] = ["mock", "openai", "gemini", "anthropic", "local"];
  return (valid as string[]).includes(raw) ? (raw as AiProviderId) : "mock";
}

function monthlyBudgetTokens(): number {
  const raw = Number(process.env.AI_MONTHLY_TOKEN_BUDGET ?? 2_000_000);
  return Number.isFinite(raw) && raw > 0 ? raw : 2_000_000;
}

function maxTokensPerRequest(): number {
  const raw = Number(process.env.AI_MAX_TOKENS_PER_REQUEST ?? 4000);
  return Number.isFinite(raw) && raw > 0 ? raw : 4000;
}

/**
 * Resolve the provider.
 *
 * Falls back to mock when the configured provider has no credentials. A user
 * pressing a button should get a clearly-labelled demo answer, not a 500 caused
 * by an operator forgetting an env var.
 */
export function resolveProvider(): { provider: AiProvider; fellBack: boolean } {
  const id = configuredProviderId();
  if (id === "mock") return { provider: new MockAiProvider(), fellBack: false };

  const http = createHttpProvider(id);
  if (http && http.isConfigured()) return { provider: http, fellBack: false };

  console.warn(`[ai] provider "${id}" is not configured; falling back to mock`);
  return { provider: new MockAiProvider(), fellBack: true };
}

// ---------------------------------------------------------------------------
// Status, for the UI
// ---------------------------------------------------------------------------

export type AiStatus = {
  available: boolean;
  provider: AiProviderId;
  model: string;
  /** True when answers are canned. The UI must say so. */
  mock: boolean;
  redactPii: boolean;
  budgetTokens: number;
  usedTokens: number;
  remainingTokens: number;
};

export async function getAiStatus(companyId: string): Promise<AiStatus> {
  const { provider } = resolveProvider();
  const usedTokens = await tokensUsedThisMonth(companyId);
  const budgetTokens = monthlyBudgetTokens();

  return {
    available: aiEnabled(),
    provider: provider.id,
    model: provider.model,
    mock: provider.id === "mock",
    redactPii: shouldRedact(provider.id),
    budgetTokens,
    usedTokens,
    remainingTokens: Math.max(0, budgetTokens - usedTokens),
  };
}

async function tokensUsedThisMonth(companyId: string): Promise<number> {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const agg = await db.aiUsageLog.aggregate({
    where: { companyId, createdAt: { gte: monthStart }, cacheHit: false },
    _sum: { inputTokens: true, outputTokens: true },
  });
  return (agg._sum.inputTokens ?? 0) + (agg._sum.outputTokens ?? 0);
}

// ---------------------------------------------------------------------------
// Response cache
// ---------------------------------------------------------------------------

/**
 * In-process cache, keyed on tenant + feature + prompt.
 *
 * Tenant is part of the key so one company's answer can never be served to
 * another — the same cache-poisoning concern as any multi-tenant cache.
 *
 * In-process is a deliberate limitation: it needs no infrastructure, and the
 * worst case for a miss is one extra metered call. Move to Redis alongside the
 * rate limiter when running multiple instances.
 */
type CacheEntry = { text: string; expiresAt: number };
const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60_000;
const CACHE_MAX_ENTRIES = 500;

function cacheKey(companyId: string, feature: AiFeature, prompt: string): string {
  return `${companyId}:${feature}:${prompt.trim().toLowerCase()}`;
}

function cacheGet(key: string): string | null {
  const hit = cache.get(key);
  if (!hit) return null;
  if (hit.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }
  return hit.text;
}

function cacheSet(key: string, text: string): void {
  if (cache.size >= CACHE_MAX_ENTRIES) {
    // Evict the oldest insertion; Map preserves insertion order.
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { text, expiresAt: Date.now() + CACHE_TTL_MS });
}

/** Exposed for tests. */
export function clearAiCache(): void {
  cache.clear();
}

// ---------------------------------------------------------------------------
// The call
// ---------------------------------------------------------------------------

export type AskOptions = {
  companyId: string;
  userId: string;
  feature: AiFeature;
  system: string;
  prompt: string;
  jsonSchema?: Record<string, unknown>;
  imageBase64?: string;
  imageMimeType?: string;
  /** Skip the cache for anything non-deterministic. */
  noCache?: boolean;
};

export type AskResult = {
  text: string;
  provider: AiProviderId;
  model: string;
  mock: boolean;
  cached: boolean;
  usage: { inputTokens: number; outputTokens: number };
};

export async function ask(opts: AskOptions): Promise<AskResult> {
  if (!aiEnabled()) {
    throw new AiUnavailableError(
      "AI features are switched off. Set AI_ENABLED=true to use them."
    );
  }

  const { provider } = resolveProvider();

  if (opts.imageBase64 && !provider.supportsVision()) {
    throw new AiUnavailableError(
      `The ${provider.id} provider cannot read images. Use a vision-capable model.`
    );
  }

  // --- Budget, BEFORE the call ---------------------------------------------
  const budgetTokens = monthlyBudgetTokens();
  const usedTokens = await tokensUsedThisMonth(opts.companyId);
  if (usedTokens >= budgetTokens) {
    throw new AiBudgetExceededError(usedTokens, budgetTokens);
  }

  // --- Cache ---------------------------------------------------------------
  const key = cacheKey(opts.companyId, opts.feature, opts.prompt);
  if (!opts.noCache && !opts.imageBase64) {
    const hit = cacheGet(key);
    if (hit !== null) {
      // Logged with cacheHit so it is visible in usage without counting toward
      // the budget.
      await logUsage({
        companyId: opts.companyId,
        userId: opts.userId,
        feature: opts.feature,
        provider: provider.id,
        model: provider.model,
        inputTokens: 0,
        outputTokens: 0,
        cacheHit: true,
      });
      return {
        text: hit,
        provider: provider.id,
        model: provider.model,
        mock: provider.id === "mock",
        cached: true,
        usage: { inputTokens: 0, outputTokens: 0 },
      };
    }
  }

  // --- Redact --------------------------------------------------------------
  const redacting = shouldRedact(provider.id);
  const { text: safePrompt, map } = redacting
    ? redactPii(opts.prompt)
    : { text: opts.prompt, map: new Map<string, string>() };

  // --- Call ----------------------------------------------------------------
  const response = await provider.complete({
    feature: opts.feature,
    system: opts.system,
    prompt: safePrompt,
    jsonSchema: opts.jsonSchema,
    maxTokens: maxTokensPerRequest(),
    imageBase64: opts.imageBase64,
    imageMimeType: opts.imageMimeType,
  });

  // --- Meter ---------------------------------------------------------------
  await logUsage({
    companyId: opts.companyId,
    userId: opts.userId,
    feature: opts.feature,
    provider: response.provider,
    model: response.model,
    inputTokens: response.usage.inputTokens,
    outputTokens: response.usage.outputTokens,
    cacheHit: false,
  });

  // --- Re-hydrate locally --------------------------------------------------
  const finalText = redacting ? rehydrate(response.text, map) : response.text;

  if (!opts.noCache && !opts.imageBase64) cacheSet(key, finalText);

  return {
    text: finalText,
    provider: response.provider,
    model: response.model,
    mock: response.provider === "mock",
    cached: false,
    usage: response.usage,
  };
}

async function logUsage(entry: {
  companyId: string;
  userId: string;
  feature: AiFeature;
  provider: string;
  model: string;
  inputTokens: number;
  outputTokens: number;
  cacheHit: boolean;
}): Promise<void> {
  try {
    await db.aiUsageLog.create({
      data: {
        companyId: entry.companyId,
        userId: entry.userId,
        feature: entry.feature,
        provider: entry.provider,
        model: entry.model,
        inputTokens: entry.inputTokens,
        outputTokens: entry.outputTokens,
        cacheHit: entry.cacheHit,
        costPaise: 0,
      },
    });
  } catch (e) {
    // Never fail a user's request because metering failed, but do not lose the
    // signal either.
    console.error("[ai] usage logging failed:", e);
  }
}

/**
 * Parse a model response as JSON.
 *
 * Models wrap JSON in prose or fences even when told not to, so the object is
 * extracted rather than assumed. A parse failure is returned as null so the
 * caller can surface "could not read that" instead of throwing.
 */
export function parseJsonResponse<T>(text: string): T | null {
  const trimmed = text.trim();
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  const candidate = fenced ? fenced[1] : trimmed;

  try {
    return JSON.parse(candidate) as T;
  } catch {
    const start = candidate.indexOf("{");
    const end = candidate.lastIndexOf("}");
    if (start !== -1 && end > start) {
      try {
        return JSON.parse(candidate.slice(start, end + 1)) as T;
      } catch {
        return null;
      }
    }
    return null;
  }
}
