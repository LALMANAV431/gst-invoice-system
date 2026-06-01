"use client";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { IndianRupee, Save } from "lucide-react";

type PlanRow = {
  id: string;
  name: string;
  tagline?: string | null;
  price: number;
  priceAnnual: number;
  invoiceLimit: number; // Infinity becomes a big number over JSON
  userLimit: number;
};

const inputCls =
  "w-full rounded-xl border border-slate-700 bg-slate-800 px-3 py-2 text-sm text-slate-100 focus:outline-none focus:border-amber-500";

export default function AdminPricingPage() {
  const [plans, setPlans] = useState<Record<string, PlanRow>>({});
  const [saving, setSaving] = useState("");

  useEffect(() => {
    fetch("/api/admin/plans")
      .then((r) => r.json())
      .then((data) => {
        // Normalize Infinity (sent as null/Infinity) → -1 for the unlimited UI
        const norm: Record<string, PlanRow> = {};
        for (const k of Object.keys(data)) {
          const p = data[k];
          norm[k] = {
            ...p,
            invoiceLimit: p.invoiceLimit === null || p.invoiceLimit > 100000 ? -1 : p.invoiceLimit,
          };
        }
        setPlans(norm);
      });
  }, []);

  function set(id: string, field: keyof PlanRow, value: any) {
    setPlans((p) => ({ ...p, [id]: { ...p[id], [field]: value } }));
  }

  async function save(id: string) {
    const p = plans[id];
    setSaving(id);
    const res = await fetch("/api/admin/plans", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        id,
        name: p.name,
        tagline: p.tagline,
        priceMonthly: p.price,
        priceAnnual: p.priceAnnual,
        invoiceLimit: p.invoiceLimit,
        userLimit: p.userLimit,
      }),
    });
    setSaving("");
    if (res.ok) toast.success(`${p.name} plan saved`);
    else toast.error("Failed");
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <IndianRupee className="h-6 w-6 text-amber-400" /> Pricing & Plans
        </h1>
        <p className="text-sm text-slate-400">Edit prices and limits — changes reflect on the billing page</p>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        {["FREE", "BASIC", "PREMIUM"].map((id) => {
          const p = plans[id];
          if (!p) return null;
          return (
            <div key={id} className="rounded-2xl border border-slate-800 bg-slate-900 p-5 space-y-3">
              <div className="text-xs uppercase tracking-wide text-amber-400 font-bold">{id}</div>
              <div>
                <label className="text-xs text-slate-400">Display name</label>
                <input className={inputCls} value={p.name} onChange={(e) => set(id, "name", e.target.value)} />
              </div>
              <div>
                <label className="text-xs text-slate-400">Tagline</label>
                <input className={inputCls} value={p.tagline ?? ""} onChange={(e) => set(id, "tagline", e.target.value)} />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-400">Monthly ₹</label>
                  <input type="number" className={inputCls} value={p.price} onChange={(e) => set(id, "price", parseFloat(e.target.value) || 0)} />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Annual ₹</label>
                  <input type="number" className={inputCls} value={p.priceAnnual} onChange={(e) => set(id, "priceAnnual", parseFloat(e.target.value) || 0)} />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="text-xs text-slate-400">Invoices/mo (-1=∞)</label>
                  <input type="number" className={inputCls} value={p.invoiceLimit} onChange={(e) => set(id, "invoiceLimit", parseInt(e.target.value))} />
                </div>
                <div>
                  <label className="text-xs text-slate-400">Users</label>
                  <input type="number" className={inputCls} value={p.userLimit} onChange={(e) => set(id, "userLimit", parseInt(e.target.value) || 1)} />
                </div>
              </div>
              <button
                onClick={() => save(id)}
                disabled={saving === id}
                className="w-full rounded-xl bg-amber-500 text-slate-900 font-semibold px-4 py-2.5 text-sm hover:bg-amber-400"
              >
                <Save className="h-4 w-4 inline" /> {saving === id ? "Saving..." : "Save"}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
