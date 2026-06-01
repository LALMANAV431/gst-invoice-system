"use client";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { Plus, Trash2, Ticket } from "lucide-react";

type Coupon = {
  id: string;
  code: string;
  description: string | null;
  type: string;
  value: number;
  appliesToPlan: string | null;
  maxRedemptions: number | null;
  timesRedeemed: number;
  active: boolean;
  expiresAt: string | null;
};

const inputCls =
  "w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500";

export default function AdminCouponsPage() {
  const [coupons, setCoupons] = useState<Coupon[]>([]);
  const [form, setForm] = useState({
    code: "",
    description: "",
    type: "PERCENT",
    value: 10,
    appliesToPlan: "",
    maxRedemptions: "",
    expiresAt: "",
  });
  const [saving, setSaving] = useState(false);

  function load() {
    fetch("/api/admin/coupons").then((r) => r.json()).then(setCoupons);
  }
  useEffect(load, []);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    const res = await fetch("/api/admin/coupons", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setSaving(false);
    if (res.ok) {
      const c = await res.json();
      setCoupons((cs) => [c, ...cs]);
      setForm({ ...form, code: "", description: "", value: 10 });
      toast.success("Coupon created");
    } else {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error || "Failed");
    }
  }

  async function toggle(c: Coupon) {
    const res = await fetch(`/api/admin/coupons/${c.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ active: !c.active }),
    });
    if (res.ok) {
      setCoupons((cs) => cs.map((x) => (x.id === c.id ? { ...x, active: !c.active } : x)));
    }
  }

  async function remove(id: string) {
    if (!confirm("Delete this coupon?")) return;
    const res = await fetch(`/api/admin/coupons/${id}`, { method: "DELETE" });
    if (res.ok) {
      setCoupons((cs) => cs.filter((c) => c.id !== id));
      toast.success("Deleted");
    }
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Ticket className="h-6 w-6 text-amber-400" /> Coupons
        </h1>
        <p className="text-sm text-slate-400">Create discount codes for subscriptions</p>
      </div>

      <form onSubmit={create} className="rounded-2xl border border-slate-800 bg-slate-900 p-5 grid md:grid-cols-6 gap-3 items-end">
        <div className="md:col-span-1">
          <label className="text-xs text-slate-400">Code</label>
          <input className={inputCls} value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="SAVE20" required />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs text-slate-400">Description</label>
          <input className={inputCls} value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
        </div>
        <div>
          <label className="text-xs text-slate-400">Type</label>
          <select className={inputCls} value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
            <option value="PERCENT">Percent %</option>
            <option value="FLAT">Flat ₹</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-400">Value</label>
          <input type="number" className={inputCls} value={form.value} onChange={(e) => setForm({ ...form, value: parseFloat(e.target.value) || 0 })} />
        </div>
        <button disabled={saving} className="rounded-xl bg-amber-500 text-slate-900 font-semibold px-4 py-2.5 text-sm hover:bg-amber-400">
          <Plus className="h-4 w-4 inline" /> Add
        </button>
        <div className="md:col-span-3">
          <label className="text-xs text-slate-400">Limit to plan (optional)</label>
          <select className={inputCls} value={form.appliesToPlan} onChange={(e) => setForm({ ...form, appliesToPlan: e.target.value })}>
            <option value="">Any paid plan</option>
            <option value="BASIC">BASIC only</option>
            <option value="PREMIUM">PREMIUM only</option>
          </select>
        </div>
        <div>
          <label className="text-xs text-slate-400">Max uses</label>
          <input type="number" className={inputCls} value={form.maxRedemptions} onChange={(e) => setForm({ ...form, maxRedemptions: e.target.value })} placeholder="∞" />
        </div>
        <div className="md:col-span-2">
          <label className="text-xs text-slate-400">Expires</label>
          <input type="date" className={inputCls} value={form.expiresAt} onChange={(e) => setForm({ ...form, expiresAt: e.target.value })} />
        </div>
      </form>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-800">
              <th className="px-4 py-3">Code</th>
              <th className="px-4 py-3">Discount</th>
              <th className="px-4 py-3">Scope</th>
              <th className="px-4 py-3">Used</th>
              <th className="px-4 py-3">Status</th>
              <th className="px-4 py-3"></th>
            </tr>
          </thead>
          <tbody>
            {coupons.length === 0 ? (
              <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">No coupons yet.</td></tr>
            ) : (
              coupons.map((c) => (
                <tr key={c.id} className="border-b border-slate-800/60">
                  <td className="px-4 py-3 font-mono font-semibold">{c.code}</td>
                  <td className="px-4 py-3">{c.type === "PERCENT" ? `${c.value}%` : `₹${c.value}`}</td>
                  <td className="px-4 py-3 text-slate-400">{c.appliesToPlan || "Any"}</td>
                  <td className="px-4 py-3">{c.timesRedeemed}{c.maxRedemptions ? `/${c.maxRedemptions}` : ""}</td>
                  <td className="px-4 py-3">
                    <button onClick={() => toggle(c)} className={`text-xs font-semibold ${c.active ? "text-emerald-400" : "text-slate-500"}`}>
                      {c.active ? "Active" : "Inactive"}
                    </button>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <button onClick={() => remove(c.id)} className="text-rose-400 hover:text-rose-300">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
