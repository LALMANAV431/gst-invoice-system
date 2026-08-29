"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import dynamic from "next/dynamic";
import { ScanLine, Plus, Minus, Trash2, Search, ShoppingCart, X } from "lucide-react";
import { formatPaise, toRupees } from "@/lib/money";
import { computeGstInvoice, SupplyType } from "@/lib/gst";

const BarcodeScanner = dynamic(() => import("@/components/BarcodeScanner"), { ssr: false });

type Item = {
  id: string;
  name: string;
  sku: string | null;
  barcode: string | null;
  hsn: string | null;
  unit: string;
  salePricePaise: number;
  cessRate?: number;
  supplyType?: string;
  pricingMode?: string;
  gstRate: number;
  currentStock: number;
};
type Party = { id: string; name: string; stateCode: string | null };
type CartLine = { item: Item; qty: number };

export default function PosClient({
  items,
  parties,
  companyStateCode,
}: {
  items: Item[];
  parties: Party[];
  companyStateCode: string | null;
}) {
  const router = useRouter();
  const [cart, setCart] = useState<CartLine[]>([]);
  const [search, setSearch] = useState("");
  const [partyId, setPartyId] = useState(parties[0]?.id ?? "");
  const [scanning, setScanning] = useState(false);
  const [saving, setSaving] = useState(false);

  const selectedParty = parties.find((p) => p.id === partyId) || null;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return items.slice(0, 24);
    return items
      .filter(
        (i) =>
          i.name.toLowerCase().includes(q) ||
          (i.sku || "").toLowerCase().includes(q) ||
          (i.barcode || "").toLowerCase().includes(q)
      )
      .slice(0, 24);
  }, [items, search]);

  function addItem(item: Item) {
    setCart((c) => {
      const idx = c.findIndex((l) => l.item.id === item.id);
      if (idx >= 0) {
        const copy = [...c];
        copy[idx] = { ...copy[idx], qty: copy[idx].qty + 1 };
        return copy;
      }
      return [...c, { item, qty: 1 }];
    });
  }

  function handleScan(code: string) {
    const found = items.find(
      (i) => i.barcode === code || i.sku === code || i.id === code
    );
    if (found) {
      addItem(found);
      toast.success(`Added ${found.name}`);
    } else {
      toast.error(`No item with barcode ${code}`);
    }
  }

  function setQty(id: string, qty: number) {
    setCart((c) =>
      qty <= 0
        ? c.filter((l) => l.item.id !== id)
        : c.map((l) => (l.item.id === id ? { ...l, qty } : l))
    );
  }

  const totals = useMemo(() => {
    if (cart.length === 0) return { sub: 0, tax: 0, grand: 0, roundOff: 0 };
    const gst = computeGstInvoice({
      // Pass the real state codes so the engine decides intra vs inter-state
      // itself, exactly as the server will. When a walk-in customer has no
      // recorded state the engine falls back to intra-state, which is the
      // right default for a counter sale.
      supplierStateCode: companyStateCode,
      placeOfSupplyStateCode: selectedParty?.stateCode ?? companyStateCode,
      lines: cart.map((l) => ({
        quantity: l.qty,
        // Item prices are stored in paise; the engine takes rupees.
        rate: toRupees(l.item.salePricePaise),
        gstRate: l.item.gstRate,
        cessRate: l.item.cessRate ?? 0,
        supplyType: (l.item.supplyType as SupplyType) ?? "TAXABLE",
        // Retail counters price at MRP, which already includes GST.
        pricingMode: l.item.pricingMode === "INCLUSIVE" ? "INCLUSIVE" : "EXCLUSIVE",
      })),
      roundToNearestRupee: true,
    });
    return {
      sub: gst.taxablePaise,
      tax: gst.taxPaise,
      grand: gst.grandTotalPaise,
      roundOff: gst.roundOffPaise,
    };
  }, [cart, companyStateCode, selectedParty?.stateCode]);

  async function checkout() {
    if (!partyId) return toast.error("Select a customer");
    if (cart.length === 0) return toast.error("Cart is empty");
    setSaving(true);
    const res = await fetch("/api/invoices", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        partyId,
        items: cart.map((l) => ({
          itemId: l.item.id,
          itemName: l.item.name,
          hsn: l.item.hsn,
          quantity: l.qty,
          unit: l.item.unit,
          rate: toRupees(l.item.salePricePaise),
          discount: 0,
          gstRate: l.item.gstRate,
          cessRate: l.item.cessRate ?? 0,
          supplyType: l.item.supplyType ?? "TAXABLE",
          pricingMode: l.item.pricingMode ?? "EXCLUSIVE",
        })),
      }),
    });
    setSaving(false);
    if (res.ok) {
      const data = await res.json();
      toast.success("Sale completed!");
      router.push(`/invoices/${data.id}`);
      router.refresh();
    } else {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error || "Failed");
      if (j.upgrade) router.push("/billing");
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ShoppingCart className="h-6 w-6 text-brand-600" /> POS — Quick Billing
          </h1>
          <p className="text-sm text-slate-500">Scan barcodes and bill in seconds</p>
        </div>
        <button className="btn-primary" onClick={() => setScanning(true)}>
          <ScanLine className="h-4 w-4" /> Scan Barcode
        </button>
      </div>

      <div className="grid lg:grid-cols-5 gap-4">
        {/* Product grid */}
        <div className="lg:col-span-3 card card-padding">
          <div className="relative mb-3">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-slate-400" />
            <input
              className="input pl-9"
              placeholder="Search by name, SKU or barcode..."
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
          {filtered.length === 0 ? (
            <p className="text-center text-slate-500 py-10 text-sm">No items found.</p>
          ) : (
            <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 max-h-[60vh] overflow-y-auto">
              {filtered.map((it) => (
                <button
                  key={it.id}
                  onClick={() => addItem(it)}
                  className="text-left rounded-xl border border-slate-200 dark:border-slate-700 p-3 hover:border-brand-400 hover:shadow-md transition active:scale-95"
                >
                  <div className="font-medium text-sm line-clamp-2">{it.name}</div>
                  <div className="text-xs text-slate-400 mt-0.5">
                    {it.currentStock} {it.unit} in stock
                  </div>
                  <div className="mt-1 font-bold text-brand-600">{formatPaise(it.salePricePaise)}</div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Cart */}
        <div className="lg:col-span-2 card card-padding flex flex-col">
          <div className="mb-3">
            <label className="label">Customer</label>
            <select className="input" value={partyId} onChange={(e) => setPartyId(e.target.value)}>
              {parties.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </div>

          <div className="flex-1 overflow-y-auto -mx-1 px-1 min-h-[120px]">
            {cart.length === 0 ? (
              <div className="text-center text-slate-400 py-10 text-sm">
                <ShoppingCart className="h-8 w-8 mx-auto mb-2 opacity-40" />
                Cart is empty. Scan or tap a product.
              </div>
            ) : (
              <ul className="space-y-2">
                {cart.map((l) => (
                  <li
                    key={l.item.id}
                    className="flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-2"
                  >
                    <div className="flex-1 min-w-0">
                      <div className="text-sm font-medium truncate">{l.item.name}</div>
                      <div className="text-xs text-slate-400">{formatPaise(l.item.salePricePaise)} each</div>
                    </div>
                    <div className="flex items-center gap-1">
                      <button className="btn-ghost p-1" onClick={() => setQty(l.item.id, l.qty - 1)}>
                        <Minus className="h-3.5 w-3.5" />
                      </button>
                      <input
                        className="input !w-12 !px-1 text-center !py-1"
                        value={l.qty}
                        onChange={(e) => setQty(l.item.id, parseInt(e.target.value) || 0)}
                      />
                      <button className="btn-ghost p-1" onClick={() => setQty(l.item.id, l.qty + 1)}>
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="w-20 text-right text-sm font-semibold">
                      {formatPaise(Math.round(l.item.salePricePaise * l.qty))}
                    </div>
                    <button className="btn-ghost p-1 text-rose-600" onClick={() => setQty(l.item.id, 0)}>
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t border-slate-200 dark:border-slate-800 pt-3 mt-3 space-y-1 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Subtotal</span>
              <span>{formatPaise(totals.sub)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">GST</span>
              <span>{formatPaise(totals.tax)}</span>
            </div>
            <div className="flex justify-between font-bold text-lg">
              <span>Total</span>
              <span>{formatPaise(totals.grand)}</span>
            </div>
            <div className="flex gap-2 pt-2">
              {cart.length > 0 && (
                <button className="btn-secondary" onClick={() => setCart([])}>
                  <X className="h-4 w-4" /> Clear
                </button>
              )}
              <button disabled={saving || cart.length === 0} className="btn-primary flex-1" onClick={checkout}>
                {saving ? "Saving..." : `Complete Sale · ${formatPaise(totals.grand)}`}
              </button>
            </div>
          </div>
        </div>
      </div>

      {scanning && (
        <BarcodeScanner
          onScan={(code) => handleScan(code)}
          onClose={() => setScanning(false)}
        />
      )}
    </div>
  );
}
