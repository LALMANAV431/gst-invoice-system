"use client";

import { useState } from "react";
import { Send, Sparkles, Info } from "lucide-react";
import toast from "react-hot-toast";
import { useT } from "@/lib/i18n/client";

type Turn = { role: "user" | "assistant"; text: string; cached?: boolean };

const SUGGESTIONS = [
  "आज कितनी सेल हुई?",
  "How much do customers owe me?",
  "इस महीने GST कितना देना है?",
  "Which items are low on stock?",
];

/**
 * Assistant chat.
 *
 * Answers are grounded server-side: the API gathers real figures from the ledger
 * and the model only phrases them. That is why this UI does not attempt any
 * calculation of its own — doing so could disagree with the books.
 */
export default function AssistantClient({
  mock,
  provider,
  remainingTokens,
  budgetTokens,
}: {
  mock: boolean;
  provider: string;
  remainingTokens: number;
  budgetTokens: number;
}) {
  const { t } = useT();
  const [question, setQuestion] = useState("");
  const [turns, setTurns] = useState<Turn[]>([]);
  const [loading, setLoading] = useState(false);

  async function send(text: string) {
    const q = text.trim();
    if (!q || loading) return;

    setTurns((prev) => [...prev, { role: "user", text: q }]);
    setQuestion("");
    setLoading(true);

    try {
      const res = await fetch("/api/ai/assistant", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q }),
      });
      const data = await res.json();

      if (!res.ok) {
        // A budget or availability problem is a normal state with a clear
        // message, not a crash.
        toast.error(data.error ?? t("state.error"));
        setTurns((prev) => [
          ...prev,
          { role: "assistant", text: data.error ?? t("state.error") },
        ]);
        return;
      }

      setTurns((prev) => [
        ...prev,
        { role: "assistant", text: data.answer, cached: data.cached },
      ]);
    } catch {
      toast.error(t("state.error"));
    } finally {
      setLoading(false);
    }
  }

  const usedPercent = budgetTokens > 0
    ? Math.min(100, Math.round(((budgetTokens - remainingTokens) / budgetTokens) * 100))
    : 0;

  return (
    <div className="space-y-3">
      {mock && (
        <div className="card card-padding flex items-start gap-2 border-sky-200 bg-sky-50 text-sm dark:border-sky-900 dark:bg-sky-950/40">
          <Info className="mt-0.5 h-4 w-4 shrink-0 text-sky-600" />
          <div>
            <div className="font-medium text-sky-900 dark:text-sky-200">{t("ai.mockMode")}</div>
            <div className="text-xs text-sky-700 dark:text-sky-300">
              Provider: {provider}. No data is sent anywhere and nothing is charged.
            </div>
          </div>
        </div>
      )}

      <div className="card min-h-[280px] p-4">
        {turns.length === 0 ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 py-8 text-center">
            <Sparkles className="h-8 w-8 text-slate-300" />
            <p className="text-sm text-slate-500">{t("ai.ask")}</p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((s) => (
                <button
                  key={s}
                  type="button"
                  onClick={() => send(s)}
                  className="rounded-full border border-slate-200 px-3 py-1.5 text-xs text-slate-600 hover:bg-slate-50 dark:border-slate-700 dark:text-slate-300 dark:hover:bg-slate-800"
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            {turns.map((turn, i) => (
              <div
                key={i}
                className={turn.role === "user" ? "flex justify-end" : "flex justify-start"}
              >
                <div
                  className={
                    turn.role === "user"
                      ? "max-w-[80%] rounded-2xl rounded-br-sm bg-brand-600 px-3.5 py-2 text-sm text-white"
                      : "max-w-[80%] rounded-2xl rounded-bl-sm bg-slate-100 px-3.5 py-2 text-sm text-slate-800 dark:bg-slate-800 dark:text-slate-100"
                  }
                >
                  {turn.text}
                  {turn.cached && (
                    <span className="ml-2 text-[10px] uppercase tracking-wide opacity-60">
                      cached
                    </span>
                  )}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-sm bg-slate-100 px-3.5 py-2 text-sm text-slate-500 dark:bg-slate-800">
                  {t("ai.thinking")}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      <form
        onSubmit={(e) => {
          e.preventDefault();
          send(question);
        }}
        className="flex gap-2"
      >
        <input
          className="input flex-1"
          value={question}
          onChange={(e) => setQuestion(e.target.value)}
          placeholder={t("ai.askPlaceholder")}
          maxLength={500}
          disabled={loading}
        />
        <button className="btn-primary" disabled={loading || !question.trim()}>
          <Send className="h-4 w-4" />
        </button>
      </form>

      <div className="flex items-center justify-between text-xs text-slate-500">
        <span>{t("ai.needsApproval")}</span>
        <span>
          {t("ai.usage")}: {usedPercent}%
        </span>
      </div>
    </div>
  );
}
