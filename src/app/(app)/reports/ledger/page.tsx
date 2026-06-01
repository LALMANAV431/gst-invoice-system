import Link from "next/link";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { formatINR, formatDate } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

type Row = {
  date: Date;
  particulars: string;
  voucher: string;
  debit: number;
  credit: number;
};

export default async function LedgerPage({
  searchParams,
}: {
  searchParams: { partyId?: string };
}) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;
  const companyId = ctx.company.id;

  const parties = await db.party.findMany({
    where: { companyId },
    orderBy: { name: "asc" },
  });

  const partyId = searchParams.partyId || parties[0]?.id;
  const party = partyId ? parties.find((p) => p.id === partyId) : null;

  let rows: Row[] = [];
  let openingDebit = 0;
  let openingCredit = 0;

  if (party) {
    const [invoices, purchases, payments, notes] = await Promise.all([
      db.invoice.findMany({ where: { companyId, partyId: party.id } }),
      db.purchase.findMany({ where: { companyId, partyId: party.id } }),
      db.payment.findMany({ where: { companyId, partyId: party.id } }),
      db.creditNote.findMany({ where: { companyId, partyId: party.id } }),
    ]);

    if (party.openingBalance > 0) {
      if (party.balanceType === "RECEIVABLE") openingDebit = party.openingBalance;
      else openingCredit = party.openingBalance;
    }

    rows = [
      ...invoices.map((i) => ({
        date: i.date,
        particulars: "Sales Invoice",
        voucher: i.number,
        debit: i.grandTotal,
        credit: 0,
      })),
      ...purchases.map((p) => ({
        date: p.date,
        particulars: "Purchase Bill",
        voucher: p.number,
        debit: 0,
        credit: p.grandTotal,
      })),
      ...payments.map((p) => ({
        date: p.date,
        particulars: p.type === "RECEIVED" ? "Receipt" : "Payment",
        voucher: p.number,
        debit: p.type === "PAID" ? p.amount : 0,
        credit: p.type === "RECEIVED" ? p.amount : 0,
      })),
      ...notes.map((n) => ({
        date: n.date,
        particulars: n.kind === "CREDIT" ? "Credit Note" : "Debit Note",
        voucher: n.number,
        debit: n.kind === "DEBIT" ? n.grandTotal : 0,
        credit: n.kind === "CREDIT" ? n.grandTotal : 0,
      })),
    ].sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
  }

  // Running balance
  let running = openingDebit - openingCredit;
  const totalDebit = openingDebit + rows.reduce((s, r) => s + r.debit, 0);
  const totalCredit = openingCredit + rows.reduce((s, r) => s + r.credit, 0);
  const closing = totalDebit - totalCredit;

  return (
    <div className="space-y-4">
      <div>
        <Link href="/reports" className="btn-ghost text-sm -ml-2 mb-1">
          <ArrowLeft className="h-4 w-4" /> Reports
        </Link>
        <h1 className="text-2xl font-bold">Party Ledger / Statement of Account</h1>
        <p className="text-sm text-slate-500">Running balance of all transactions for a party</p>
      </div>

      <form className="card card-padding flex flex-wrap gap-3 items-end">
        <div className="min-w-[260px]">
          <label className="label">Select party</label>
          <select name="partyId" defaultValue={partyId} className="input">
            {parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <button className="btn-primary">View Ledger</button>
      </form>

      {party && (
        <div className="card card-padding">
          <div className="flex flex-wrap justify-between gap-2 mb-4">
            <div>
              <h2 className="font-semibold text-lg">{party.name}</h2>
              {party.gstin && <p className="text-xs text-slate-500">GSTIN: {party.gstin}</p>}
            </div>
            <div className="text-right">
              <p className="text-xs text-slate-500 uppercase">Closing Balance</p>
              <p className={`text-xl font-bold ${closing >= 0 ? "text-emerald-600" : "text-rose-600"}`}>
                {formatINR(Math.abs(closing))} {closing >= 0 ? "Dr" : "Cr"}
              </p>
            </div>
          </div>

          <div className="overflow-x-auto -mx-5">
            <table className="table">
              <thead>
                <tr>
                  <th>Date</th>
                  <th>Particulars</th>
                  <th>Voucher</th>
                  <th className="text-right">Debit</th>
                  <th className="text-right">Credit</th>
                  <th className="text-right">Balance</th>
                </tr>
              </thead>
              <tbody>
                <tr className="bg-slate-50/60">
                  <td colSpan={3} className="font-medium">
                    Opening Balance
                  </td>
                  <td className="text-right">{openingDebit ? formatINR(openingDebit) : "—"}</td>
                  <td className="text-right">{openingCredit ? formatINR(openingCredit) : "—"}</td>
                  <td className="text-right font-medium">
                    {formatINR(Math.abs(running))} {running >= 0 ? "Dr" : "Cr"}
                  </td>
                </tr>
                {rows.map((r, i) => {
                  running += r.debit - r.credit;
                  return (
                    <tr key={i}>
                      <td>{formatDate(r.date)}</td>
                      <td>{r.particulars}</td>
                      <td>{r.voucher}</td>
                      <td className="text-right">{r.debit ? formatINR(r.debit) : "—"}</td>
                      <td className="text-right">{r.credit ? formatINR(r.credit) : "—"}</td>
                      <td className="text-right font-medium">
                        {formatINR(Math.abs(running))} {running >= 0 ? "Dr" : "Cr"}
                      </td>
                    </tr>
                  );
                })}
                <tr className="border-t-2 border-slate-200 font-bold">
                  <td colSpan={3}>Total</td>
                  <td className="text-right">{formatINR(totalDebit)}</td>
                  <td className="text-right">{formatINR(totalCredit)}</td>
                  <td className="text-right">
                    {formatINR(Math.abs(closing))} {closing >= 0 ? "Dr" : "Cr"}
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
