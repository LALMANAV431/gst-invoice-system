"use client";
import { Trash2, IndianRupee } from "lucide-react";
import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

export default function PurchaseActions({ purchase }: { purchase: any }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState(purchase.grandTotalPaise - purchase.amountPaidPaise);
  const [mode, setMode] = useState("CASH");

  async function onDelete() {
    if (!confirm("Delete this purchase? Stock will be reversed.")) return;
    const res = await fetch(`/api/purchases/${purchase.id}`, { method: "DELETE" });
    if (res.ok) {
      toast.success("Deleted");
      router.push("/purchases");
      router.refresh();
    } else toast.error("Failed");
  }

  async function onPay(e: React.FormEvent) {
    e.preventDefault();
    const res = await fetch("/api/payments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partyId: purchase.partyId,
        purchaseId: purchase.id,
        type: "PAID",
        mode,
        amount,
        date: new Date().toISOString(),
      }),
    });
    if (res.ok) {
      toast.success("Payment recorded");
      setOpen(false);
      router.refresh();
    } else toast.error("Failed");
  }

  return (
    <div className="flex gap-2 items-start">
      {purchase.status !== "PAID" && (
        <button className="btn-primary" onClick={() => setOpen((s) => !s)}>
          <IndianRupee className="h-4 w-4" /> Pay vendor
        </button>
      )}
      <button className="btn-ghost text-rose-600" onClick={onDelete}>
        <Trash2 className="h-4 w-4" />
      </button>

      {open && (
        <form
          onSubmit={onPay}
          className="absolute right-6 mt-12 z-10 card card-padding shadow-lg w-72"
        >
          <h3 className="font-semibold mb-2">Pay vendor</h3>
          <label className="label">Amount</label>
          <input
            type="number"
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
          </select>
          <div className="flex gap-2">
            <button type="button" className="btn-secondary flex-1" onClick={() => setOpen(false)}>
              Cancel
            </button>
            <button className="btn-primary flex-1">Save</button>
          </div>
        </form>
      )}
    </div>
  );
}
