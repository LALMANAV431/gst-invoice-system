import Link from "next/link";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { formatINR, formatDate } from "@/lib/utils";
import { Plus, Eye } from "lucide-react";
import EmptyState from "@/components/EmptyState";

export const dynamic = "force-dynamic";

export default async function CreditNotesPage() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;
  const notes = await db.creditNote.findMany({
    where: { companyId: ctx.company.id },
    include: { party: true },
    orderBy: { date: "desc" },
  });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Credit / Debit Notes</h1>
          <p className="text-sm text-slate-500">Sales returns (credit) and purchase returns (debit)</p>
        </div>
        <div className="flex gap-2">
          <Link href="/credit-notes/new?kind=CREDIT" className="btn-primary">
            <Plus className="h-4 w-4" /> Credit Note
          </Link>
          <Link href="/credit-notes/new?kind=DEBIT" className="btn-secondary">
            <Plus className="h-4 w-4" /> Debit Note
          </Link>
        </div>
      </div>

      <div className="card card-padding">
        <div className="overflow-x-auto -mx-5">
          <table className="table">
            <thead>
              <tr>
                <th>Note #</th>
                <th>Type</th>
                <th>Date</th>
                <th>Party</th>
                <th>Against</th>
                <th>Reason</th>
                <th className="text-right">Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {notes.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      title="No credit/debit notes yet"
                      description="Issue a credit note for sales returns or a debit note for purchase returns."
                      ctaHref="/credit-notes/new?kind=CREDIT"
                      ctaLabel="Create Credit Note"
                    />
                  </td>
                </tr>
              ) : (
                notes.map((n) => (
                  <tr key={n.id}>
                    <td>
                      <Link
                        href={`/credit-notes/${n.id}`}
                        className="font-medium text-brand-600 hover:underline"
                      >
                        {n.number}
                      </Link>
                    </td>
                    <td>
                      {n.kind === "CREDIT" ? (
                        <span className="badge-green">Credit</span>
                      ) : (
                        <span className="badge-amber">Debit</span>
                      )}
                    </td>
                    <td>{formatDate(n.date)}</td>
                    <td>{n.party.name}</td>
                    <td className="text-xs">{n.originalRef || "—"}</td>
                    <td className="text-xs">{n.reason || "—"}</td>
                    <td className="text-right font-semibold">{formatINR(n.grandTotal)}</td>
                    <td>
                      <Link href={`/credit-notes/${n.id}`} className="btn-ghost p-2">
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
