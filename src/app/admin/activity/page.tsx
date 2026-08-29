import { db } from "@/lib/db";
import { formatPaise } from "@/lib/money";
import { Activity, FileText, Building2, IndianRupee, LifeBuoy } from "lucide-react";

export const dynamic = "force-dynamic";

type Event = { type: string; label: string; sub: string; at: Date; icon: any; color: string };

export default async function AdminActivityPage() {
  const [invoices, companies, payments, tickets] = await Promise.all([
    db.invoice.findMany({
      orderBy: { createdAt: "desc" },
      take: 15,
      include: { company: { select: { name: true } } },
    }),
    db.company.findMany({ orderBy: { createdAt: "desc" }, take: 15 }),
    db.payment.findMany({
      orderBy: { createdAt: "desc" },
      take: 15,
      include: { company: { select: { name: true } } },
    }),
    db.supportTicket.findMany({ orderBy: { createdAt: "desc" }, take: 15 }),
  ]);

  const events: Event[] = [
    ...invoices.map((i) => ({
      type: "invoice",
      label: `Invoice ${i.number} · ${formatPaise(i.grandTotalPaise)}`,
      sub: i.company.name,
      at: i.createdAt,
      icon: FileText,
      color: "text-emerald-400 bg-emerald-500/10",
    })),
    ...companies.map((c) => ({
      type: "company",
      label: `New company: ${c.name}`,
      sub: c.gstin || "No GSTIN",
      at: c.createdAt,
      icon: Building2,
      color: "text-blue-400 bg-blue-500/10",
    })),
    ...payments.map((p) => ({
      type: "payment",
      label: `${p.type === "RECEIVED" ? "Receipt" : "Payment"} ${formatPaise(p.amountPaise)}`,
      sub: p.company.name,
      at: p.createdAt,
      icon: IndianRupee,
      color: "text-amber-400 bg-amber-500/10",
    })),
    ...tickets.map((t) => ({
      type: "ticket",
      label: `Support: ${t.subject}`,
      sub: t.userEmail || "",
      at: t.createdAt,
      icon: LifeBuoy,
      color: "text-violet-400 bg-violet-500/10",
    })),
  ]
    .sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime())
    .slice(0, 40);

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-bold flex items-center gap-2">
          <Activity className="h-6 w-6 text-amber-400" /> Platform Activity
        </h1>
        <p className="text-sm text-slate-400">Latest events across all companies</p>
      </div>

      <div className="rounded-2xl border border-slate-800 bg-slate-900 p-2">
        {events.length === 0 ? (
          <div className="p-10 text-center text-slate-500">No activity yet.</div>
        ) : (
          <ul className="divide-y divide-slate-800">
            {events.map((e, i) => (
              <li key={i} className="flex items-center gap-3 p-3">
                <div className={`h-9 w-9 rounded-lg flex items-center justify-center ${e.color}`}>
                  <e.icon className="h-4 w-4" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium truncate">{e.label}</div>
                  <div className="text-xs text-slate-400 truncate">{e.sub}</div>
                </div>
                <div className="text-xs text-slate-500 whitespace-nowrap">
                  {new Date(e.at).toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" })}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
