import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { notFound } from "next/navigation";
import { formatDate, formatPaise } from "@/lib/utils";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import PurchaseActions from "./PurchaseActions";

export default async function PurchaseDetailPage({ params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;
  const purchase = await db.purchase.findFirst({
    where: { id: params.id, companyId: ctx.company.id },
    include: { party: true, items: true, payments: true },
  });
  if (!purchase) notFound();

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between">
        <Link href="/purchases" className="btn-ghost text-sm">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <PurchaseActions purchase={JSON.parse(JSON.stringify(purchase))} />
      </div>

      <div className="card card-padding space-y-4">
        <div className="flex justify-between">
          <div>
            <h1 className="text-xl font-bold">{purchase.number}</h1>
            <p className="text-sm text-slate-500">
              {purchase.vendorBillNo ? `Vendor bill: ${purchase.vendorBillNo} · ` : ""}
              {formatDate(purchase.date)}
            </p>
          </div>
          <div className="text-right">
            <p className="text-xs text-slate-500">Vendor</p>
            <p className="font-semibold">{purchase.party.name}</p>
            {purchase.party.gstin && (
              <p className="text-xs text-slate-500">GSTIN: {purchase.party.gstin}</p>
            )}
          </div>
        </div>

        <table className="table">
          <thead>
            <tr>
              <th>Item</th>
              <th>HSN</th>
              <th className="text-right">Qty</th>
              <th className="text-right">Rate</th>
              <th className="text-right">Taxable</th>
              <th className="text-right">GST%</th>
              <th className="text-right">Tax</th>
              <th className="text-right">Total</th>
            </tr>
          </thead>
          <tbody>
            {purchase.items.map((it) => (
              <tr key={it.id}>
                <td>{it.itemName}</td>
                <td>{it.hsn || "—"}</td>
                <td className="text-right">
                  {it.quantity} {it.unit}
                </td>
                <td className="text-right">{formatPaise(it.ratePaise)}</td>
                <td className="text-right">{formatPaise(it.taxablePaise)}</td>
                <td className="text-right">{it.gstRate}%</td>
                <td className="text-right">{formatPaise(it.cgstPaise + it.sgstPaise + it.igstPaise)}</td>
                <td className="text-right font-semibold">{formatPaise(it.totalPaise)}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <div className="flex justify-end">
          <div className="w-72 text-sm">
            <Row label="Subtotal" value={formatPaise(purchase.subTotalPaise)} />
            {purchase.isInterState ? (
              <Row label="IGST" value={formatPaise(purchase.igstTotalPaise)} />
            ) : (
              <>
                <Row label="CGST" value={formatPaise(purchase.cgstTotalPaise)} />
                <Row label="SGST" value={formatPaise(purchase.sgstTotalPaise)} />
              </>
            )}
            {purchase.discountPaise > 0 && (
              <Row label="Discount" value={`- ${formatPaise(purchase.discountPaise)}`} />
            )}
            <div className="flex justify-between border-t border-slate-200 mt-2 pt-2 font-bold text-lg">
              <span>Total</span>
              <span>{formatPaise(purchase.grandTotalPaise)}</span>
            </div>
            {purchase.amountPaidPaise > 0 && (
              <Row label="Paid" value={formatPaise(purchase.amountPaidPaise)} />
            )}
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
