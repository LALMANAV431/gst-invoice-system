"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

type PartyInput = {
  id?: string;
  name?: string;
  type?: string;
  gstin?: string | null;
  email?: string | null;
  phone?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  city?: string | null;
  state?: string | null;
  stateCode?: string | null;
  pincode?: string | null;
  openingBalancePaise?: number;
  balanceType?: string;
};

export default function PartyForm({ initial }: { initial?: PartyInput }) {
  const router = useRouter();
  const [form, setForm] = useState<PartyInput>(
    initial ?? {
      name: "",
      type: "CUSTOMER",
      balanceType: "RECEIVABLE",
      openingBalancePaise: 0,
    }
  );
  const [loading, setLoading] = useState(false);

  function set<K extends keyof PartyInput>(k: K, v: PartyInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const url = initial?.id ? `/api/parties/${initial.id}` : "/api/parties";
    const method = initial?.id ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setLoading(false);
    if (res.ok) {
      toast.success(initial?.id ? "Updated" : "Created");
      router.push("/parties");
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
          <label className="label">Name *</label>
          <input
            required
            className="input"
            value={form.name ?? ""}
            onChange={(e) => set("name", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Type</label>
          <select
            className="input"
            value={form.type ?? "CUSTOMER"}
            onChange={(e) => set("type", e.target.value)}
          >
            <option value="CUSTOMER">Customer</option>
            <option value="VENDOR">Vendor</option>
            <option value="BOTH">Both</option>
          </select>
        </div>
        <div>
          <label className="label">GSTIN</label>
          <input
            className="input"
            maxLength={15}
            value={form.gstin ?? ""}
            onChange={(e) => set("gstin", e.target.value.toUpperCase())}
          />
        </div>
        <div>
          <label className="label">Phone</label>
          <input
            className="input"
            value={form.phone ?? ""}
            onChange={(e) => set("phone", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Email</label>
          <input
            type="email"
            className="input"
            value={form.email ?? ""}
            onChange={(e) => set("email", e.target.value)}
          />
        </div>
        <div>
          <label className="label">State</label>
          <input
            className="input"
            value={form.state ?? ""}
            onChange={(e) => set("state", e.target.value)}
          />
        </div>
        <div>
          <label className="label">State code</label>
          <input
            className="input"
            maxLength={2}
            value={form.stateCode ?? ""}
            onChange={(e) => set("stateCode", e.target.value)}
          />
        </div>
        <div>
          <label className="label">City</label>
          <input
            className="input"
            value={form.city ?? ""}
            onChange={(e) => set("city", e.target.value)}
          />
        </div>
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
        <div>
          <label className="label">Pincode</label>
          <input
            className="input"
            value={form.pincode ?? ""}
            onChange={(e) => set("pincode", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Opening balance</label>
          <input
            type="number"
            step="0.01"
            className="input"
            value={form.openingBalancePaise ?? 0}
            onChange={(e) => set("openingBalancePaise", parseFloat(e.target.value) || 0)}
          />
        </div>
        <div>
          <label className="label">Balance type</label>
          <select
            className="input"
            value={form.balanceType ?? "RECEIVABLE"}
            onChange={(e) => set("balanceType", e.target.value)}
          >
            <option value="RECEIVABLE">To Collect (Receivable)</option>
            <option value="PAYABLE">To Pay (Payable)</option>
          </select>
        </div>
      </div>
      <div className="flex justify-end gap-2 pt-2">
        <button type="button" onClick={() => router.back()} className="btn-secondary">
          Cancel
        </button>
        <button disabled={loading} className="btn-primary">
          {loading ? "Saving..." : "Save"}
        </button>
      </div>
    </form>
  );
}
