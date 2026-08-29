"use client";

/**
 * Client-side translation context.
 *
 * Server components read the locale from the user record directly and call
 * `getTranslator()`. Client components need it through React context, which this
 * provides.
 *
 * The provider is mounted in the authenticated layout with the locale resolved
 * server-side, so there is no flash of untranslated content and no client-side
 * fetch to discover the language.
 */

import { createContext, useContext, useMemo } from "react";
import {
  DEFAULT_LOCALE,
  getTranslator,
  type Locale,
  type TranslationKey,
  type Translator,
} from "./index";

const LocaleContext = createContext<Translator>(getTranslator(DEFAULT_LOCALE));

export function LocaleProvider({
  locale,
  children,
}: {
  locale: Locale;
  children: React.ReactNode;
}) {
  const value = useMemo(() => getTranslator(locale), [locale]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

/**
 * Translate inside a client component.
 *
 *   const { t, locale } = useT();
 *   <button>{t("action.save")}</button>
 */
export function useT(): Translator {
  return useContext(LocaleContext);
}

/** Convenience for components that only need the function. */
export function useTranslate(): (
  key: TranslationKey,
  vars?: Record<string, string | number>
) => string {
  return useContext(LocaleContext).t;
}
