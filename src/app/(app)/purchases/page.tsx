import Link from "next/link";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { formatINR, formatDate } from "@/lib/utils";
import { Plus, Eye } from "lucide-react";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";

export default async function PurchasesPage() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;
  const purchases = await db.purchase.findMany({
    where: { companyId: ctx.company.id },
    include: { party: true },
    orderBy: { date: "desc" },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Purchases</h1>
          <p className="text-sm text-slate-500">Vendor bills and purchase invoices</p>
        </div>
        <Link href="/purchases/new" className="btn-primary">
          <Plus className="h-4 w-4" /> New Purchase
        </Link>
      </div>

      <div className="card card-padding">
        <div className="overflow-x-auto -mx-5">
          <table className="table">
            <thead>
              <tr>
                <th>Purchase #</th>
                <th>Vendor Bill #</th>
                <th>Date</th>
                <th>Vendor</th>
                <th className="text-right">Subtotal</th>
                <th className="text-right">Tax</th>
                <th className="text-right">Total</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {purchases.length === 0 ? (
                <tr>
                  <td colSpan={9}>
                    <EmptyState
                      title="No purchases yet"
                      description="Record vendor bills to track expenses and grow your stock."
                      ctaHref="/purchases/new"
                      ctaLabel="Add Purchase"
                    />
                  </td>
                </tr>
              ) : (
                purchases.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link
                        href={`/purchases/${p.id}`}
                        className="font-medium text-brand-600 hover:underline"
                      >
                        {p.number}
                      </Link>
                    </td>
                    <td className="text-xs">{p.vendorBillNo || "—"}</td>
                    <td>{formatDate(p.date)}</td>
                    <td>{p.party.name}</td>
                    <td className="text-right">{formatINR(p.subTotal)}</td>
                    <td className="text-right">{formatINR(p.taxTotal)}</td>
                    <td className="text-right font-semibold">{formatINR(p.grandTotal)}</td>
                    <td>
                      {p.status === "PAID" ? (
                        <span className="badge-green">Paid</span>
                      ) : p.status === "PARTIAL" ? (
                        <span className="badge-amber">Partial</span>
                      ) : (
                        <span className="badge-red">Unpaid</span>
                      )}
                    </td>
                    <td>
                      <Link href={`/purchases/${p.id}`} className="btn-ghost p-2">
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
