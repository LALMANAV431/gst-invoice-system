import Link from "next/link";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { formatPaise, formatDate, formatNumber } from "@/lib/utils";
import { ArrowUpRight, AlertTriangle, Plus } from "lucide-react";
import DashboardKpis, { type Kpi } from "@/components/DashboardKpis";
import { RevenueAreaChart, CategoryDonut } from "@/components/DashboardCharts";
import { FadeIn } from "@/components/motion";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;
  const companyId = ctx.company.id;

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);

  const sixMonthsAgo = new Date();
  sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - 5);
  sixMonthsAgo.setDate(1);
  sixMonthsAgo.setHours(0, 0, 0, 0);

  const [
    totalSalesAgg,
    monthSalesAgg,
    receivablesAgg,
    payablesAgg,
    lowStock,
    recentInvoices,
    invoiceCount,
    partyCount,
    itemCount,
    trendInvoices,
    trendPurchases,
    topItems,
  ] = await Promise.all([
    db.invoice.aggregate({ where: { companyId }, _sum: { grandTotalPaise: true } }),
    db.invoice.aggregate({
      where: { companyId, date: { gte: startOfMonth } },
      _sum: { grandTotalPaise: true },
    }),
    db.invoice.aggregate({
      where: { companyId, status: { not: "PAID" } },
      _sum: { grandTotalPaise: true, amountPaidPaise: true },
    }),
    db.purchase.aggregate({
      where: { companyId, status: { not: "PAID" } },
      _sum: { grandTotalPaise: true, amountPaidPaise: true },
    }),
    db.item.findMany({
      where: { companyId, lowStockAlert: { gt: 0 } },
      orderBy: { currentStock: "asc" },
      take: 5,
    }),
    db.invoice.findMany({
      where: { companyId },
      include: { party: true },
      orderBy: { date: "desc" },
      take: 6,
    }),
    db.invoice.count({ where: { companyId } }),
    db.party.count({ where: { companyId } }),
    db.item.count({ where: { companyId } }),
    db.invoice.findMany({
      where: { companyId, date: { gte: sixMonthsAgo } },
      select: { date: true, grandTotalPaise: true },
    }),
    db.purchase.findMany({
      where: { companyId, date: { gte: sixMonthsAgo } },
      select: { date: true, grandTotalPaise: true },
    }),
    db.invoiceItem.groupBy({
      by: ["itemName"],
      where: { invoice: { companyId } },
      _sum: { totalPaise: true },
      orderBy: { _sum: { totalPaise: "desc" } },
      take: 6,
    }),
  ]);

  const totalSales = totalSalesAgg._sum.grandTotalPaise ?? 0;
  const monthSales = monthSalesAgg._sum.grandTotalPaise ?? 0;
  const receivables =
    (receivablesAgg._sum.grandTotalPaise ?? 0) - (receivablesAgg._sum.amountPaidPaise ?? 0);
  const payables = (payablesAgg._sum.grandTotalPaise ?? 0) - (payablesAgg._sum.amountPaidPaise ?? 0);

  const kpis: Kpi[] = [
    { key: "sales", label: "Total Sales", value: totalSales },
    { key: "month", label: "This Month", value: monthSales },
    { key: "receivable", label: "Receivables", value: Math.max(0, receivables) },
    { key: "payable", label: "Payables", value: Math.max(0, payables) },
  ];

  // Build 6-month trend buckets
  const months: { key: string; month: string; sales: number; purchases: number }[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date();
    d.setMonth(d.getMonth() - i);
    const key = `${d.getFullYear()}-${d.getMonth()}`;
    months.push({
      key,
      month: d.toLocaleDateString("en-IN", { month: "short" }),
      sales: 0,
      purchases: 0,
    });
  }
  const bucket = new Map(months.map((m) => [m.key, m]));
  for (const inv of trendInvoices) {
    const d = new Date(inv.date);
    const m = bucket.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (m) m.sales += inv.grandTotalPaise;
  }
  for (const pur of trendPurchases) {
    const d = new Date(pur.date);
    const m = bucket.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (m) m.purchases += pur.grandTotalPaise;
  }
  const trendData = months.map((m) => ({
    month: m.month,
    sales: Math.round(m.sales),
    purchases: Math.round(m.purchases),
  }));

  const donutData = topItems
    .filter((t) => (t._sum.totalPaise ?? 0) > 0)
    .map((t) => ({ name: t.itemName, value: Math.round(t._sum.totalPaise ?? 0) }));

  const lowStockItems = lowStock.filter((i) => i.currentStock <= i.lowStockAlert);

  return (
    <div className="space-y-6">
      <FadeIn>
        <div className="flex flex-wrap gap-3 items-center justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>
            <p className="text-sm text-slate-500">
              Snapshot of your business · FY {ctx.company.financialYear}
            </p>
          </div>
          <div className="flex gap-2">
            <Link href="/invoices/new" className="btn-primary">
              <Plus className="h-4 w-4" /> New Invoice
            </Link>
            <Link href="/purchases/new" className="btn-secondary">
              <Plus className="h-4 w-4" /> New Purchase
            </Link>
          </div>
        </div>
      </FadeIn>

      <DashboardKpis kpis={kpis} />

      <div className="grid lg:grid-cols-3 gap-6">
        <FadeIn delay={0.1} className="lg:col-span-2">
          <div className="card card-padding h-full">
            <div className="flex items-center justify-between mb-4">
              <div>
                <h2 className="font-semibold">Sales vs Purchases</h2>
                <p className="text-xs text-slate-500">Last 6 months</p>
              </div>
              <div className="flex gap-4 text-xs">
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-brand-600" /> Sales
                </span>
                <span className="flex items-center gap-1.5">
                  <span className="h-2.5 w-2.5 rounded-full bg-rose-500" /> Purchases
                </span>
              </div>
            </div>
            <RevenueAreaChart data={trendData} />
          </div>
        </FadeIn>

        <FadeIn delay={0.15}>
          <div className="card card-padding h-full">
            <h2 className="font-semibold mb-1">Top selling items</h2>
            <p className="text-xs text-slate-500 mb-2">By sales value</p>
            <CategoryDonut data={donutData} />
          </div>
        </FadeIn>
      </div>

      <div className="grid lg:grid-cols-3 gap-6">
        <FadeIn delay={0.2} className="lg:col-span-2">
          <div className="card card-padding">
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">Recent Invoices</h2>
              <Link
                href="/invoices"
                className="text-sm text-brand-600 hover:underline flex items-center gap-1"
              >
                View all <ArrowUpRight className="h-3.5 w-3.5" />
              </Link>
            </div>
            {recentInvoices.length === 0 ? (
              <EmptyState
                title="No invoices yet"
                cta={{ href: "/invoices/new", label: "Create your first invoice" }}
              />
            ) : (
              <div className="overflow-x-auto -mx-5">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Invoice #</th>
                      <th>Party</th>
                      <th>Date</th>
                      <th className="text-right">Amount</th>
                      <th>Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentInvoices.map((inv) => (
                      <tr key={inv.id}>
                        <td className="font-medium">
                          <Link
                            href={`/invoices/${inv.id}`}
                            className="text-brand-600 hover:underline"
                          >
                            {inv.number}
                          </Link>
                        </td>
                        <td>{inv.party.name}</td>
                        <td>{formatDate(inv.date)}</td>
                        <td className="text-right font-semibold">{formatPaise(inv.grandTotalPaise)}</td>
                        <td>
                          <StatusBadge status={inv.status} />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </FadeIn>

        <FadeIn delay={0.25}>
          <div className="space-y-4">
            <div className="card card-padding">
              <h2 className="font-semibold flex items-center gap-2">
                <AlertTriangle className="h-4 w-4 text-amber-500" /> Low stock
              </h2>
              {lowStockItems.length === 0 ? (
                <p className="mt-2 text-sm text-slate-500">All items above safe stock. 🎉</p>
              ) : (
                <ul className="mt-3 space-y-2 text-sm">
                  {lowStockItems.map((it) => (
                    <li
                      key={it.id}
                      className="flex justify-between border-b border-slate-100 pb-2 last:border-0"
                    >
                      <span>{it.name}</span>
                      <span className="text-rose-600 font-medium">
                        {formatNumber(it.currentStock, 0)} {it.unit}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div className="card card-padding">
              <h2 className="font-semibold">Quick stats</h2>
              <ul className="mt-3 text-sm space-y-2">
                <Stat label="Total invoices" value={String(invoiceCount)} />
                <Stat label="Parties" value={String(partyCount)} />
                <Stat label="Items" value={String(itemCount)} />
              </ul>
            </div>
          </div>
        </FadeIn>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <li className="flex justify-between">
      <span className="text-slate-500">{label}</span>
      <span className="font-semibold">{value}</span>
    </li>
  );
}

function StatusBadge({ status }: { status: string }) {
  if (status === "PAID") return <span className="badge-green">Paid</span>;
  if (status === "PARTIAL") return <span className="badge-amber">Partial</span>;
  return <span className="badge-red">Unpaid</span>;
}

function EmptyState({ title, cta }: { title: string; cta: { href: string; label: string } }) {
  return (
    <div className="text-center py-10">
      <p className="text-slate-500">{title}</p>
      <Link href={cta.href} className="btn-primary mt-3">
        <Plus className="h-4 w-4" /> {cta.label}
      </Link>
    </div>
  );
}
