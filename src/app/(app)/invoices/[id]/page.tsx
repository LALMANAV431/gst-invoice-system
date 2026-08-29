import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { notFound } from "next/navigation";
import { formatDate, formatPaise, numberToWords } from "@/lib/utils";
import InvoiceActions from "./InvoiceActions";
import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import UpiQr from "@/components/UpiQr";

export default async function InvoiceDetailPage({ params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;
  const company = ctx.company;
  const invoice = await db.invoice.findFirst({
    where: { id: params.id, companyId: company.id },
    include: { party: true, items: true, payments: true },
  });
  if (!invoice) notFound();

  return (
    <div className="space-y-4 max-w-5xl mx-auto">
      <div className="flex items-center justify-between no-print">
        <Link href="/invoices" className="btn-ghost text-sm">
          <ArrowLeft className="h-4 w-4" /> Back
        </Link>
        <InvoiceActions
          invoice={JSON.parse(JSON.stringify(invoice))}
          company={JSON.parse(JSON.stringify(company))}
        />
      </div>

      <div className="card p-8 print:shadow-none print:border-0" id="invoice-print">
        <div className="flex justify-between items-start border-b border-slate-200 pb-6">
          <div>
            <h1 className="text-2xl font-bold">{company.name}</h1>
            {company.gstin && (
              <p className="text-sm text-slate-600 mt-1">GSTIN: {company.gstin}</p>
            )}
            <p className="text-sm text-slate-600">
              {[company.addressLine1, company.city, company.state, company.pincode]
                .filter(Boolean)
                .join(", ")}
            </p>
            {company.phone && <p className="text-sm text-slate-600">{company.phone}</p>}
            {company.email && <p className="text-sm text-slate-600">{company.email}</p>}
          </div>
          <div className="text-right">
            <h2 className="text-3xl font-bold text-brand-600">TAX INVOICE</h2>
            <p className="text-sm text-slate-600 mt-2">
              <strong>{invoice.number}</strong>
            </p>
            <p className="text-sm text-slate-600">Date: {formatDate(invoice.date)}</p>
            {invoice.dueDate && (
              <p className="text-sm text-slate-600">Due: {formatDate(invoice.dueDate)}</p>
            )}
          </div>
        </div>

        <div className="grid md:grid-cols-2 gap-6 py-6 border-b border-slate-200">
          <div>
            <p className="text-xs uppercase font-semibold text-slate-500">Bill To</p>
            <p className="mt-1 font-semibold">{invoice.party.name}</p>
            {invoice.party.gstin && (
              <p className="text-sm text-slate-600">GSTIN: {invoice.party.gstin}</p>
            )}
            {invoice.party.addressLine1 && (
              <p className="text-sm text-slate-600">{invoice.party.addressLine1}</p>
            )}
            <p className="text-sm text-slate-600">
              {[invoice.party.city, invoice.party.state, invoice.party.pincode]
                .filter(Boolean)
                .join(", ")}
            </p>
            {invoice.party.phone && (
              <p className="text-sm text-slate-600">{invoice.party.phone}</p>
            )}
          </div>
          <div className="text-right">
            <p className="text-xs uppercase font-semibold text-slate-500">Status</p>
            <p className="mt-1">
              {invoice.status === "PAID" ? (
                <span className="badge-green text-base px-3 py-1">PAID</span>
              ) : invoice.status === "PARTIAL" ? (
                <span className="badge-amber text-base px-3 py-1">PARTIAL</span>
              ) : (
                <span className="badge-red text-base px-3 py-1">UNPAID</span>
              )}
            </p>
            <p className="mt-2 text-sm text-slate-600">
              Place of Supply: {invoice.party.state || "—"}
            </p>
            <p className="text-sm text-slate-600">
              {invoice.isInterState ? "Inter-State (IGST)" : "Intra-State (CGST + SGST)"}
            </p>
          </div>
        </div>

        {(invoice.irn || invoice.ewayBillNo) && (
          <div className="grid sm:grid-cols-2 gap-4 py-4 border-b border-slate-200">
            {invoice.irn && (
              <div className="rounded-xl bg-violet-50 border border-violet-100 p-3">
                <p className="text-xs uppercase font-semibold text-violet-700">E-Invoice</p>
                <p className="text-xs text-slate-600 mt-1 break-all">
                  <strong>IRN:</strong> {invoice.irn}
                </p>
                {invoice.ackNo && (
                  <p className="text-xs text-slate-600">
                    <strong>Ack No:</strong> {invoice.ackNo}
                    {invoice.ackDate ? ` · ${formatDate(invoice.ackDate)}` : ""}
                  </p>
                )}
              </div>
            )}
            {invoice.ewayBillNo && (
              <div className="rounded-xl bg-amber-50 border border-amber-100 p-3">
                <p className="text-xs uppercase font-semibold text-amber-700">E-Way Bill</p>
                <p className="text-xs text-slate-600 mt-1">
                  <strong>EWB No:</strong> {invoice.ewayBillNo}
                </p>
                {invoice.ewayBillDate && (
                  <p className="text-xs text-slate-600">
                    <strong>Date:</strong> {formatDate(invoice.ewayBillDate)}
                  </p>
                )}
              </div>
            )}
          </div>
        )}

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
                <th className="text-right py-2 px-3">Tax</th>
                <th className="text-right py-2 px-3">Total</th>
              </tr>
            </thead>
            <tbody>
              {invoice.items.map((it, i) => (
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
                  <td className="py-2 px-3 text-right">
                    {formatPaise(it.cgstPaise + it.sgstPaise + it.igstPaise)}
                  </td>
                  <td className="py-2 px-3 text-right font-semibold">{formatPaise(it.totalPaise)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="grid md:grid-cols-2 gap-6 pt-4 border-t border-slate-200">
          <div>
            <p className="text-xs uppercase font-semibold text-slate-500">Amount in Words</p>
            <p className="text-sm mt-1 italic">{numberToWords(invoice.grandTotalPaise)}</p>
            {invoice.notes && (
              <>
                <p className="text-xs uppercase font-semibold text-slate-500 mt-4">Notes</p>
                <p className="text-sm mt-1">{invoice.notes}</p>
              </>
            )}
          </div>
          <div className="text-sm">
            <Row label="Subtotal" value={formatPaise(invoice.subTotalPaise)} />
            {invoice.isInterState ? (
              <Row label="IGST" value={formatPaise(invoice.igstTotalPaise)} />
            ) : (
              <>
                <Row label="CGST" value={formatPaise(invoice.cgstTotalPaise)} />
                <Row label="SGST" value={formatPaise(invoice.sgstTotalPaise)} />
              </>
            )}
            {invoice.discountPaise > 0 && (
              <Row label="Discount" value={`- ${formatPaise(invoice.discountPaise)}`} />
            )}
            {invoice.tdsPaise > 0 && (
              <Row label={`TDS (${invoice.tdsRate}%)`} value={`- ${formatPaise(invoice.tdsPaise)}`} />
            )}
            {invoice.roundOffPaise !== 0 && (
              <Row label="Round off" value={formatPaise(invoice.roundOffPaise)} />
            )}
            <div className="flex justify-between border-t border-slate-200 mt-2 pt-2 font-bold text-lg">
              <span>Grand Total</span>
              <span>{formatPaise(invoice.grandTotalPaise)}</span>
            </div>
            {invoice.amountPaidPaise > 0 && (
              <>
                <Row label="Paid" value={formatPaise(invoice.amountPaidPaise)} />
                <Row
                  label="Balance"
                  value={formatPaise(invoice.grandTotalPaise - invoice.amountPaidPaise)}
                />
              </>
            )}
          </div>
        </div>

        {(company.upiId || company.bankName) && (
          <div className="grid sm:grid-cols-2 gap-4 pt-6 border-t border-slate-200 mt-6">
            {company.bankName && (
              <div className="text-sm">
                <p className="text-xs uppercase font-semibold text-slate-500">Bank Details</p>
                <p className="mt-1">{company.bankName}</p>
                {company.bankAccountNo && <p>A/C: {company.bankAccountNo}</p>}
                {company.bankIfsc && <p>IFSC: {company.bankIfsc}</p>}
              </div>
            )}
            {company.upiId && invoice.grandTotalPaise - invoice.amountPaidPaise > 0 && (
              <UpiQr
                upiId={company.upiId}
                payeeName={company.name}
                amount={invoice.grandTotalPaise - invoice.amountPaidPaise}
                note={invoice.number}
              />
            )}
          </div>
        )}

        <div className="pt-12 text-center text-xs text-slate-500 border-t border-slate-200 mt-8">
          This is a system-generated invoice.
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
