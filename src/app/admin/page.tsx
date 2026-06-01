import { db } from "@/lib/db";
import { formatINR } from "@/lib/utils";
import { getEffectivePlans, planActive, type PlanId } from "@/lib/plan";
import { Building2, Users, FileText, IndianRupee, Ticket, TrendingUp } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function AdminOverviewPage() {
  const [companies, userCount, invoiceCount, activeCoupons, plans] = await Promise.all([
    db.company.findMany({ select: { plan: true, planExpiry: true } }),
    db.user.count(),
    db.invoice.count(),
    db.coupon.count({ where: { active: true } }),
    getEffectivePlans(),
  ]);

  // Count active paid subscriptions and estimate MRR from effective plan prices
  const counts: Record<PlanId, number> = { FREE: 0, BASIC: 0, PREMIUM: 0 };
  let mrr = 0;
  for (const c of companies) {
    const active = planActive(c.plan, c.planExpiry) as PlanId;
    counts[active] = (counts[active] || 0) + 1;
    mrr += plans[active]?.price || 0;
  }

  const cards = [
    { label: "Total Companies", value: String(companies.length), icon: Building2, color: "from-blue-500 to-blue-600" },
    { label: "Total Users", value: String(userCount), icon: Users, color: "from-violet-500 to-violet-600" },
    { label: "Total Invoices", value: String(invoiceCount), icon: FileText, color: "from-emerald-500 to-emerald-600" },
    { label: "Est. MRR", value: formatINR(mrr), icon: IndianRupee, color: "from-amber-500 to-amber-600" },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold">Platform Overview</h1>
        <p className="text-sm text-slate-400">Everything happening across GST Books</p>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        {cards.map((c) => (
          <div key={c.label} className="rounded-2xl border border-slate-800 bg-slate-900 p-5 relative overflow-hidden">
            <div className={`absolute -right-6 -top-6 h-20 w-20 rounded-full bg-gradient-to-br ${c.color} opacity-20`} />
            <div className="flex items-start justify-between">
              <div>
                <div className="text-xs uppercase tracking-wide text-slate-400 font-semibold">{c.label}</div>
                <div className="mt-2 text-2xl font-bold">{c.value}</div>
              </div>
              <div className={`h-11 w-11 rounded-xl bg-gradient-to-br ${c.color} text-white flex items-center justify-center`}>
                <c.icon className="h-5 w-5" />
              </div>
            </div>
          </div>
        ))}
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="font-semibold flex items-center gap-2">
            <TrendingUp className="h-4 w-4 text-amber-400" /> Subscriptions by plan
          </h2>
          <div className="mt-4 space-y-3">
            {(["FREE", "BASIC", "PREMIUM"] as PlanId[]).map((p) => {
              const total = companies.length || 1;
              const pct = Math.round((counts[p] / total) * 100);
              return (
                <div key={p}>
                  <div className="flex justify-between text-sm mb-1">
                    <span>{plans[p]?.name || p}</span>
                    <span className="text-slate-400">
                      {counts[p]} ({pct}%)
                    </span>
                  </div>
                  <div className="h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className={`h-full rounded-full ${
                        p === "PREMIUM" ? "bg-amber-500" : p === "BASIC" ? "bg-blue-500" : "bg-slate-500"
                      }`}
                      style={{ width: `${pct}%` }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        <div className="rounded-2xl border border-slate-800 bg-slate-900 p-5">
          <h2 className="font-semibold flex items-center gap-2">
            <Ticket className="h-4 w-4 text-amber-400" /> Quick facts
          </h2>
          <ul className="mt-4 space-y-2 text-sm">
            <li className="flex justify-between">
              <span className="text-slate-400">Active coupons</span>
              <span className="font-semibold">{activeCoupons}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-slate-400">Paid companies</span>
              <span className="font-semibold">{counts.BASIC + counts.PREMIUM}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-slate-400">Est. ARR</span>
              <span className="font-semibold">{formatINR(mrr * 12)}</span>
            </li>
          </ul>
        </div>
      </div>
    </div>
  );
}
