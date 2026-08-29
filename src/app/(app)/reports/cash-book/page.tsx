import Link from "next/link";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { getCashBook } from "@/server/ledger";
import { formatPaise } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { getTranslator, normaliseLocale } from "@/lib/i18n";
import { financialYearRange } from "@/server/numbering";
import { ArrowLeft, ArrowDownLeft, ArrowUpRight } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function CashBookPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string; ledgerId?: string };
}) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;
  const { t } = getTranslator(normaliseLocale(ctx.user.locale));

  const fy = financialYearRange(new Date());
  const from = searchParams.from ? new Date(searchParams.from) : fy.start;
  const to = searchParams.to ? new Date(searchParams.to) : new Date();
  to.setHours(23, 59, 59, 999);

  const book = await getCashBook(ctx.company.id, from, to, searchParams.ledgerId);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/reports" className="btn-ghost p-2">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold">{t("report.cashBook")}</h1>
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
        <div>
          <label className="label">Account</label>
          <select name="ledgerId" defaultValue={searchParams.ledgerId ?? ""} className="input">
            <option value="">All cash &amp; bank</option>
            {book.ledgers.map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
          </select>
        </div>
        <button className="btn-primary">{t("action.apply")}</button>
      </form>

      <div className="grid gap-4 md:grid-cols-4">
        <Kpi label={t("report.opening")} value={formatPaise(book.openingPaise)} />
        <Kpi
          label="Money in"
          value={formatPaise(book.inflowPaise)}
          tone="emerald"
          icon={<ArrowDownLeft className="h-4 w-4" />}
        />
        <Kpi
          label="Money out"
          value={formatPaise(book.outflowPaise)}
          tone="rose"
          icon={<ArrowUpRight className="h-4 w-4" />}
        />
        <Kpi
          label={t("report.closing")}
          value={formatPaise(book.closingPaise)}
          tone={book.closingPaise < 0 ? "rose" : "emerald"}
        />
      </div>

      {book.closingPaise < 0 && (
        <div className="card card-padding border-amber-300 bg-amber-50 text-sm text-amber-800">
          Closing cash is negative. That is usually a missing receipt or a payment
          recorded against the wrong account — physical cash cannot go below zero.
        </div>
      )}

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>{t("label.date")}</th>
              <th>{t("doc.number")}</th>
              <th>Account</th>
              <th>Particulars</th>
              <th className="text-right">In</th>
              <th className="text-right">Out</th>
              <th className="text-right">{t("label.balance")}</th>
            </tr>
          </thead>
          <tbody>
            <tr className="bg-slate-50 dark:bg-slate-800/50">
              <td colSpan={6} className="font-medium">
                {t("report.opening")}
              </td>
              <td className="text-right font-medium">{formatPaise(book.openingPaise)}</td>
            </tr>
            {book.rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="py-8 text-center text-slate-500">
                  {t("report.noEntries")}
                </td>
              </tr>
            ) : (
              book.rows.map((r) => (
                <tr key={r.id}>
                  <td className="whitespace-nowrap">{formatDate(r.date)}</td>
                  <td className="whitespace-nowrap text-xs">{r.voucherNo}</td>
                  <td className="text-xs text-slate-500">{r.accountName}</td>
                  <td>{r.particulars}</td>
                  <td className="text-right text-emerald-600">
                    {r.inflowPaise > 0 ? formatPaise(r.inflowPaise) : ""}
                  </td>
                  <td className="text-right text-rose-600">
                    {r.outflowPaise > 0 ? formatPaise(r.outflowPaise) : ""}
                  </td>
                  <td className="text-right font-medium">{formatPaise(r.runningPaise)}</td>
                </tr>
              ))
            )}
          </tbody>
          {book.rows.length > 0 && (
            <tfoot>
              <tr className="font-bold">
                <td colSpan={4}>{t("report.closing")}</td>
                <td className="text-right">{formatPaise(book.inflowPaise)}</td>
                <td className="text-right">{formatPaise(book.outflowPaise)}</td>
                <td className="text-right">{formatPaise(book.closingPaise)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
  icon,
}: {
  label: string;
  value: string;
  tone?: "emerald" | "rose";
  icon?: React.ReactNode;
}) {
  const colour =
    tone === "emerald" ? "text-emerald-600" : tone === "rose" ? "text-rose-600" : "";
  return (
    <div className="card card-padding">
      <div className="flex items-center gap-1.5 text-sm text-slate-500">
        {icon}
        {label}
      </div>
      <div className={`mt-1 text-xl font-bold ${colour}`}>{value}</div>
    </div>
  );
}
