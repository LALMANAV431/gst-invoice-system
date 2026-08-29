import Link from "next/link";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { getProfitAndLoss } from "@/server/ledger";
import { formatPaise } from "@/lib/money";
import { financialYearRange } from "@/server/numbering";
import { ArrowLeft, TrendingDown, TrendingUp } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ProfitLossPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;

  // Default to the current financial year, which is what an Indian business
  // expects to see rather than a calendar year.
  const fy = financialYearRange(new Date());
  const from = searchParams.from ? new Date(searchParams.from) : fy.start;
  const to = searchParams.to ? new Date(searchParams.to) : new Date();

  const pl = await getProfitAndLoss(ctx.company.id, from, to);
  const isProfit = pl.netProfitPaise >= 0;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/reports" className="btn-ghost p-2">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold">Profit &amp; Loss</h1>
          <p className="text-sm text-slate-500">
            {from.toLocaleDateString("en-IN")} to {to.toLocaleDateString("en-IN")}
          </p>
        </div>
      </div>

      <form className="card card-padding flex flex-wrap items-end gap-3">
        <div>
          <label className="label">From</label>
          <input type="date" name="from" defaultValue={from.toISOString().slice(0, 10)} className="input" />
        </div>
        <div>
          <label className="label">To</label>
          <input type="date" name="to" defaultValue={to.toISOString().slice(0, 10)} className="input" />
        </div>
        <button className="btn-primary">Apply</button>
      </form>

      <div className="grid gap-4 md:grid-cols-3">
        <Kpi label="Total Income" value={formatPaise(pl.incomePaise)} tone="emerald" />
        <Kpi label="Total Expenses" value={formatPaise(pl.expensePaise)} tone="amber" />
        <Kpi
          label={isProfit ? "Net Profit" : "Net Loss"}
          value={formatPaise(Math.abs(pl.netProfitPaise))}
          tone={isProfit ? "emerald" : "rose"}
          icon={isProfit ? <TrendingUp className="h-4 w-4" /> : <TrendingDown className="h-4 w-4" />}
        />
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        <Section
          title="Income"
          lines={pl.incomeLines}
          total={pl.incomePaise}
          empty="No income recorded in this period."
        />
        <Section
          title="Expenses"
          lines={pl.expenseLines}
          total={pl.expensePaise}
          empty="No expenses recorded in this period."
        />
      </div>

      <div className="card card-padding flex items-center justify-between">
        <span className="font-bold">{isProfit ? "Net Profit" : "Net Loss"}</span>
        <span className={`text-xl font-bold ${isProfit ? "text-emerald-600" : "text-rose-600"}`}>
          {formatPaise(Math.abs(pl.netProfitPaise))}
        </span>
      </div>

      <p className="text-xs text-slate-500">
        Figures come from posted ledger entries, not from summing documents, so this statement
        always agrees with the trial balance. Have a Chartered Accountant review before filing.
      </p>
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
  tone: "emerald" | "amber" | "rose";
  icon?: React.ReactNode;
}) {
  const tones = {
    emerald: "text-emerald-600",
    amber: "text-amber-600",
    rose: "text-rose-600",
  };
  return (
    <div className="card card-padding">
      <div className="flex items-center gap-2 text-sm text-slate-500">
        {icon}
        {label}
      </div>
      <div className={`mt-1 text-2xl font-bold ${tones[tone]}`}>{value}</div>
    </div>
  );
}

function Section({
  title,
  lines,
  total,
  empty,
}: {
  title: string;
  lines: { name: string; amountPaise: number }[];
  total: number;
  empty: string;
}) {
  return (
    <div className="card overflow-hidden">
      <div className="border-b border-slate-200 px-5 py-3 font-semibold">{title}</div>
      <table className="table">
        <tbody>
          {lines.length === 0 ? (
            <tr>
              <td colSpan={2} className="py-6 text-center text-sm text-slate-500">
                {empty}
              </td>
            </tr>
          ) : (
            lines.map((l) => (
              <tr key={l.name}>
                <td>{l.name}</td>
                <td className="text-right">{formatPaise(l.amountPaise)}</td>
              </tr>
            ))
          )}
        </tbody>
        <tfoot>
          <tr className="font-bold">
            <td>Total {title}</td>
            <td className="text-right">{formatPaise(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
