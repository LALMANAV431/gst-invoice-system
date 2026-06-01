"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";

type ItemInput = {
  id?: string;
  name?: string;
  sku?: string | null;
  hsn?: string | null;
  unit?: string;
  salePrice?: number;
  purchasePrice?: number;
  gstRate?: number;
  openingStock?: number;
  lowStockAlert?: number;
  description?: string | null;
};

const UNITS = ["NOS", "PCS", "KG", "GM", "LTR", "ML", "MTR", "FT", "BOX", "PKT", "BAG", "DZN"];

export default function ItemForm({ initial }: { initial?: ItemInput }) {
  const router = useRouter();
  const [form, setForm] = useState<ItemInput>(
    initial ?? {
      name: "",
      unit: "NOS",
      salePrice: 0,
      purchasePrice: 0,
      gstRate: 18,
      openingStock: 0,
      lowStockAlert: 0,
    }
  );
  const [loading, setLoading] = useState(false);

  function set<K extends keyof ItemInput>(k: K, v: ItemInput[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    const url = initial?.id ? `/api/items/${initial.id}` : "/api/items";
    const method = initial?.id ? "PUT" : "POST";
    const res = await fetch(url, {
      method,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(form),
    });
    setLoading(false);
    if (res.ok) {
      toast.success(initial?.id ? "Updated" : "Created");
      router.push("/items");
      router.refresh();
    } else {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error || "Failed");
    }
  }

  return (
    <form onSubmit={submit} className="card card-padding space-y-4">
      <div className="grid md:grid-cols-2 gap-4">
        <div className="md:col-span-2">
          <label className="label">Item name *</label>
          <input
            required
            className="input"
            value={form.name ?? ""}
            onChange={(e) => set("name", e.target.value)}
          />
        </div>
        <div>
          <label className="label">SKU / Code</label>
          <input
            className="input"
            value={form.sku ?? ""}
            onChange={(e) => set("sku", e.target.value)}
          />
        </div>
        <div>
          <label className="label">HSN code</label>
          <input
            className="input"
            value={form.hsn ?? ""}
            onChange={(e) => set("hsn", e.target.value)}
          />
        </div>
        <div>
          <label className="label">Unit</label>
          <select
            className="input"
            value={form.unit ?? "NOS"}
            onChange={(e) => set("unit", e.target.value)}
          >
            {UNITS.map((u) => (
              <option key={u} value={u}>
                {u}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">GST rate (%)</label>
          <select
            className="input"
            value={form.gstRate ?? 18}
            onChange={(e) => set("gstRate", parseFloat(e.target.value))}
          >
            {[0, 0.1, 0.25, 1, 1.5, 3, 5, 12, 18, 28].map((g) => (
              <option key={g} value={g}>
                {g}%
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="label">Sale price (₹)</label>
          <input
            type="number"
            step="0.01"
            className="input"
            value={form.salePrice ?? 0}
            onChange={(e) => set("salePrice", parseFloat(e.target.value) || 0)}
          />
        </div>
        <div>
          <label className="label">Purchase price (₹)</label>
          <input
            type="number"
            step="0.01"
            className="input"
            value={form.purchasePrice ?? 0}
            onChange={(e) => set("purchasePrice", parseFloat(e.target.value) || 0)}
          />
        </div>
        <div>
          <label className="label">Opening stock</label>
          <input
            type="number"
            step="0.01"
            className="input"
            value={form.openingStock ?? 0}
            onChange={(e) => set("openingStock", parseFloat(e.target.value) || 0)}
          />
        </div>
        <div>
          <label className="label">Low stock alert</label>
          <input
            type="number"
            step="0.01"
            className="input"
            value={form.lowStockAlert ?? 0}
            onChange={(e) => set("lowStockAlert", parseFloat(e.target.value) || 0)}
          />
        </div>
        <div className="md:col-span-2">
          <label className="label">Description</label>
          <textarea
            className="input"
            rows={2}
            value={form.description ?? ""}
            onChange={(e) => set("description", e.target.value)}
          />
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
