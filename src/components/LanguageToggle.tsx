"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Languages } from "lucide-react";
import { LOCALE_LABELS, LOCALES, type Locale } from "@/lib/i18n";
import { useT } from "@/lib/i18n/client";
import { cn } from "@/lib/utils";

/**
 * Language switcher.
 *
 * Persists to the server and then calls `router.refresh()`, because the locale
 * is resolved in server components — a purely client-side state change would
 * leave every server-rendered label in the old language.
 */
export default function LanguageToggle({ current }: { current: Locale }) {
  const router = useRouter();
  const { t } = useT();
  const [locale, setLocale] = useState<Locale>(current);
  const [pending, startTransition] = useTransition();

  async function change(next: Locale) {
    if (next === locale || pending) return;

    // Optimistic, so the button reflects the choice immediately on a slow phone.
    const previous = locale;
    setLocale(next);

    try {
      const res = await fetch("/api/me/locale", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ locale: next }),
      });
      if (!res.ok) throw new Error("failed");
      startTransition(() => router.refresh());
    } catch {
      setLocale(previous);
      toast.error(t("state.error"));
    }
  }

  return (
    <div
      className="inline-flex items-center gap-1 rounded-lg border border-slate-200 p-0.5 dark:border-slate-700"
      role="group"
      aria-label={t("settings.language")}
    >
      <Languages className="ml-1.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
      {LOCALES.map((l) => (
        <button
          key={l}
          type="button"
          onClick={() => change(l)}
          disabled={pending}
          aria-pressed={locale === l}
          className={cn(
            "rounded-md px-2 py-1 text-xs font-medium transition-colors disabled:opacity-60",
            locale === l
              ? "bg-brand-600 text-white"
              : "text-slate-600 hover:bg-slate-100 dark:text-slate-300 dark:hover:bg-slate-800"
          )}
        >
          {LOCALE_LABELS[l]}
        </button>
      ))}
    </div>
  );
}
