import { getCurrentUserAndCompany } from "@/lib/auth";
import { getAiStatus } from "@/server/ai/service";
import { getTranslator, normaliseLocale } from "@/lib/i18n";
import AssistantClient from "./AssistantClient";

export const dynamic = "force-dynamic";

/**
 * AI assistant page.
 *
 * Status is resolved on the server so the page renders the correct state
 * immediately — a user whose plan or deployment has AI switched off sees a clear
 * explanation rather than an input box that fails when they press send.
 */
export default async function AssistantPage() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;

  const status = await getAiStatus(ctx.company.id);
  const { t } = getTranslator(normaliseLocale(ctx.user.locale));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{t("ai.title")}</h1>
        <p className="text-sm text-slate-500">{t("ai.ask")}</p>
      </div>

      {!status.available ? (
        <div className="card card-padding">
          <div className="font-semibold">{t("ai.disabled")}</div>
          <p className="mt-1 text-sm text-slate-500">{t("ai.disabledHint")}</p>
          <p className="mt-3 text-xs text-slate-400">
            Everything else in this application works without AI. Nothing is degraded while it
            is switched off.
          </p>
        </div>
      ) : (
        <AssistantClient
          mock={status.mock}
          provider={status.provider}
          remainingTokens={status.remainingTokens}
          budgetTokens={status.budgetTokens}
        />
      )}
    </div>
  );
}
