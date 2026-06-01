"use client";
import { useEffect, useState } from "react";
import toast from "react-hot-toast";

type Company = {
  id: string;
  name: string;
  gstin: string | null;
  plan: string;
  isSuspended: boolean;
  createdAt: string;
  owner: { name: string; email: string };
  _count: { invoices: number; parties: number; items: number };
};

export default function AdminCompaniesPage() {
  const [companies, setCompanies] = useState<Company[]>([]);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState("");

  function load() {
    fetch("/api/admin/companies")
      .then((r) => r.json())
      .then(setCompanies)
      .finally(() => setLoading(false));
  }
  useEffect(load, []);

  async function changePlan(id: string, plan: string) {
    const res = await fetch(`/api/admin/companies/${id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ plan }),
    });
    if (res.ok) {
      setCompanies((cs) => cs.map((c) => (c.id === id ? { ...c, plan } : c)));
      toast.success(`Plan changed to ${plan}`);
    } else toast.error("Failed");
  }

  async function toggleSuspend(c: Company) {
    const res = await fetch(`/api/admin/companies/${c.id}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ isSuspended: !c.isSuspended }),
    });
    if (res.ok) {
      setCompanies((cs) => cs.map((x) => (x.id === c.id ? { ...x, isSuspended: !c.isSuspended } : x)));
      toast.success(c.isSuspended ? "Reactivated" : "Suspended");
    } else toast.error("Failed");
  }

  async function impersonate(c: Company) {
    if (!confirm(`View the app as "${c.name}"? You can exit anytime from the banner.`)) return;
    const res = await fetch("/api/admin/impersonate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ companyId: c.id }),
    });
    if (res.ok) {
      window.location.href = "/dashboard";
    } else toast.error("Failed to impersonate");
  }

  const filtered = companies.filter(
    (c) =>
      c.name.toLowerCase().includes(q.toLowerCase()) ||
      c.owner.email.toLowerCase().includes(q.toLowerCase())
  );

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">Companies</h1>
        <p className="text-sm text-slate-400">Manage every business on the platform</p>
      </div>

      <input
        className="w-full max-w-sm rounded-xl border border-slate-700 bg-slate-900 px-3.5 py-2.5 text-sm text-slate-100 placeholder:text-slate-500 focus:outline-none focus:border-amber-500"
        placeholder="Search by company or owner email..."
        value={q}
        onChange={(e) => setQ(e.target.value)}
      />

      <div className="rounded-2xl border border-slate-800 bg-slate-900 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-slate-400 border-b border-slate-800">
                <th className="px-4 py-3">Company</th>
                <th className="px-4 py-3">Owner</th>
                <th className="px-4 py-3">Invoices</th>
                <th className="px-4 py-3">Plan</th>
                <th className="px-4 py-3">Status</th>
                <th className="px-4 py-3"></th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">Loading...</td></tr>
              ) : filtered.length === 0 ? (
                <tr><td colSpan={6} className="px-4 py-10 text-center text-slate-500">No companies.</td></tr>
              ) : (
                filtered.map((c) => (
                  <tr key={c.id} className="border-b border-slate-800/60">
                    <td className="px-4 py-3">
                      <div className="font-medium">{c.name}</div>
                      <div className="text-xs text-slate-500">{c.gstin || "No GSTIN"}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div>{c.owner.name}</div>
                      <div className="text-xs text-slate-500">{c.owner.email}</div>
                    </td>
                    <td className="px-4 py-3">{c._count.invoices}</td>
                    <td className="px-4 py-3">
                      <select
                        value={c.plan}
                        onChange={(e) => changePlan(c.id, e.target.value)}
                        className="rounded-lg border border-slate-700 bg-slate-800 px-2 py-1 text-xs"
                      >
                        <option value="FREE">FREE</option>
                        <option value="BASIC">BASIC</option>
                        <option value="PREMIUM">PREMIUM</option>
                      </select>
                    </td>
                    <td className="px-4 py-3">
                      {c.isSuspended ? (
                        <span className="text-rose-400 text-xs font-semibold">Suspended</span>
                      ) : (
                        <span className="text-emerald-400 text-xs font-semibold">Active</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-right">
                      <div className="inline-flex items-center gap-2">
                        <button
                          onClick={() => impersonate(c)}
                          className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-blue-500/10 text-blue-400 hover:bg-blue-500/20"
                        >
                          View as
                        </button>
                        <button
                          onClick={() => toggleSuspend(c)}
                          className={`text-xs font-semibold px-3 py-1.5 rounded-lg ${
                            c.isSuspended
                              ? "bg-emerald-500/10 text-emerald-400 hover:bg-emerald-500/20"
                              : "bg-rose-500/10 text-rose-400 hover:bg-rose-500/20"
                          }`}
                        >
                          {c.isSuspended ? "Reactivate" : "Suspend"}
                        </button>
                      </div>
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
