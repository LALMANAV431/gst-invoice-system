import Link from "next/link";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { formatPaise, formatDate } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

type Entry = {
  id: string;
  date: Date;
  type: string;
  number: string;
  particulars: string;
  amount: number;
  href?: string;
  badge: string;
};

export default async function DayBookPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;
  const companyId = ctx.company.id;

  const from = searchParams.from ? new Date(searchParams.from) : startOfMonth();
  const to = searchParams.to ? new Date(searchParams.to) : new Date();
  to.setHours(23, 59, 59, 999);
  const dateFilter = { gte: from, lte: to };

  const [invoices, purchases, payments, expenses, notes] = await Promise.all([
    db.invoice.findMany({ where: { companyId, date: dateFilter }, include: { party: true } }),
    db.purchase.findMany({ where: { companyId, date: dateFilter }, include: { party: true } }),
    db.payment.findMany({ where: { companyId, date: dateFilter }, include: { party: true } }),
    db.expense.findMany({ where: { companyId, date: dateFilter }, include: { party: true } }),
    db.creditNote.findMany({ where: { companyId, date: dateFilter }, include: { party: true } }),
  ]);

  const entries: Entry[] = [
    ...invoices.map((i) => ({
      id: i.id,
      date: i.date,
      type: "Sales",
      number: i.number,
      particulars: i.party.name,
      amount: i.grandTotalPaise,
      href: `/invoices/${i.id}`,
      badge: "badge-green",
    })),
    ...purchases.map((p) => ({
      id: p.id,
      date: p.date,
      type: "Purchase",
      number: p.number,
      particulars: p.party.name,
      amount: p.grandTotalPaise,
      href: `/purchases/${p.id}`,
      badge: "badge-amber",
    })),
    ...payments.map((p) => ({
      id: p.id,
      date: p.date,
      type: p.type === "RECEIVED" ? "Receipt" : "Payment",
      number: p.number,
      particulars: `${p.party.name} · ${p.mode}`,
      amount: p.amountPaise,
      badge: "badge-slate",
    })),
    ...expenses.map((e) => ({
      id: e.id,
      date: e.date,
      type: "Expense",
      number: e.number,
      particulars: e.category,
      amount: e.totalPaise,
      href: `/expenses`,
      badge: "badge-red",
    })),
    ...notes.map((n) => ({
      id: n.id,
      date: n.date,
      type: n.kind === "CREDIT" ? "Credit Note" : "Debit Note",
      number: n.number,
      particulars: n.party.name,
      amount: n.grandTotalPaise,
      href: `/credit-notes/${n.id}`,
      badge: "badge-slate",
    })),
  ].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <Link href="/reports" className="btn-ghost text-sm -ml-2 mb-1">
            <ArrowLeft className="h-4 w-4" /> Reports
          </Link>
          <h1 className="text-2xl font-bold">Day Book</h1>
          <p className="text-sm text-slate-500">All vouchers in the selected period</p>
        </div>
      </div>

      <form className="card card-padding flex flex-wrap gap-3 items-end">
        <div>
          <label className="label">From</label>
          <input type="date" name="from" defaultValue={iso(from)} className="input" />
        </div>
        <div>
          <label className="label">To</label>
          <input type="date" name="to" defaultValue={iso(to)} className="input" />
        </div>
        <button className="btn-primary">Apply</button>
      </form>

      <div className="card card-padding">
        <div className="overflow-x-auto -mx-5">
          <table className="table">
            <thead>
              <tr>
                <th>Date</th>
                <th>Voucher Type</th>
                <th>Number</th>
                <th>Particulars</th>
                <th className="text-right">Amount</th>
              </tr>
            </thead>
            <tbody>
              {entries.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center py-10 text-slate-500">
                    No transactions in this period.
                  </td>
                </tr>
              ) : (
                entries.map((e) => (
                  <tr key={`${e.type}-${e.id}`}>
                    <td>{formatDate(e.date)}</td>
                    <td>
                      <span className={e.badge}>{e.type}</span>
                    </td>
                    <td>
                      {e.href ? (
                        <Link href={e.href} className="text-brand-600 hover:underline font-medium">
                          {e.number}
                        </Link>
                      ) : (
                        e.number
                      )}
                    </td>
                    <td>{e.particulars}</td>
                    <td className="text-right font-semibold">{formatPaise(e.amount)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function startOfMonth() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}
function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}
