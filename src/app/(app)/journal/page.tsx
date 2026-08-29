import Link from "next/link";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { ensureChartOfAccounts } from "@/server/ledger";
import { formatPaise } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { getTranslator, normaliseLocale } from "@/lib/i18n";
import JournalForm from "./JournalForm";

export const dynamic = "force-dynamic";

/**
 * Journal and contra vouchers.
 *
 * Covers the entries no document produces: depreciation, provisions, corrections,
 * and cash-to-bank transfers. The posting engine is the same one the automatic
 * postings use, so a manual entry cannot bypass the balance invariant.
 */
export default async function JournalPage() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;
  const companyId = ctx.company.id;
  const { t } = getTranslator(normaliseLocale(ctx.user.locale));

  // A company created before the accounting engine existed has no chart yet.
  const groupCount = await db.ledgerGroup.count({ where: { companyId } });
  if (groupCount === 0) await ensureChartOfAccounts(db, companyId);

  const [ledgers, recent] = await Promise.all([
    db.ledger.findMany({
      where: { companyId },
      select: {
        id: true,
        name: true,
        group: { select: { name: true } },
      },
      orderBy: { name: "asc" },
    }),
    db.journalEntry.findMany({
      where: { companyId, voucherType: { in: ["JOURNAL", "CONTRA"] } },
      include: {
        lines: { include: { ledger: { select: { name: true } } } },
      },
      orderBy: [{ date: "desc" }, { createdAt: "desc" }],
      take: 20,
    }),
  ]);

  const options = ledgers.map((l) => ({
    id: l.id,
    name: l.name,
    groupName: l.group.name,
    isCash: l.group.name === "Cash-in-Hand" || l.group.name === "Bank Accounts",
  }));

  return (
    <div className="space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold">{t("doc.journalVoucher")}</h1>
          <p className="text-sm text-slate-500">
            Manual entries and cash ↔ bank transfers. Debits must equal credits.
          </p>
        </div>
        <Link href="/reports/trial-balance" className="btn-secondary text-sm">
          {t("report.trialBalance")}
        </Link>
      </div>

      <JournalForm ledgers={options} />

      <div className="card overflow-hidden">
        <div className="border-b border-slate-200 px-5 py-3 font-semibold">
          Recent vouchers
        </div>
        {recent.length === 0 ? (
          <div className="py-8 text-center text-sm text-slate-500">
            No manual vouchers yet.
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="table">
              <thead>
                <tr>
                  <th>{t("label.date")}</th>
                  <th>{t("doc.number")}</th>
                  <th>Type</th>
                  <th>Narration</th>
                  <th className="text-right">{t("label.amount")}</th>
                </tr>
              </thead>
              <tbody>
                {recent.map((entry) => {
                  // Debits equal credits by construction, so either side is the
                  // voucher's value.
                  const amountPaise = entry.lines.reduce((s, l) => s + l.debitPaise, 0);
                  return (
                    <tr key={entry.id}>
                      <td className="whitespace-nowrap">{formatDate(entry.date)}</td>
                      <td className="whitespace-nowrap text-xs">{entry.voucherNo}</td>
                      <td>
                        <span
                          className={
                            entry.voucherType === "CONTRA" ? "badge-slate" : "badge-brand"
                          }
                        >
                          {entry.voucherType}
                        </span>
                      </td>
                      <td>
                        <div>{entry.narration}</div>
                        <div className="text-xs text-slate-500">
                          {entry.lines
                            .map(
                              (l) =>
                                `${l.ledger.name} ${l.debitPaise > 0 ? "Dr" : "Cr"} ${formatPaise(
                                  l.debitPaise > 0 ? l.debitPaise : l.creditPaise
                                )}`
                            )
                            .join(" · ")}
                        </div>
                      </td>
                      <td className="text-right font-medium">{formatPaise(amountPaise)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
