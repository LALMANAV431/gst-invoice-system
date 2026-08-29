import Link from "next/link";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { getBalanceSheet } from "@/server/ledger";
import { formatPaise } from "@/lib/money";
import { AlertTriangle, ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function BalanceSheetPage({
  searchParams,
}: {
  searchParams: { asOn?: string };
}) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;

  const asOn = searchParams.asOn ? new Date(searchParams.asOn) : new Date();
  const bs = await getBalanceSheet(ctx.company.id, asOn);

  const liabilitiesSide = [
    ...bs.liabilityLines,
    ...bs.equityLines,
    // Current-period profit belongs on the equity side until year-end closing
    // transfers it to retained earnings. Without this the sheet would not
    // balance for the current year.
    ...(bs.netProfitPaise !== 0
      ? [
          {
            name: bs.netProfitPaise > 0 ? "Profit for the period" : "Loss for the period",
            amountPaise: bs.netProfitPaise,
          },
        ]
      : []),
  ];

  const liabilitiesTotal = bs.liabilitiesPaise + bs.equityPaise + bs.netProfitPaise;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/reports" className="btn-ghost p-2">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold">Balance Sheet</h1>
          <p className="text-sm text-slate-500">
            As on{" "}
            {asOn.toLocaleDateString("en-IN", {
              day: "2-digit",
              month: "short",
              year: "numeric",
            })}
          </p>
        </div>
      </div>

      <form className="card card-padding flex flex-wrap items-end gap-3">
        <div>
          <label className="label">As on</label>
          <input
            type="date"
            name="asOn"
            defaultValue={asOn.toISOString().slice(0, 10)}
            className="input"
          />
        </div>
        <button className="btn-primary">Apply</button>
      </form>

      {bs.differencePaise !== 0 && (
        <div className="card card-padding flex items-start gap-3 border-rose-300 bg-rose-50">
          <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-600" />
          <div className="text-sm">
            <div className="font-semibold text-rose-800">Balance sheet does not balance</div>
            <div className="text-rose-700">
              Assets exceed liabilities and equity by {formatPaise(bs.differencePaise)}. Check the
              trial balance — this points to a data problem rather than a reporting one.
            </div>
          </div>
        </div>
      )}

      <div className="grid gap-4 md:grid-cols-2">
        <Side
          title="Liabilities & Equity"
          lines={liabilitiesSide}
          total={liabilitiesTotal}
          empty="Nothing recorded yet."
        />
        <Side
          title="Assets"
          lines={bs.assetLines}
          total={bs.assetsPaise}
          empty="Nothing recorded yet."
        />
      </div>

      <p className="text-xs text-slate-500">
        Built from posted ledger entries. Profit for the period is shown on the equity side until
        year-end closing moves it to retained earnings. Not a substitute for a CA-reviewed statement.
      </p>
    </div>
  );
}

function Side({
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
            <td>Total</td>
            <td className="text-right">{formatPaise(total)}</td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}
