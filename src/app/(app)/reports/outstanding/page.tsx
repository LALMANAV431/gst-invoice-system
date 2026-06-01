import Link from "next/link";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { formatINR, formatDate } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

function ageBucket(days: number) {
  if (days <= 30) return "0–30";
  if (days <= 60) return "31–60";
  if (days <= 90) return "61–90";
  return "90+";
}

export default async function OutstandingPage() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;
  const companyId = ctx.company.id;
  const now = Date.now();

  const [invoices, purchases] = await Promise.all([
    db.invoice.findMany({
      where: { companyId, status: { not: "PAID" } },
      include: { party: true },
      orderBy: { date: "asc" },
    }),
    db.purchase.findMany({
      where: { companyId, status: { not: "PAID" } },
      include: { party: true },
      orderBy: { date: "asc" },
    }),
  ]);

  const receivables = invoices.map((i) => {
    const due = i.grandTotal - i.amountPaid;
    const days = Math.floor((now - new Date(i.date).getTime()) / 86400000);
    return { id: i.id, number: i.number, party: i.party.name, date: i.date, due, days, href: `/invoices/${i.id}` };
  });
  const payables = purchases.map((p) => {
    const due = p.grandTotal - p.amountPaid;
    const days = Math.floor((now - new Date(p.date).getTime()) / 86400000);
    return { id: p.id, number: p.number, party: p.party.name, date: p.date, due, days, href: `/purchases/${p.id}` };
  });

  const totalRecv = receivables.reduce((s, r) => s + r.due, 0);
  const totalPay = payables.reduce((s, r) => s + r.due, 0);

  const buckets = ["0–30", "31–60", "61–90", "90+"];
  const recvByBucket = buckets.map((b) => ({
    bucket: b,
    amount: receivables.filter((r) => ageBucket(r.days) === b).reduce((s, r) => s + r.due, 0),
  }));

  return (
    <div className="space-y-4">
      <div>
        <Link href="/reports" className="btn-ghost text-sm -ml-2 mb-1">
          <ArrowLeft className="h-4 w-4" /> Reports
        </Link>
        <h1 className="text-2xl font-bold">Outstanding & Aging</h1>
        <p className="text-sm text-slate-500">Receivables and payables by age</p>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="card card-padding card-hover">
          <div className="text-xs text-slate-500 uppercase font-semibold">Total Receivable</div>
          <div className="text-2xl font-bold text-emerald-600 mt-2">{formatINR(totalRecv)}</div>
        </div>
        <div className="card card-padding card-hover">
          <div className="text-xs text-slate-500 uppercase font-semibold">Total Payable</div>
          <div className="text-2xl font-bold text-rose-600 mt-2">{formatINR(totalPay)}</div>
        </div>
      </div>

      <div className="card card-padding">
        <h2 className="font-semibold mb-3">Receivables aging</h2>
        <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
          {recvByBucket.map((b) => (
            <div key={b.bucket} className="rounded-xl border border-slate-100 p-3">
              <div className="text-xs text-slate-500">{b.bucket} days</div>
              <div className="font-bold mt-1">{formatINR(b.amount)}</div>
            </div>
          ))}
        </div>
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card card-padding">
          <h2 className="font-semibold mb-3">Receivables ({receivables.length})</h2>
          <div className="overflow-x-auto -mx-5">
            <table className="table">
              <thead>
                <tr>
                  <th>Invoice</th>
                  <th>Customer</th>
                  <th className="text-right">Days</th>
                  <th className="text-right">Due</th>
                </tr>
              </thead>
              <tbody>
                {receivables.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center py-6 text-slate-500">
                      Nothing outstanding 🎉
                    </td>
                  </tr>
                ) : (
                  receivables.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link href={r.href} className="text-brand-600 hover:underline font-medium">
                          {r.number}
                        </Link>
                        <div className="text-xs text-slate-400">{formatDate(r.date)}</div>
                      </td>
                      <td>{r.party}</td>
                      <td className="text-right">
                        <span className={r.days > 60 ? "text-rose-600 font-medium" : ""}>
                          {r.days}
                        </span>
                      </td>
                      <td className="text-right font-semibold">{formatINR(r.due)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>

        <div className="card card-padding">
          <h2 className="font-semibold mb-3">Payables ({payables.length})</h2>
          <div className="overflow-x-auto -mx-5">
            <table className="table">
              <thead>
                <tr>
                  <th>Bill</th>
                  <th>Vendor</th>
                  <th className="text-right">Days</th>
                  <th className="text-right">Due</th>
                </tr>
              </thead>
              <tbody>
                {payables.length === 0 ? (
                  <tr>
                    <td colSpan={4} className="text-center py-6 text-slate-500">
                      Nothing payable 🎉
                    </td>
                  </tr>
                ) : (
                  payables.map((r) => (
                    <tr key={r.id}>
                      <td>
                        <Link href={r.href} className="text-brand-600 hover:underline font-medium">
                          {r.number}
                        </Link>
                        <div className="text-xs text-slate-400">{formatDate(r.date)}</div>
                      </td>
                      <td>{r.party}</td>
                      <td className="text-right">
                        <span className={r.days > 60 ? "text-rose-600 font-medium" : ""}>
                          {r.days}
                        </span>
                      </td>
                      <td className="text-right font-semibold">{formatINR(r.due)}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      </div>
    </div>
  );
}
