import Link from "next/link";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { formatPaise, formatNumber } from "@/lib/utils";
import { TrendingUp, TrendingDown, Receipt, Package, FileSpreadsheet, BookOpen, Users as UsersIcon, Clock, FileJson, Scale, LineChart, Landmark, Percent } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;
  const companyId = ctx.company.id;

  const from = searchParams.from ? new Date(searchParams.from) : new Date(new Date().getFullYear(), 0, 1);
  const to = searchParams.to ? new Date(searchParams.to) : new Date();
  to.setHours(23, 59, 59, 999);

  const dateFilter = { gte: from, lte: to };

  const [salesAgg, purchaseAgg, gstSales, gstPurchases, items, invoices] = await Promise.all([
    db.invoice.aggregate({
      where: { companyId, date: dateFilter },
      _sum: { subTotalPaise: true, taxTotalPaise: true, grandTotalPaise: true, cgstTotalPaise: true, sgstTotalPaise: true, igstTotalPaise: true },
      _count: true,
    }),
    db.purchase.aggregate({
      where: { companyId, date: dateFilter },
      _sum: { subTotalPaise: true, taxTotalPaise: true, grandTotalPaise: true, cgstTotalPaise: true, sgstTotalPaise: true, igstTotalPaise: true },
      _count: true,
    }),
    db.invoiceItem.groupBy({
      by: ["gstRate"],
      where: { invoice: { companyId, date: dateFilter } },
      _sum: { taxablePaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true },
    }),
    db.purchaseItem.groupBy({
      by: ["gstRate"],
      where: { purchase: { companyId, date: dateFilter } },
      _sum: { taxablePaise: true, cgstPaise: true, sgstPaise: true, igstPaise: true },
    }),
    db.item.findMany({ where: { companyId }, orderBy: { name: "asc" } }),
    db.invoice.findMany({
      where: { companyId, date: dateFilter },
      include: { party: true },
      orderBy: { date: "desc" },
      take: 100,
    }),
  ]);

  const sales = salesAgg._sum.grandTotalPaise ?? 0;
  const purchases = purchaseAgg._sum.grandTotalPaise ?? 0;
  const grossProfit = sales - purchases;
  const totalGSTCollected = (salesAgg._sum.taxTotalPaise ?? 0);
  const totalGSTPaid = (purchaseAgg._sum.taxTotalPaise ?? 0);
  const netGST = totalGSTCollected - totalGSTPaid;

  const stockValue = items.reduce((s, i) => s + i.currentStock * i.purchasePricePaise, 0);

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Reports</h1>
          <p className="text-sm text-slate-500">Financial reports and GST summary</p>
        </div>
      </div>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {[
          { href: "/reports/day-book", label: "Day Book", desc: "All vouchers by date", icon: BookOpen, color: "text-brand-600 bg-brand-50" },
          { href: "/reports/ledger", label: "Party Ledger", desc: "Statement of account", icon: UsersIcon, color: "text-violet-600 bg-violet-50" },
          { href: "/reports/outstanding", label: "Outstanding", desc: "Receivables & aging", icon: Clock, color: "text-amber-600 bg-amber-50" },
          { href: "/reports/gstr1", label: "GSTR-1", desc: "B2B, B2C, HSN + JSON", icon: FileJson, color: "text-emerald-600 bg-emerald-50" },
          { href: "/reports/trial-balance", label: "Trial Balance", desc: "Proves the books balance", icon: Scale, color: "text-sky-600 bg-sky-50" },
          { href: "/reports/profit-loss", label: "Profit & Loss", desc: "Income vs expenses", icon: LineChart, color: "text-emerald-600 bg-emerald-50" },
          { href: "/reports/balance-sheet", label: "Balance Sheet", desc: "Assets, liabilities, equity", icon: Landmark, color: "text-indigo-600 bg-indigo-50" },
          { href: "/reports/gst-summary", label: "GST Summary", desc: "Output vs input tax (3B)", icon: Percent, color: "text-rose-600 bg-rose-50" },
        ].map((r) => (
          <Link key={r.href} href={r.href} className="card card-padding card-hover flex items-start gap-3">
            <div className={`h-10 w-10 rounded-xl flex items-center justify-center shrink-0 ${r.color}`}>
              <r.icon className="h-5 w-5" />
            </div>
            <div>
              <div className="font-semibold text-sm">{r.label}</div>
              <div className="text-xs text-slate-500">{r.desc}</div>
            </div>
          </Link>
        ))}
      </div>

      <form className="card card-padding flex flex-wrap gap-3 items-end">
        <div>
          <label className="label">From</label>
          <input
            type="date"
            name="from"
            defaultValue={from.toISOString().slice(0, 10)}
            className="input"
          />
        </div>
        <div>
          <label className="label">To</label>
          <input
            type="date"
            name="to"
            defaultValue={to.toISOString().slice(0, 10)}
            className="input"
          />
        </div>
        <button className="btn-primary">Apply</button>
      </form>

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card label="Total Sales" value={formatPaise(sales)} icon={TrendingUp} color="emerald" />
        <Card
          label="Total Purchases"
          value={formatPaise(purchases)}
          icon={TrendingDown}
          color="rose"
        />
        <Card
          label="Gross Profit"
          value={formatPaise(grossProfit)}
          icon={Receipt}
          color={grossProfit >= 0 ? "emerald" : "rose"}
        />
        <Card label="Stock Value" value={formatPaise(stockValue)} icon={Package} color="brand" />
      </div>

      <div className="grid lg:grid-cols-2 gap-4">
        <div className="card card-padding">
          <h2 className="font-semibold flex items-center gap-2">
            <FileSpreadsheet className="h-4 w-4 text-brand-600" /> GST Summary (GSTR-1 / 3B)
          </h2>
          <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
            <Stat label="Output GST collected" value={formatPaise(totalGSTCollected)} green />
            <Stat label="Input GST paid" value={formatPaise(totalGSTPaid)} />
            <Stat
              label="Net GST payable"
              value={formatPaise(Math.max(0, netGST))}
              green={netGST <= 0}
            />
            <Stat
              label="ITC carried forward"
              value={formatPaise(Math.max(0, -netGST))}
            />
          </div>

          <h3 className="font-semibold mt-6 mb-2 text-sm">Sales — by GST rate</h3>
          <table className="table">
            <thead>
              <tr>
                <th>GST Rate</th>
                <th className="text-right">Taxable</th>
                <th className="text-right">CGST</th>
                <th className="text-right">SGST</th>
                <th className="text-right">IGST</th>
              </tr>
            </thead>
            <tbody>
              {gstSales.length === 0 ? (
                <tr>
                  <td colSpan={5} className="text-center text-slate-500 py-3">
                    No sales in range
                  </td>
                </tr>
              ) : (
                gstSales.map((r) => (
                  <tr key={r.gstRate}>
                    <td>{r.gstRate}%</td>
                    <td className="text-right">{formatPaise(r._sum.taxablePaise ?? 0)}</td>
                    <td className="text-right">{formatPaise(r._sum.cgstPaise ?? 0)}</td>
                    <td className="text-right">{formatPaise(r._sum.sgstPaise ?? 0)}</td>
                    <td className="text-right">{formatPaise(r._sum.igstPaise ?? 0)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        <div className="card card-padding">
          <h2 className="font-semibold">Profit & Loss</h2>
          <div className="mt-4 space-y-2 text-sm">
            <PLRow label="Sales (income)" value={sales} pos />
            <PLRow label="(–) Purchases" value={-purchases} />
            <div className="border-t border-slate-200 pt-2 flex justify-between font-semibold">
              <span>Gross Profit</span>
              <span className={grossProfit >= 0 ? "text-emerald-600" : "text-rose-600"}>
                {formatPaise(grossProfit)}
              </span>
            </div>
          </div>

          <h3 className="font-semibold mt-6 mb-2 text-sm">Stock report</h3>
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th className="text-right">Stock</th>
                <th className="text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {items.slice(0, 8).map((i) => (
                <tr key={i.id}>
                  <td>{i.name}</td>
                  <td className="text-right">
                    {formatNumber(i.currentStock, 0)} {i.unit}
                  </td>
                  <td className="text-right">{formatPaise(i.currentStock * i.purchasePricePaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card card-padding">
        <h2 className="font-semibold mb-3">Sales register ({invoices.length})</h2>
        <div className="overflow-x-auto -mx-5">
          <table className="table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>Date</th>
                <th>Party</th>
                <th className="text-right">Taxable</th>
                <th className="text-right">Tax</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {invoices.map((i) => (
                <tr key={i.id}>
                  <td>
                    <Link href={`/invoices/${i.id}`} className="text-brand-600 hover:underline">
                      {i.number}
                    </Link>
                  </td>
                  <td>{new Date(i.date).toLocaleDateString("en-IN")}</td>
                  <td>{i.party.name}</td>
                  <td className="text-right">{formatPaise(i.subTotalPaise)}</td>
                  <td className="text-right">{formatPaise(i.taxTotalPaise)}</td>
                  <td className="text-right font-semibold">{formatPaise(i.grandTotalPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Card({
  label,
  value,
  icon: Icon,
  color,
}: {
  label: string;
  value: string;
  icon: any;
  color: string;
}) {
  const map: Record<string, string> = {
    emerald: "from-emerald-500 to-emerald-600",
    rose: "from-rose-500 to-rose-600",
    brand: "from-brand-500 to-brand-700",
  };
  return (
    <div className="card card-padding card-hover">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-xs text-slate-500 uppercase font-medium">{label}</div>
          <div className="mt-2 text-2xl font-bold">{value}</div>
        </div>
        <div
          className={`h-10 w-10 rounded-lg bg-gradient-to-br ${map[color]} text-white flex items-center justify-center`}
        >
          <Icon className="h-5 w-5" />
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value, green }: { label: string; value: string; green?: boolean }) {
  return (
    <div className="card card-padding !p-3">
      <div className="text-xs text-slate-500">{label}</div>
      <div className={`mt-1 font-semibold ${green ? "text-emerald-700" : ""}`}>{value}</div>
    </div>
  );
}

function PLRow({ label, value, pos }: { label: string; value: number; pos?: boolean }) {
  return (
    <div className="flex justify-between">
      <span className="text-slate-600">{label}</span>
      <span className={pos ? "text-emerald-700 font-medium" : "text-rose-700 font-medium"}>
        {formatPaise(value)}
      </span>
    </div>
  );
}
