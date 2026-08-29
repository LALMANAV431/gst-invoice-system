import Link from "next/link";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { formatPaise, formatDate } from "@/lib/utils";
import { Plus, Eye } from "lucide-react";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";

export default async function InvoicesPage() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;
  const invoices = await db.invoice.findMany({
    where: { companyId: ctx.company.id },
    include: { party: true },
    orderBy: { date: "desc" },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Sales Invoices</h1>
          <p className="text-sm text-slate-500">All your GST sales invoices</p>
        </div>
        <Link href="/invoices/new" className="btn-primary">
          <Plus className="h-4 w-4" /> New Invoice
        </Link>
      </div>

      <div className="card card-padding">
        <div className="overflow-x-auto -mx-5">
          <table className="table">
            <thead>
              <tr>
                <th>Invoice #</th>
                <th>Date</th>
                <th>Party</th>
                <th className="text-right">Subtotal</th>
                <th className="text-right">Tax</th>
                <th className="text-right">Total</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {invoices.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      title="No invoices yet"
                      description="Create your first GST-compliant sales invoice in seconds."
                      ctaHref="/invoices/new"
                      ctaLabel="Create Invoice"
                    />
                  </td>
                </tr>
              ) : (
                invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td>
                      <Link
                        href={`/invoices/${inv.id}`}
                        className="font-medium text-brand-600 hover:underline"
                      >
                        {inv.number}
                      </Link>
                    </td>
                    <td>{formatDate(inv.date)}</td>
                    <td>{inv.party.name}</td>
                    <td className="text-right">{formatPaise(inv.subTotalPaise)}</td>
                    <td className="text-right">{formatPaise(inv.taxTotalPaise)}</td>
                    <td className="text-right font-semibold">{formatPaise(inv.grandTotalPaise)}</td>
                    <td>
                      {inv.status === "PAID" ? (
                        <span className="badge-green">Paid</span>
                      ) : inv.status === "PARTIAL" ? (
                        <span className="badge-amber">Partial</span>
                      ) : (
                        <span className="badge-red">Unpaid</span>
                      )}
                    </td>
                    <td>
                      <Link href={`/invoices/${inv.id}`} className="btn-ghost p-2">
                        <Eye className="h-4 w-4" />
                      </Link>
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
