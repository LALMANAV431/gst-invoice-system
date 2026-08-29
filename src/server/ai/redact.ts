/**
 * PII redaction before anything leaves the machine.
 *
 * A tenant's customer list, GSTINs and phone numbers are their commercial asset,
 * not training data. `AI_REDACT_PII` defaults to true for that reason.
 *
 * This is a best-effort scrub, not a guarantee. It removes the identifiers this
 * app is known to store, and it is applied on top of — never instead of — the
 * tenant's explicit opt-in.
 */

export type RedactionResult = {
  text: string;
  /** Placeholder -> original, so a response can be re-hydrated locally. */
  map: Map<string, string>;
  count: number;
};

// Order matters: GSTIN embeds a PAN, so GSTIN must be matched first or the PAN
// pattern would eat the middle of every GSTIN.
const PATTERNS: { label: string; regex: RegExp }[] = [
  { label: "GSTIN", regex: /\b[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z][1-9A-Z]Z[0-9A-Z]\b/g },
  { label: "PAN", regex: /\b[A-Z]{5}[0-9]{4}[A-Z]\b/g },
  // Aadhaar: 12 digits, optionally spaced in groups of four.
  { label: "AADHAAR", regex: /\b[2-9][0-9]{3}[ -]?[0-9]{4}[ -]?[0-9]{4}\b/g },
  { label: "IFSC", regex: /\b[A-Z]{4}0[A-Z0-9]{6}\b/g },
  { label: "EMAIL", regex: /\b[\w.+-]+@[\w-]+\.[\w.-]+\b/g },
  // Indian mobile numbers, with or without +91.
  { label: "PHONE", regex: /(\+?91[-\s]?)?\b[6-9][0-9]{9}\b/g },
  // Bank account numbers: 9-18 digits. Deliberately last, and narrow enough not
  // to swallow invoice amounts (which are formatted with separators).
  { label: "ACCOUNT", regex: /\b[0-9]{11,18}\b/g },
];

/**
 * Replace identifiers with stable placeholders.
 *
 * The same value always maps to the same placeholder within one call, so a model
 * can still reason about "the same customer appears twice" without knowing who
 * they are.
 */
export function redactPii(input: string): RedactionResult {
  if (!input) return { text: input, map: new Map(), count: 0 };

  const map = new Map<string, string>();
  const seen = new Map<string, string>();
  // Counted PER LABEL, not globally. A global counter produces things like
  // "[PHONE_2]" with no [PHONE_1] anywhere in the text, which reads as a bug and
  // makes the placeholders harder for a model to reason about.
  const perLabelCount = new Map<string, number>();
  let count = 0;
  let text = input;

  for (const { label, regex } of PATTERNS) {
    text = text.replace(regex, (match) => {
      const existing = seen.get(match);
      if (existing) return existing;

      count += 1;
      const next = (perLabelCount.get(label) ?? 0) + 1;
      perLabelCount.set(label, next);

      const placeholder = `[${label}_${next}]`;
      seen.set(match, placeholder);
      map.set(placeholder, match);
      return placeholder;
    });
  }

  return { text, map, count };
}

/** Put the real values back into a model response, locally. */
export function rehydrate(text: string, map: Map<string, string>): string {
  let out = text;
  for (const [placeholder, original] of map) {
    out = out.split(placeholder).join(original);
  }
  return out;
}

/**
 * Whether redaction is switched on.
 *
 * The `local` provider is exempt: an on-premise model means nothing leaves the
 * machine, and redacting would only make its answers worse.
 */
export function shouldRedact(provider: string): boolean {
  if (provider === "local" || provider === "mock") return false;
  return process.env.AI_REDACT_PII !== "false";
}
