import Link from "next/link";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { formatPaise, formatDate } from "@/lib/utils";
import { Plus, Eye } from "lucide-react";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";

function StatusBadge({ status }: { status: string }) {
  if (status === "CONVERTED") return <span className="badge-green">Converted</span>;
  if (status === "ACCEPTED") return <span className="badge-green">Accepted</span>;
  if (status === "EXPIRED") return <span className="badge-slate">Expired</span>;
  if (status === "REJECTED") return <span className="badge-red">Rejected</span>;
  return <span className="badge-amber">Open</span>;
}

export default async function QuotationsPage() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;
  const quotations = await db.quotation.findMany({
    where: { companyId: ctx.company.id },
    include: { party: true },
    orderBy: { date: "desc" },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Quotations / Estimates</h1>
          <p className="text-sm text-slate-500">Send quotes and convert them to invoices</p>
        </div>
        <Link href="/quotations/new" className="btn-primary">
          <Plus className="h-4 w-4" /> New Quotation
        </Link>
      </div>

      <div className="card card-padding">
        <div className="overflow-x-auto -mx-5">
          <table className="table">
            <thead>
              <tr>
                <th>Quote #</th>
                <th>Date</th>
                <th>Valid Until</th>
                <th>Customer</th>
                <th className="text-right">Total</th>
                <th>Status</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {quotations.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <EmptyState
                      title="No quotations yet"
                      description="Create a quote, share it, and convert to an invoice when accepted."
                      ctaHref="/quotations/new"
                      ctaLabel="New Quotation"
                    />
                  </td>
                </tr>
              ) : (
                quotations.map((q) => (
                  <tr key={q.id}>
                    <td>
                      <Link
                        href={`/quotations/${q.id}`}
                        className="font-medium text-brand-600 hover:underline"
                      >
                        {q.number}
                      </Link>
                    </td>
                    <td>{formatDate(q.date)}</td>
                    <td>{q.validUntil ? formatDate(q.validUntil) : "—"}</td>
                    <td>{q.party.name}</td>
                    <td className="text-right font-semibold">{formatPaise(q.grandTotalPaise)}</td>
                    <td>
                      <StatusBadge status={q.status} />
                    </td>
                    <td>
                      <Link href={`/quotations/${q.id}`} className="btn-ghost p-2">
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
