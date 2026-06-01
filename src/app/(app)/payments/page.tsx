import Link from "next/link";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { formatINR, formatDate } from "@/lib/utils";
import { Plus, ArrowDownLeft, ArrowUpRight } from "lucide-react";
import PaymentDeleteButton from "./PaymentDeleteButton";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";

export default async function PaymentsPage() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;
  const payments = await db.payment.findMany({
    where: { companyId: ctx.company.id },
    include: { party: true, invoice: true, purchase: true },
    orderBy: { date: "desc" },
  });

  const received = payments
    .filter((p) => p.type === "RECEIVED")
    .reduce((s, p) => s + p.amount, 0);
  const paid = payments.filter((p) => p.type === "PAID").reduce((s, p) => s + p.amount, 0);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Payments</h1>
          <p className="text-sm text-slate-500">Receipts and payments</p>
        </div>
        <Link href="/payments/new" className="btn-primary">
          <Plus className="h-4 w-4" /> Record Payment
        </Link>
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="card card-padding card-hover relative overflow-hidden">
          <div className="absolute -right-5 -top-5 h-20 w-20 rounded-full bg-emerald-500 opacity-10" />
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-500 uppercase font-semibold">Received</div>
              <div className="text-2xl font-bold text-emerald-600 mt-2">{formatINR(received)}</div>
            </div>
            <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-emerald-500 to-emerald-600 text-white flex items-center justify-center shadow-lg">
              <ArrowDownLeft className="h-5 w-5" />
            </div>
          </div>
        </div>
        <div className="card card-padding card-hover relative overflow-hidden">
          <div className="absolute -right-5 -top-5 h-20 w-20 rounded-full bg-rose-500 opacity-10" />
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-500 uppercase font-semibold">Paid</div>
              <div className="text-2xl font-bold text-rose-600 mt-2">{formatINR(paid)}</div>
            </div>
            <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-rose-500 to-rose-600 text-white flex items-center justify-center shadow-lg">
              <ArrowUpRight className="h-5 w-5" />
            </div>
          </div>
        </div>
      </div>

      <div className="card card-padding">
        <div className="overflow-x-auto -mx-5">
          <table className="table">
            <thead>
              <tr>
                <th>Receipt #</th>
                <th>Date</th>
                <th>Party</th>
                <th>Type</th>
                <th>Mode</th>
                <th>Reference</th>
                <th className="text-right">Amount</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {payments.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      title="No payments yet"
                      description="Record customer receipts and vendor payments to track your cash flow."
                      ctaHref="/payments/new"
                      ctaLabel="Record Payment"
                    />
                  </td>
                </tr>
              ) : (
                payments.map((p) => (
                  <tr key={p.id}>
                    <td className="font-medium">{p.number}</td>
                    <td>{formatDate(p.date)}</td>
                    <td>{p.party.name}</td>
                    <td>
                      {p.type === "RECEIVED" ? (
                        <span className="badge-green">Received</span>
                      ) : (
                        <span className="badge-red">Paid</span>
                      )}
                    </td>
                    <td>{p.mode}</td>
                    <td className="text-xs">
                      {p.invoice?.number || p.purchase?.number || p.reference || "—"}
                    </td>
                    <td className="text-right font-semibold">{formatINR(p.amount)}</td>
                    <td>
                      <PaymentDeleteButton id={p.id} />
                    </td>
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
