import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { formatPaise, formatDate } from "@/lib/utils";
import { Wallet } from "lucide-react";
import EmptyState from "@/components/EmptyState";
import ExpenseForm from "./ExpenseForm";
import ExpenseDeleteButton from "./ExpenseDeleteButton";

export const dynamic = "force-dynamic";

export default async function ExpensesPage() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const [expenses, vendors, monthAgg, totalAgg] = await Promise.all([
    db.expense.findMany({
      where: { companyId: ctx.company.id },
      include: { party: true },
      orderBy: { date: "desc" },
    }),
    db.party.findMany({
      where: { companyId: ctx.company.id, type: { in: ["VENDOR", "BOTH"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    db.expense.aggregate({
      where: { companyId: ctx.company.id, date: { gte: startOfMonth } },
      _sum: { totalPaise: true },
    }),
    db.expense.aggregate({ where: { companyId: ctx.company.id }, _sum: { totalPaise: true } }),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Expenses</h1>
          <p className="text-sm text-slate-500">Track direct & indirect business expenses</p>
        </div>
        <ExpenseForm vendors={vendors} />
      </div>

      <div className="grid sm:grid-cols-2 gap-4">
        <div className="card card-padding card-hover relative overflow-hidden">
          <div className="absolute -right-5 -top-5 h-20 w-20 rounded-full bg-rose-500 opacity-10" />
          <div className="flex items-center justify-between">
            <div>
              <div className="text-xs text-slate-500 uppercase font-semibold">This Month</div>
              <div className="text-2xl font-bold text-rose-600 mt-2">
                {formatPaise(monthAgg._sum.totalPaise ?? 0)}
              </div>
            </div>
            <div className="h-11 w-11 rounded-xl bg-gradient-to-br from-rose-500 to-rose-600 text-white flex items-center justify-center shadow-lg">
              <Wallet className="h-5 w-5" />
            </div>
          </div>
        </div>
        <div className="card card-padding card-hover">
          <div className="text-xs text-slate-500 uppercase font-semibold">Total Expenses</div>
          <div className="text-2xl font-bold mt-2">{formatPaise(totalAgg._sum.totalPaise ?? 0)}</div>
        </div>
      </div>

      <div className="card card-padding">
        <div className="overflow-x-auto -mx-5">
          <table className="table">
            <thead>
              <tr>
                <th>Expense #</th>
                <th>Date</th>
                <th>Category</th>
                <th>Paid To</th>
                <th>Mode</th>
                <th className="text-right">Amount</th>
                <th className="text-right">GST</th>
                <th className="text-right">Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {expenses.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <EmptyState
                      title="No expenses yet"
                      description="Record rent, salaries, utilities and other business expenses here."
                    />
                  </td>
                </tr>
              ) : (
                expenses.map((e) => (
                  <tr key={e.id}>
                    <td className="font-medium">{e.number}</td>
                    <td>{formatDate(e.date)}</td>
                    <td>
                      <span className="badge-slate">{e.category}</span>
                    </td>
                    <td>{e.party?.name || "—"}</td>
                    <td>{e.paymentMode}</td>
                    <td className="text-right">{formatPaise(e.amountPaise)}</td>
                    <td className="text-right">{formatPaise(e.taxPaise)}</td>
                    <td className="text-right font-semibold">{formatPaise(e.totalPaise)}</td>
                    <td>
                      <ExpenseDeleteButton id={e.id} />
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
