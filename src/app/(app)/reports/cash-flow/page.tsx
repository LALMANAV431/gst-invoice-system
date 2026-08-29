import Link from "next/link";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { getCashFlow } from "@/server/ledger";
import { formatPaise } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { getTranslator, normaliseLocale } from "@/lib/i18n";
import { financialYearRange } from "@/server/numbering";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CashFlowPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;
  const { t } = getTranslator(normaliseLocale(ctx.user.locale));

  const fy = financialYearRange(new Date());
  const from = searchParams.from ? new Date(searchParams.from) : fy.start;
  const to = searchParams.to ? new Date(searchParams.to) : new Date();
  to.setHours(23, 59, 59, 999);

  const cf = await getCashFlow(ctx.company.id, from, to);

  const sections = [
    { key: "OPERATING" as const, title: "Operating activities", total: cf.operatingPaise },
    { key: "INVESTING" as const, title: "Investing activities", total: cf.investingPaise },
    { key: "FINANCING" as const, title: "Financing activities", total: cf.financingPaise },
  ];

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/reports" className="btn-ghost p-2">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold">{t("report.cashFlow")}</h1>
          <p className="text-sm text-slate-500">
            {formatDate(from)} — {formatDate(to)}
          </p>
        </div>
      </div>

      <form className="card card-padding flex flex-wrap items-end gap-3">
        <div>
          <label className="label">{t("label.from")}</label>
          <input type="date" name="from" defaultValue={from.toISOString().slice(0, 10)} className="input" />
        </div>
        <div>
          <label className="label">{t("label.to")}</label>
          <input type="date" name="to" defaultValue={to.toISOString().slice(0, 10)} className="input" />
        </div>
        <button className="btn-primary">{t("action.apply")}</button>
      </form>

      <div className="grid gap-4 md:grid-cols-2">
        <div className="card card-padding">
          <div className="text-sm text-slate-500">{t("report.opening")} cash &amp; bank</div>
          <div className="mt-1 text-2xl font-bold">{formatPaise(cf.openingPaise)}</div>
        </div>
        <div className="card card-padding">
          <div className="text-sm text-slate-500">{t("report.closing")} cash &amp; bank</div>
          <div
            className={`mt-1 text-2xl font-bold ${cf.closingPaise < 0 ? "text-rose-600" : "text-emerald-600"}`}
          >
            {formatPaise(cf.closingPaise)}
          </div>
        </div>
      </div>

      {sections.map((section) => {
        const lines = cf.lines.filter((l) => l.activity === section.key);
        return (
          <div key={section.key} className="card overflow-hidden">
            <div className="flex items-center justify-between border-b border-slate-200 px-5 py-3">
              <span className="font-semibold">{section.title}</span>
              <span
                className={`font-semibold ${section.total < 0 ? "text-rose-600" : "text-emerald-600"}`}
              >
                {formatPaise(section.total)}
              </span>
            </div>
            <table className="table">
              <tbody>
                {lines.length === 0 ? (
                  <tr>
                    <td colSpan={2} className="py-5 text-center text-sm text-slate-500">
                      No movements in this category.
                    </td>
                  </tr>
                ) : (
                  lines.map((l) => (
                    <tr key={`${section.key}-${l.name}`}>
                      <td>{l.name}</td>
                      <td
                        className={`text-right ${l.amountPaise < 0 ? "text-rose-600" : "text-emerald-600"}`}
                      >
                        {formatPaise(l.amountPaise)}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        );
      })}

      <div className="card card-padding flex items-center justify-between">
        <span className="font-bold">Net change in cash</span>
        <span
          className={`text-xl font-bold ${
            cf.closingPaise - cf.openingPaise < 0 ? "text-rose-600" : "text-emerald-600"
          }`}
        >
          {formatPaise(cf.closingPaise - cf.openingPaise)}
        </span>
      </div>

      <p className="text-xs text-slate-500">
        Prepared by the direct method: every movement through a cash or bank ledger is classified
        by what it was paired with. Positive figures increased cash. Activities are classified by
        ledger group, so ledgers you create yourself are categorised automatically.
      </p>
    </div>
  );
}
