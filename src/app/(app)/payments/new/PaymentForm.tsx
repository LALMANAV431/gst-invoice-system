"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { inputDate } from "@/lib/utils";

export default function PaymentForm({ parties }: { parties: any[] }) {
  const router = useRouter();
  const [form, setForm] = useState({
    type: "RECEIVED",
    partyId: parties[0]?.id ?? "",
    amount: 0,
    mode: "CASH",
    date: inputDate(new Date()),
    reference: "",
    notes: "",
  });
  const [loading, setLoading] = useState(false);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!form.partyId) return toast.error("Select a party");
    if (!form.amount || form.amount <= 0) return toast.error("Enter amount");
    setLoading(true);
    const res = await fetch("/api/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setLoading(false);
    if (res.ok) {
      toast.success("Payment recorded");
      router.push("/payments");
      router.refresh();
    } else {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error || "Failed");
    }
  }

  return (
    <form onSubmit={submit} className="card card-padding space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        <div>
          <label className="label">Type</label>
          <select
            className="input"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
          >
            <option value="RECEIVED">Received from customer</option>
            <option value="PAID">Paid to vendor</option>
          </select>
        </div>
        <div>
          <label className="label">Party</label>
          <select
            className="input"
            value={form.partyId}
            onChange={(e) => setForm({ ...form, partyId: e.target.value })}
          >
            {parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Date</label>
          <input
            type="date"
            className="input"
            value={form.date}
            onChange={(e) => setForm({ ...form, date: e.target.value })}
          />
        </div>
        <div>
          <label className="label">Mode</label>
          <select
            className="input"
            value={form.mode}
            onChange={(e) => setForm({ ...form, mode: e.target.value })}
          >
            <option value="CASH">Cash</option>
            <option value="BANK">Bank transfer</option>
            <option value="UPI">UPI</option>
            <option value="CHEQUE">Cheque</option>
            <option value="CARD">Card</option>
          </select>
        </div>
        <div>
          <label className="label">Amount</label>
          <input
            type="number"
            step="0.01"
            className="input"
            value={form.amount}
            onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })}
          />
        </div>
        <div>
          <label className="label">Reference</label>
          <input
            className="input"
            value={form.reference}
            onChange={(e) => setForm({ ...form, reference: e.target.value })}
            placeholder="Cheque no., UPI ref, etc."
          />
        </div>
        <div className="md:col-span-2">
          <label className="label">Notes</label>
          <textarea
            className="input"
            rows={2}
            value={form.notes}
            onChange={(e) => setForm({ ...form, notes: e.target.value })}
          />
        </div>
      </div>
      <div className="flex justify-end gap-2">
        <button type="button" className="btn-secondary" onClick={() => router.back()}>
          Cancel
        </button>
        <button disabled={loading} className="btn-primary">
          {loading ? "Saving..." : "Save"}
        </button>
      </div>
    </form>
  );
}
