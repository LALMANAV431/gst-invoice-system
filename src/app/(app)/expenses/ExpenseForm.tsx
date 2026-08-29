"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { motion, AnimatePresence } from "framer-motion";
import { Plus, X } from "lucide-react";
import { inputDate, formatPaise } from "@/lib/utils";

const CATEGORIES = [
  "Rent",
  "Salaries & Wages",
  "Electricity",
  "Telephone & Internet",
  "Transport & Freight",
  "Office Supplies",
  "Repairs & Maintenance",
  "Marketing & Advertising",
  "Professional Fees",
  "Bank Charges",
  "Travel",
  "Miscellaneous",
  "General",
];

export default function ExpenseForm({ vendors }: { vendors: { id: string; name: string }[] }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState({
    category: "Rent",
    paymentMode: "CASH",
    amount: 0,
    gstRate: 0,
    date: inputDate(new Date()),
    reference: "",
    notes: "",
    partyId: "",
  });
  const [loading, setLoading] = useState(false);

  const tax = +(((form.amount || 0) * (form.gstRate || 0)) / 100).toFixed(2);
  const total = +((form.amount || 0) + tax).toFixed(2);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.amount || form.amount <= 0) return toast.error("Enter amount");
    setLoading(true);
    const res = await fetch("/api/expenses", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setLoading(false);
    if (res.ok) {
      toast.success("Expense recorded");
      setOpen(false);
      setForm({ ...form, amount: 0, reference: "", notes: "" });
      router.refresh();
    } else {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error || "Failed");
    }
  }

  return (
    <>
      <button className="btn-primary" onClick={() => setOpen(true)}>
        <Plus className="h-4 w-4" /> Add Expense
      </button>

      <AnimatePresence>
        {open && (
          <>
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="fixed inset-0 bg-slate-900/50 backdrop-blur-sm z-40"
              onClick={() => setOpen(false)}
            />
            <motion.div
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
              className="fixed left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 z-50 w-full max-w-lg"
            >
              <form onSubmit={submit} className="card card-padding shadow-2xl">
                <div className="flex items-center justify-between mb-4">
                  <h2 className="text-lg font-bold">Record Expense</h2>
                  <button type="button" className="btn-ghost p-2" onClick={() => setOpen(false)}>
                    <X className="h-5 w-5" />
                  </button>
                </div>

                <div className="grid md:grid-cols-2 gap-4">
                  <div>
                    <label className="label">Category</label>
                    <select
                      className="input"
                      value={form.category}
                      onChange={(e) => setForm({ ...form, category: e.target.value })}
                    >
                      {CATEGORIES.map((c) => (
                        <option key={c} value={c}>
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Date</label>
                    <input
                      type="date"
                      className="input"
                      value={form.date}
                      onChange={(e) => setForm({ ...form, date: e.target.value })}
                    />
                  </div>
                  <div>
                    <label className="label">Amount (₹)</label>
                    <input
                      type="number"
                      step="0.01"
                      className="input"
                      value={form.amount}
                      onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                  <div>
                    <label className="label">GST rate (%)</label>
                    <select
                      className="input"
                      value={form.gstRate}
                      onChange={(e) => setForm({ ...form, gstRate: parseFloat(e.target.value) })}
                    >
                      {[0, 5, 12, 18, 28].map((g) => (
                        <option key={g} value={g}>
                          {g}%
                        </option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="label">Payment mode</label>
                    <select
                      className="input"
                      value={form.paymentMode}
                      onChange={(e) => setForm({ ...form, paymentMode: e.target.value })}
                    >
                      <option value="CASH">Cash</option>
                      <option value="BANK">Bank</option>
                      <option value="UPI">UPI</option>
                      <option value="CARD">Card</option>
                      <option value="CHEQUE">Cheque</option>
                    </select>
                  </div>
                  <div>
                    <label className="label">Paid to (optional)</label>
                    <select
                      className="input"
                      value={form.partyId}
                      onChange={(e) => setForm({ ...form, partyId: e.target.value })}
                    >
                      <option value="">— none —</option>
                      {vendors.map((v) => (
                        <option key={v.id} value={v.id}>
                          {v.name}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="md:col-span-2">
                    <label className="label">Reference / Notes</label>
                    <input
                      className="input"
                      value={form.notes}
                      onChange={(e) => setForm({ ...form, notes: e.target.value })}
                      placeholder="Bill no., description..."
                    />
                  </div>
                </div>

                <div className="mt-4 flex items-center justify-between rounded-xl bg-slate-50 px-4 py-3">
                  <span className="text-sm text-slate-500">
                    Tax {formatPaise(tax)} · Total
                  </span>
                  <span className="text-lg font-bold">{formatPaise(total)}</span>
                </div>

                <div className="flex gap-2 mt-4">
                  <button
                    type="button"
                    className="btn-secondary flex-1"
                    onClick={() => setOpen(false)}
                  >
                    Cancel
                  </button>
                  <button disabled={loading} className="btn-primary flex-1">
                    {loading ? "Saving..." : "Save Expense"}
                  </button>
                </div>
              </form>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </>
  );
}
