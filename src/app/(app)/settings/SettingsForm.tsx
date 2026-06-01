"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

export default function SettingsForm({ initial }: { initial: any }) {
  const router = useRouter();
  const [form, setForm] = useState({ ...initial });
  const [loading, setLoading] = useState(false);

  function set(k: string, v: any) {
    setForm((f: any) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const res = await fetch(`/api/company`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setLoading(false);
    if (res.ok) {
      toast.success("Saved");
      router.refresh();
    } else {
      toast.error("Failed");
    }
  }

  return (
    <form onSubmit={submit} className="card card-padding space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        <Field label="Company name" value={form.name} onChange={(v) => set("name", v)} required />
        <Field label="GSTIN" value={form.gstin ?? ""} onChange={(v) => set("gstin", v.toUpperCase())} />
        <Field label="PAN" value={form.pan ?? ""} onChange={(v) => set("pan", v.toUpperCase())} />
        <Field label="Phone" value={form.phone ?? ""} onChange={(v) => set("phone", v)} />
        <Field label="Email" value={form.email ?? ""} onChange={(v) => set("email", v)} />
        <Field label="Financial Year" value={form.financialYear} onChange={(v) => set("financialYear", v)} />
        <Field label="State" value={form.state ?? ""} onChange={(v) => set("state", v)} />
        <Field label="State code" value={form.stateCode ?? ""} onChange={(v) => set("stateCode", v)} />
        <Field label="City" value={form.city ?? ""} onChange={(v) => set("city", v)} />
        <Field label="Pincode" value={form.pincode ?? ""} onChange={(v) => set("pincode", v)} />
        <div className="md:col-span-2">
          <label className="label">Address</label>
          <input
            className="input mb-2"
            placeholder="Line 1"
            value={form.addressLine1 ?? ""}
            onChange={(e) => set("addressLine1", e.target.value)}
          />
          <input
            className="input"
            placeholder="Line 2"
            value={form.addressLine2 ?? ""}
            onChange={(e) => set("addressLine2", e.target.value)}
          />
        </div>
        <Field label="Invoice prefix" value={form.invoicePrefix} onChange={(v) => set("invoicePrefix", v)} />
        <Field
          label="Purchase prefix"
          value={form.purchasePrefix}
          onChange={(v) => set("purchasePrefix", v)}
        />
        <Field
          label="Quotation prefix"
          value={form.quotationPrefix ?? "QUO"}
          onChange={(v) => set("quotationPrefix", v)}
        />
        <Field
          label="Expense prefix"
          value={form.expensePrefix ?? "EXP"}
          onChange={(v) => set("expensePrefix", v)}
        />
      </div>

      <div className="pt-2 border-t border-slate-100">
        <h3 className="font-semibold text-sm mb-3">Bank details (shown on invoices)</h3>
        <div className="grid md:grid-cols-2 gap-4">
          <Field label="Bank name" value={form.bankName ?? ""} onChange={(v) => set("bankName", v)} />
          <Field
            label="Account number"
            value={form.bankAccountNo ?? ""}
            onChange={(v) => set("bankAccountNo", v)}
          />
          <Field label="IFSC code" value={form.bankIfsc ?? ""} onChange={(v) => set("bankIfsc", v)} />
          <Field label="UPI ID" value={form.upiId ?? ""} onChange={(v) => set("upiId", v)} />
          <div className="md:col-span-2">
            <label className="label">Default terms & conditions</label>
            <textarea
              className="input"
              rows={2}
              value={form.terms ?? ""}
              onChange={(e) => set("terms", e.target.value)}
              placeholder="Goods once sold will not be taken back..."
            />
          </div>
        </div>
      </div>
      <div className="flex justify-end pt-2">
        <button disabled={loading} className="btn-primary">
          {loading ? "Saving..." : "Save changes"}
        </button>
      </div>
    </form>
  );
}

function Field({
  label,
  value,
  onChange,
  required,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  required?: boolean;
}) {
  return (
    <div>
      <label className="label">
        {label} {required && "*"}
      </label>
      <input
        required={required}
        className="input"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}
