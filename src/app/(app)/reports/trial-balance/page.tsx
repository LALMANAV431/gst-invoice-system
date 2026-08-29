import Link from "next/link";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { getTrialBalance } from "@/server/ledger";
import { formatPaise } from "@/lib/money";
import { ArrowLeft, AlertTriangle, CheckCircle2 } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function TrialBalancePage({
  searchParams,
}: {
  searchParams: { to?: string };
}) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;

  const to = searchParams.to ? new Date(searchParams.to) : new Date();
  const tb = await getTrialBalance(ctx.company.id, to);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/reports" className="btn-ghost p-2">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold">Trial Balance</h1>
          <p className="text-sm text-slate-500">
            As on {to.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" })}
          </p>
        </div>
      </div>

      <form className="card card-padding flex flex-wrap items-end gap-3">
        <div>
          <label className="label">As on</label>
          <input type="date" name="to" defaultValue={to.toISOString().slice(0, 10)} className="input" />
        </div>
        <button className="btn-primary">Apply</button>
      </form>

      {/*
        A trial balance that does not sum to zero means the books are broken.
        Surfacing it prominently is the point of the report - a silently wrong
        trial balance is worse than no trial balance.
      */}
      <div
        className={`card card-padding flex items-start gap-3 ${
          tb.isBalanced ? "border-emerald-200 bg-emerald-50" : "border-rose-300 bg-rose-50"
        }`}
      >
        {tb.isBalanced ? (
          <CheckCircle2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-600" />
        ) : (
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
        )}
        <div className="text-sm">
          {tb.isBalanced ? (
            <>
              <div className="font-semibold text-emerald-800">Books balance</div>
              <div className="text-emerald-700">
                Total debits equal total credits at {formatPaise(tb.totalDebitPaise)}.
              </div>
            </>
          ) : (
            <>
              <div className="font-semibold text-rose-800">Books do not balance</div>
              <div className="text-rose-700">
                Debits {formatPaise(tb.totalDebitPaise)} vs credits{" "}
                {formatPaise(tb.totalCreditPaise)} — a difference of{" "}
                {formatPaise(Math.abs(tb.differencePaise))}. This indicates a data problem;
                contact support before relying on any financial statement.
              </div>
            </>
          )}
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Ledger</th>
              <th>Group</th>
              <th className="text-right">Debit</th>
              <th className="text-right">Credit</th>
            </tr>
          </thead>
          <tbody>
            {tb.rows.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-8 text-center text-slate-500">
                  No ledger entries yet. Create an invoice or record a payment to see balances here.
                </td>
              </tr>
            ) : (
              tb.rows.map((r) => (
                <tr key={r.ledgerId}>
                  <td className="font-medium">{r.ledgerName}</td>
                  <td className="text-slate-500">{r.groupName}</td>
                  <td className="text-right">
                    {r.closingPaise > 0 ? formatPaise(r.closingPaise) : ""}
                  </td>
                  <td className="text-right">
                    {r.closingPaise < 0 ? formatPaise(-r.closingPaise) : ""}
                  </td>
                </tr>
              ))
            )}
          </tbody>
          {tb.rows.length > 0 && (
            <tfoot>
              <tr className="font-bold">
                <td colSpan={2}>Total</td>
                <td className="text-right">{formatPaise(tb.totalDebitPaise)}</td>
                <td className="text-right">{formatPaise(tb.totalCreditPaise)}</td>
              </tr>
            </tfoot>
          )}
        </table>
      </div>
    </div>
  );
}
