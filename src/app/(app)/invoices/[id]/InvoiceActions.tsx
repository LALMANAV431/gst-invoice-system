"use client";
import { Download, Printer, Trash2, IndianRupee, MessageCircle, Mail } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { generateInvoicePDF } from "@/lib/pdf";
import { shareWhatsApp, shareEmail } from "@/lib/export";
import { formatINR } from "@/lib/utils";

export default function InvoiceActions({ invoice, company }: { invoice: any; company: any }) {
  const router = useRouter();
  const [recordingPayment, setRecordingPayment] = useState(false);
  const [amount, setAmount] = useState(invoice.grandTotal - invoice.amountPaid);
  const [mode, setMode] = useState("CASH");

  async function onDelete() {
    if (!confirm(`Delete invoice ${invoice.number}? Stock will be restored.`)) return;
    const res = await fetch(`/api/invoices/${invoice.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Deleted");
      router.push("/invoices");
      router.refresh();
    } else toast.error("Failed");
  }

  function onPDF() {
    generateInvoicePDF(invoice, company);
  }

  async function onRecordPayment(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partyId: invoice.partyId,
        invoiceId: invoice.id,
        type: "RECEIVED",
        mode,
        amount,
        date: new Date().toISOString(),
      }),
    });
    if (res.ok) {
      toast.success("Payment recorded");
      setRecordingPayment(false);
      router.refresh();
    } else {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error || "Failed");
    }
  }

  return (
    <div className="flex flex-wrap gap-2 items-center">
      {invoice.status !== "PAID" && (
        <button className="btn-primary" onClick={() => setRecordingPayment((s) => !s)}>
          <IndianRupee className="h-4 w-4" /> Record payment
        </button>
      )}
      <button className="btn-secondary" onClick={onPDF}>
        <Download className="h-4 w-4" /> PDF
      </button>
      <button className="btn-secondary" onClick={() => window.print()}>
        <Printer className="h-4 w-4" /> Print
      </button>
      <button
        className="btn-secondary !bg-emerald-50 !text-emerald-700 !border-emerald-200 hover:!bg-emerald-100"
        onClick={() => {
          const msg = `Invoice ${invoice.number}\nAmount: ${formatINR(invoice.grandTotal)}\nDate: ${new Date(invoice.date).toLocaleDateString("en-IN")}\nFrom: ${company.name}${company.gstin ? `\nGSTIN: ${company.gstin}` : ""}`;
          shareWhatsApp(msg, invoice.party?.phone);
          toast.success("Opening WhatsApp...");
        }}
      >
        <MessageCircle className="h-4 w-4" /> WhatsApp
      </button>
      <button
        className="btn-secondary"
        onClick={() => {
          shareEmail({
            to: invoice.party?.email || "",
            subject: `Invoice ${invoice.number} from ${company.name}`,
            body: `Dear ${invoice.party?.name},\n\nPlease find attached invoice ${invoice.number} for ${formatINR(invoice.grandTotal)}.\n\nRegards,\n${company.name}`,
          });
          toast.success("Opening email...");
        }}
      >
        <Mail className="h-4 w-4" /> Email
      </button>
      <button className="btn-ghost text-rose-600" onClick={onDelete}>
        <Trash2 className="h-4 w-4" />
      </button>

      {recordingPayment && (
        <form
          onSubmit={onRecordPayment}
          className="absolute right-6 mt-32 z-10 card card-padding shadow-lg w-72"
        >
          <h3 className="font-semibold mb-2">Record payment</h3>
          <label className="label">Amount</label>
          <input
            type="number"
            step="0.01"
            className="input mb-2"
            value={amount}
            onChange={(e) => setAmount(parseFloat(e.target.value) || 0)}
          />
          <label className="label">Mode</label>
          <select className="input mb-3" value={mode} onChange={(e) => setMode(e.target.value)}>
            <option value="CASH">Cash</option>
            <option value="BANK">Bank transfer</option>
            <option value="UPI">UPI</option>
            <option value="CHEQUE">Cheque</option>
            <option value="CARD">Card</option>
          </select>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => setRecordingPayment(false)}>
              Cancel
            </button>
            <button className="btn-primary flex-1">Save</button>
          </div>
        </form>
      )}
    </div>
  );
}
