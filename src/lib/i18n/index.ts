/**
 * Internationalisation.
 *
 * The original README claimed "Multi-Language Support" but the UI was entirely
 * English. Hindi matters here more than in most products: the target user is a
 * shopkeeper who may not read English comfortably, and an accounting app they
 * cannot read is an accounting app they will not trust.
 *
 * DESIGN
 * ------
 * A plain typed dictionary rather than a library. `next-intl` and friends bring
 * routing changes (locale path segments), middleware integration and a bundle
 * cost; for two locales and a flat key set, a dictionary lookup is simpler and
 * has no runtime dependency. Swapping to a library later only touches this file.
 *
 * Missing translations are a COMPILE error, not a runtime fallback, because a
 * half-translated screen is worse than an untranslated one — the user cannot
 * tell which parts they can rely on.
 */

import { en, type Dictionary, type TranslationKey } from "./en";
import { hi } from "./hi";

export type Locale = "en" | "hi";

export const LOCALES: Locale[] = ["en", "hi"];

export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  hi: "हिंदी",
};

const DICTIONARIES: Record<Locale, Dictionary> = { en, hi };

export const DEFAULT_LOCALE: Locale =
  (process.env.NEXT_PUBLIC_DEFAULT_LOCALE as Locale) === "hi" ? "hi" : "en";

/** Narrow arbitrary input to a supported locale. */
export function normaliseLocale(value: unknown): Locale {
  return value === "hi" ? "hi" : "en";
}

export type Translator = {
  /** Look up a key, optionally interpolating `{name}` placeholders. */
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
  locale: Locale;
};

/**
 * Build a translator for a locale.
 *
 * Interpolation uses `{name}` rather than a template engine so translated
 * strings stay plain data and cannot execute anything.
 */
export function getTranslator(locale: Locale): Translator {
  const dict = DICTIONARIES[locale] ?? en;

  return {
    locale,
    t(key, vars) {
      const template = dict[key] ?? en[key] ?? String(key);
      if (!vars) return template;
      return template.replace(/\{(\w+)\}/g, (match, name: string) =>
        name in vars ? String(vars[name]) : match
      );
    },
  };
}

export { en, hi };
export type { Dictionary, TranslationKey };
