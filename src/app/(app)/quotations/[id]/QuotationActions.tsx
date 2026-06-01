"use client";
import { Trash2, FileCheck, Printer } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

export default function QuotationActions({ quotation }: { quotation: any }) {
  const router = useRouter();
  const [loading, setLoading] = useState(false);
  const converted = quotation.status === "CONVERTED" || quotation.convertedInvoiceId;

  async function convert() {
    if (!confirm("Convert this quotation into a sales invoice? Stock will be deducted.")) return;
    setLoading(true);
    const res = await fetch(`/api/quotations/${quotation.id}/convert`, { method: "POST" });
    setLoading(false);
    if (res.ok) {
      const data = await res.json();
      toast.success("Converted to invoice");
      router.push(`/invoices/${data.id}`);
      router.refresh();
    } else {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error || "Failed");
    }
  }

  async function onDelete() {
    if (!confirm("Delete this quotation?")) return;
    const res = await fetch(`/api/quotations/${quotation.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Deleted");
      router.push("/quotations");
      router.refresh();
    } else toast.error("Failed");
  }

  return (
    <div className="flex gap-2 items-center">
      {converted ? (
        <a href={`/invoices/${quotation.convertedInvoiceId}`} className="btn-secondary">
          <FileCheck className="h-4 w-4" /> View Invoice
        </a>
      ) : (
        <button className="btn-primary" onClick={convert} disabled={loading}>
          <FileCheck className="h-4 w-4" /> {loading ? "Converting..." : "Convert to Invoice"}
        </button>
      )}
      <button className="btn-secondary" onClick={() => window.print()}>
        <Printer className="h-4 w-4" /> Print
      </button>
      <button className="btn-ghost text-rose-600" onClick={onDelete}>
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
