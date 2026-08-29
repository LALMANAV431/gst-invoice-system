import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { notFound } from "next/navigation";
import { formatDate, formatPaise, numberToWords } from "@/lib/utils";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import CreditNoteActions from "./CreditNoteActions";

export default async function CreditNoteDetailPage({ params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;
  const company = ctx.company;
  const n = await db.creditNote.findFirst({
    where: { id: params.id, companyId: company.id },
    include: { party: true, items: true },
  });
  if (!n) notFound();

  const title = n.kind === "CREDIT" ? "CREDIT NOTE" : "DEBIT NOTE";

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between no-print">
        <Link href="/credit-notes" className="btn-ghost text-sm">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <CreditNoteActions note={JSON.parse(JSON.stringify(n))} />
      </div>

      <div className="card p-8">
        <div className="flex justify-between items-start border-b border-slate-200 pb-6">
          <div>
            <h1 className="text-2xl font-bold">{company.name}</h1>
            {company.gstin && <p className="text-sm text-slate-600 mt-1">GSTIN: {company.gstin}</p>}
            <p className="text-sm text-slate-600">
              {[company.addressLine1, company.city, company.state, company.pincode]
                .filter(Boolean)
                .join(", ")}
            </p>
          </div>
          <div className="text-right">
            <h2 className="text-3xl font-bold text-brand-600">{title}</h2>
            <p className="text-sm text-slate-600 mt-2">
              <strong>{n.number}</strong>
            </p>
            <p className="text-sm text-slate-600">Date: {formatDate(n.date)}</p>
            {n.originalRef && (
              <p className="text-sm text-slate-600">Against: {n.originalRef}</p>
            )}
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6 py-6 border-b border-slate-200">
          <div>
            <p className="text-xs uppercase font-semibold text-slate-500">
              {n.kind === "CREDIT" ? "Customer" : "Vendor"}
            </p>
            <p className="mt-1 font-semibold">{n.party.name}</p>
            {n.party.gstin && <p className="text-sm text-slate-600">GSTIN: {n.party.gstin}</p>}
          </div>
          <div className="text-right">
            {n.reason && (
              <>
                <p className="text-xs uppercase font-semibold text-slate-500">Reason</p>
                <p className="text-sm mt-1">{n.reason}</p>
              </>
            )}
          </div>
        </div>

        <div className="overflow-x-auto py-4">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50">
                <th className="text-left py-2 px-3">#</th>
                <th className="text-left py-2 px-3">Item</th>
                <th className="text-left py-2 px-3">HSN</th>
                <th className="text-right py-2 px-3">Qty</th>
                <th className="text-right py-2 px-3">Rate</th>
                <th className="text-right py-2 px-3">Taxable</th>
                <th className="text-right py-2 px-3">GST%</th>
                <th className="text-right py-2 px-3">Total</th>
              </tr>
            </thead>
            <tbody>
              {n.items.map((it, i) => (
                <tr key={it.id} className="border-b border-slate-100">
                  <td className="py-2 px-3">{i + 1}</td>
                  <td className="py-2 px-3 font-medium">{it.itemName}</td>
                  <td className="py-2 px-3">{it.hsn || "—"}</td>
                  <td className="py-2 px-3 text-right">
                    {it.quantity} {it.unit}
                  </td>
                  <td className="py-2 px-3 text-right">{formatPaise(it.ratePaise)}</td>
                  <td className="py-2 px-3 text-right">{formatPaise(it.taxablePaise)}</td>
                  <td className="py-2 px-3 text-right">{it.gstRate}%</td>
                  <td className="py-2 px-3 text-right font-semibold">{formatPaise(it.totalPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid md:grid-cols-2 gap-6 pt-4 border-t border-slate-200">
          <div>
            <p className="text-xs uppercase font-semibold text-slate-500">Amount in Words</p>
            <p className="text-sm mt-1 italic">{numberToWords(n.grandTotalPaise)}</p>
            {n.notes && (
              <>
                <p className="text-xs uppercase font-semibold text-slate-500 mt-4">Notes</p>
                <p className="text-sm mt-1">{n.notes}</p>
              </>
            )}
          </div>
          <div className="text-sm">
            <Row label="Subtotal" value={formatPaise(n.subTotalPaise)} />
            {n.isInterState ? (
              <Row label="IGST" value={formatPaise(n.igstTotalPaise)} />
            ) : (
              <>
                <Row label="CGST" value={formatPaise(n.cgstTotalPaise)} />
                <Row label="SGST" value={formatPaise(n.sgstTotalPaise)} />
              </>
            )}
            {n.discountPaise > 0 && <Row label="Discount" value={`- ${formatPaise(n.discountPaise)}`} />}
            <div className="flex justify-between border-t border-slate-200 mt-2 pt-2 font-bold text-lg">
              <span>Grand Total</span>
              <span>{formatPaise(n.grandTotalPaise)}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between py-1">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
