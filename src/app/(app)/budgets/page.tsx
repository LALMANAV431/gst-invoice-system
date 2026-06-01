"use client";
import { useState, useEffect } from "react";
import toast from "react-hot-toast";
import { Plus, PiggyBank } from "lucide-react";
import { formatINR } from "@/lib/utils";

const CATEGORIES = [
  "Sales",
  "Purchases",
  "Rent",
  "Salaries & Wages",
  "Electricity",
  "Marketing",
  "Transport",
  "Miscellaneous",
];

export default function BudgetsPage() {
  const [budgets, setBudgets] = useState<any[]>([]);
  const [form, setForm] = useState({ category: "Sales", period: currentPeriod(), amount: 0 });
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/budgets").then((r) => r.json()).then(setBudgets);
  }, []);

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!form.amount) return toast.error("Enter budget amount");
    setLoading(true);
    const res = await fetch("/api/budgets", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setLoading(false);
    if (res.ok) {
      const b = await res.json();
      setBudgets((bs) => {
        const exists = bs.findIndex(
          (x) => x.category === b.category && x.period === b.period
        );
        if (exists >= 0) {
          const copy = [...bs];
          copy[exists] = b;
          return copy;
        }
        return [b, ...bs];
      });
      toast.success("Budget saved");
    } else toast.error("Failed");
  }

  return (
    <div className="max-w-4xl mx-auto space-y-4">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <PiggyBank className="h-6 w-6 text-brand-600" /> Budgets
        </h1>
        <p className="text-sm text-slate-500">
          Set monthly budgets and compare against actuals
        </p>
      </div>

      <form onSubmit={save} className="card card-padding flex flex-wrap gap-3 items-end">
        <div>
          <label className="label">Category</label>
          <select
            className="input"
            value={form.category}
            onChange={(e) => setForm({ ...form, category: e.target.value })}
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>{c}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Period (YYYY-MM)</label>
          <input
            className="input"
            value={form.period}
            onChange={(e) => setForm({ ...form, period: e.target.value })}
            placeholder="2025-04"
          />
        </div>
        <div>
          <label className="label">Budget amount (₹)</label>
          <input
            type="number"
            className="input"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })}
          />
        </div>
        <button disabled={loading} className="btn-primary">
          <Plus className="h-4 w-4" /> Set Budget
        </button>
      </form>

      <div className="card card-padding">
        <h2 className="font-semibold mb-3">All budgets</h2>
        <div className="overflow-x-auto -mx-5">
          <table className="table">
            <thead>
              <tr>
                <th>Period</th>
                <th>Category</th>
                <th className="text-right">Budget</th>
              </tr>
            </thead>
            <tbody>
              {budgets.length === 0 ? (
                <tr>
                  <td colSpan={3} className="text-center py-8 text-slate-500">
                    No budgets set yet.
                  </td>
                </tr>
              ) : (
                budgets.map((b) => (
                  <tr key={b.id}>
                    <td className="font-medium">{b.period}</td>
                    <td>
                      <span className="badge-slate">{b.category}</span>
                    </td>
                    <td className="text-right font-semibold">{formatINR(b.amount)}</td>
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

function currentPeriod() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}
