"use client";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";
import { ToggleLeft, ToggleRight, Flag } from "lucide-react";

const FLAGS: { key: string; label: string; desc: string }[] = [
  { key: "flag_pos", label: "POS Billing", desc: "Barcode counter billing screen" },
  { key: "flag_quotations", label: "Quotations", desc: "Estimates / quotations module" },
  { key: "flag_credit_notes", label: "Credit/Debit Notes", desc: "Sales & purchase returns" },
  { key: "flag_expenses", label: "Expenses", desc: "Expense tracking" },
  { key: "flag_godowns", label: "Godowns", desc: "Warehouses & stock transfer" },
  { key: "flag_bank", label: "Bank Reconciliation", desc: "Statement import & matching" },
  { key: "flag_budgets", label: "Budgets", desc: "Per-category budgets" },
];

export default function AdminFlagsPage() {
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/admin/site-settings")
      .then((r) => r.json())
      .then((s) => {
        const f: Record<string, boolean> = {};
        for (const fl of FLAGS) f[fl.key] = s[fl.key] !== "false";
        setFlags(f);
      })
      .finally(() => setLoading(false));
  }, []);

  async function toggle(key: string) {
    const next = !flags[key];
    setFlags((f) => ({ ...f, [key]: next }));
    const res = await fetch("/api/admin/site-settings", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ [key]: next ? "true" : "false" }),
    });
    if (res.ok) toast.success(`${key} ${next ? "enabled" : "disabled"}`);
    else toast.error("Failed");
  }

  return (
    <div className="space-y-5 max-w-2xl">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Flag className="h-6 w-6 text-amber-400" /> Feature Flags
        </h1>
        <p className="text-sm text-slate-400">Turn modules on/off for all users — no redeploy needed</p>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 divide-y divide-slate-800">
        {loading ? (
          <div className="p-6 text-center text-slate-500">Loading...</div>
        ) : (
          FLAGS.map((f) => (
            <div key={f.key} className="flex items-center justify-between p-4">
              <div>
                <div className="font-medium">{f.label}</div>
                <div className="text-xs text-slate-400">{f.desc}</div>
              </div>
              <button onClick={() => toggle(f.key)} className="shrink-0">
                {flags[f.key] ? (
                  <ToggleRight className="h-8 w-8 text-emerald-400" />
                ) : (
                  <ToggleLeft className="h-8 w-8 text-slate-600" />
                )}
              </button>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
