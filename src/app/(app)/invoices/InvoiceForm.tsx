"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Plus, Trash2 } from "lucide-react";
import { calcLineGST, formatINR, inputDate } from "@/lib/utils";

type Party = {
  id: string;
  name: string;
  stateCode: string | null;
  gstin: string | null;
};
type Item = {
  id: string;
  name: string;
  hsn: string | null;
  unit: string;
  salePrice: number;
  purchasePrice: number;
  gstRate: number;
};

type Line = {
  itemId: string | null;
  itemName: string;
  hsn: string;
  quantity: number;
  unit: string;
  rate: number;
  discount: number;
  gstRate: number;
};

export type DocMode = "sales" | "purchase" | "quotation" | "credit" | "debit";

const newLine = (): Line => ({
  itemId: null,
  itemName: "",
  hsn: "",
  quantity: 1,
  unit: "NOS",
  rate: 0,
  discount: 0,
  gstRate: 18,
});

type ModeConfig = {
  endpoint: string;
  redirectBase: string;
  partyLabel: string;
  saveLabel: string;
  priceField: "salePrice" | "purchasePrice";
  showVendorBill: boolean;
  showValidUntil: boolean;
  showReason: boolean;
  extraBody?: Record<string, unknown>;
};

const CONFIG: Record<DocMode, ModeConfig> = {
  sales: {
    endpoint: "/api/invoices",
    redirectBase: "/invoices",
    partyLabel: "Customer",
    saveLabel: "Save Invoice",
    priceField: "salePrice",
    showVendorBill: false,
    showValidUntil: false,
    showReason: false,
  },
  purchase: {
    endpoint: "/api/purchases",
    redirectBase: "/purchases",
    partyLabel: "Vendor",
    saveLabel: "Save Purchase",
    priceField: "purchasePrice",
    showVendorBill: true,
    showValidUntil: false,
    showReason: false,
  },
  quotation: {
    endpoint: "/api/quotations",
    redirectBase: "/quotations",
    partyLabel: "Customer",
    saveLabel: "Save Quotation",
    priceField: "salePrice",
    showVendorBill: false,
    showValidUntil: true,
    showReason: false,
  },
  credit: {
    endpoint: "/api/credit-notes",
    redirectBase: "/credit-notes",
    partyLabel: "Customer",
    saveLabel: "Save Credit Note",
    priceField: "salePrice",
    showVendorBill: false,
    showValidUntil: false,
    showReason: true,
    extraBody: { kind: "CREDIT" },
  },
  debit: {
    endpoint: "/api/credit-notes",
    redirectBase: "/credit-notes",
    partyLabel: "Vendor",
    saveLabel: "Save Debit Note",
    priceField: "purchasePrice",
    showVendorBill: false,
    showValidUntil: false,
    showReason: true,
    extraBody: { kind: "DEBIT" },
  },
};

export default function InvoiceForm({
  parties,
  items,
  mode,
  companyStateCode,
}: {
  parties: Party[];
  items: Item[];
  mode: DocMode;
  companyStateCode?: string | null;
}) {
  const router = useRouter();
  const cfg = CONFIG[mode];
  const [partyId, setPartyId] = useState<string>(parties[0]?.id ?? "");
  const [date, setDate] = useState(inputDate(new Date()));
  const [dueDate, setDueDate] = useState("");
  const [validUntil, setValidUntil] = useState("");
  const [vendorBillNo, setVendorBillNo] = useState("");
  const [originalRef, setOriginalRef] = useState("");
  const [reason, setReason] = useState("");
  const [notes, setNotes] = useState("");
  const [discount, setDiscount] = useState(0);
  const [roundOff, setRoundOff] = useState(0);
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [loading, setLoading] = useState(false);

  const selectedParty = parties.find((p) => p.id === partyId) || null;
  const isInterState = !!(
    companyStateCode &&
    selectedParty?.stateCode &&
    companyStateCode !== selectedParty.stateCode
  );

  const totals = useMemo(() => {
    let subTotal = 0,
      cgst = 0,
      sgst = 0,
      igst = 0;
    for (const l of lines) {
      const r = calcLineGST({
        quantity: l.quantity,
        rate: l.rate,
        discount: l.discount,
        gstRate: l.gstRate,
        isInterState,
      });
      subTotal += r.taxableAmount;
      cgst += r.cgst;
      sgst += r.sgst;
      igst += r.igst;
    }
    const tax = +(cgst + sgst + igst).toFixed(2);
    const grand = +(subTotal + tax - (discount || 0) + (roundOff || 0)).toFixed(2);
    return {
      subTotal: +subTotal.toFixed(2),
      cgst: +cgst.toFixed(2),
      sgst: +sgst.toFixed(2),
      igst: +igst.toFixed(2),
      tax,
      grand,
    };
  }, [lines, discount, roundOff, isInterState]);

  function updateLine(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function selectItem(i: number, itemId: string) {
    if (!itemId) {
      updateLine(i, { itemId: null });
      return;
    }
    const it = items.find((x) => x.id === itemId);
    if (!it) return;
    updateLine(i, {
      itemId: it.id,
      itemName: it.name,
      hsn: it.hsn || "",
      unit: it.unit,
      rate: it[cfg.priceField],
      gstRate: it.gstRate,
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!partyId) return toast.error(`Select a ${cfg.partyLabel.toLowerCase()}`);
    const valid = lines.filter((l) => l.itemName && l.quantity > 0 && l.rate >= 0);
    if (valid.length === 0) return toast.error("Add at least one valid item");

    setLoading(true);
    const res = await fetch(cfg.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...(cfg.extraBody ?? {}),
        partyId,
        date,
        dueDate: dueDate || null,
        validUntil: validUntil || null,
        vendorBillNo: vendorBillNo || null,
        originalRef: originalRef || null,
        reason: reason || null,
        notes,
        discount,
        roundOff,
        items: valid,
      }),
    });
    setLoading(false);
    if (res.ok) {
      const data = await res.json();
      toast.success(`${cfg.saveLabel.replace("Save ", "")} created`);
      router.push(`${cfg.redirectBase}/${data.id}`);
      router.refresh();
    } else {
      const j = await res.json().catch(() => ({}));
      toast.error(j.error || "Failed");
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="card card-padding grid md:grid-cols-4 gap-4">
        <div className="md:col-span-2">
          <label className="label">{cfg.partyLabel} *</label>
          <select
            className="input"
            value={partyId}
            onChange={(e) => setPartyId(e.target.value)}
            required
          >
            <option value="">Select party</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.gstin ? `· ${p.gstin}` : ""}
              </option>
            ))}
          </select>
          {selectedParty && (
            <div className="mt-1 text-xs text-slate-500">
              {isInterState ? "Inter-state (IGST will apply)" : "Intra-state (CGST + SGST)"}
            </div>
          )}
        </div>
        <div>
          <label className="label">Date</label>
          <input
            type="date"
            className="input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>
        {cfg.showValidUntil ? (
          <div>
            <label className="label">Valid until</label>
            <input
              type="date"
              className="input"
              value={validUntil}
              onChange={(e) => setValidUntil(e.target.value)}
            />
          </div>
        ) : (
          <div>
            <label className="label">Due date</label>
            <input
              type="date"
              className="input"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
            />
          </div>
        )}
        {cfg.showVendorBill && (
          <div className="md:col-span-2">
            <label className="label">Vendor bill / invoice no.</label>
            <input
              className="input"
              value={vendorBillNo}
              onChange={(e) => setVendorBillNo(e.target.value)}
              placeholder="From your supplier"
            />
          </div>
        )}
        {cfg.showReason && (
          <>
            <div>
              <label className="label">Original invoice / bill no.</label>
              <input
                className="input"
                value={originalRef}
                onChange={(e) => setOriginalRef(e.target.value)}
                placeholder="Reference document"
              />
            </div>
            <div>
              <label className="label">Reason</label>
              <input
                className="input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Sales return / rate diff..."
              />
            </div>
          </>
        )}
      </div>

      <div className="card card-padding">
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-semibold">Items</h2>
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => setLines((ls) => [...ls, newLine()])}
          >
            <Plus className="h-4 w-4" /> Add row
          </button>
        </div>
        <div className="overflow-x-auto -mx-5">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: "26%" }}>Item</th>
                <th>HSN</th>
                <th className="text-right">Qty</th>
                <th>Unit</th>
                <th className="text-right">Rate</th>
                <th className="text-right">Disc</th>
                <th className="text-right">GST%</th>
                <th className="text-right">Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                const r = calcLineGST({
                  quantity: l.quantity,
                  rate: l.rate,
                  discount: l.discount,
                  gstRate: l.gstRate,
                  isInterState,
                });
                return (
                  <tr key={i}>
                    <td>
                      <select
                        className="input"
                        value={l.itemId ?? ""}
                        onChange={(e) => selectItem(i, e.target.value)}
                      >
                        <option value="">— select item —</option>
                        {items.map((it) => (
                          <option key={it.id} value={it.id}>
                            {it.name}
                          </option>
                        ))}
                      </select>
                      <input
                        className="input mt-1 text-xs"
                        placeholder="Or type item name"
                        value={l.itemName}
                        onChange={(e) => updateLine(i, { itemName: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        value={l.hsn}
                        onChange={(e) => updateLine(i, { hsn: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        className="input text-right"
                        value={l.quantity}
                        onChange={(e) =>
                          updateLine(i, { quantity: parseFloat(e.target.value) || 0 })
                        }
                      />
                    </td>
                    <td>
                      <input
                        className="input"
                        value={l.unit}
                        onChange={(e) => updateLine(i, { unit: e.target.value })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        className="input text-right"
                        value={l.rate}
                        onChange={(e) => updateLine(i, { rate: parseFloat(e.target.value) || 0 })}
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        className="input text-right"
                        value={l.discount}
                        onChange={(e) =>
                          updateLine(i, { discount: parseFloat(e.target.value) || 0 })
                        }
                      />
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        className="input text-right"
                        value={l.gstRate}
                        onChange={(e) =>
                          updateLine(i, { gstRate: parseFloat(e.target.value) || 0 })
                        }
                      />
                    </td>
                    <td className="text-right font-medium">{formatINR(r.total)}</td>
                    <td>
                      {lines.length > 1 && (
                        <button
                          type="button"
                          className="btn-ghost p-2 text-rose-600"
                          onClick={() => setLines((ls) => ls.filter((_, idx) => idx !== i))}
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid md:grid-cols-3 gap-4">
        <div className="md:col-span-2 card card-padding">
          <label className="label">Notes / Terms</label>
          <textarea
            className="input"
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Thank you for your business..."
          />
        </div>
        <div className="card card-padding">
          <Row label="Subtotal" value={formatINR(totals.subTotal)} />
          {isInterState ? (
            <Row label="IGST" value={formatINR(totals.igst)} />
          ) : (
            <>
              <Row label="CGST" value={formatINR(totals.cgst)} />
              <Row label="SGST" value={formatINR(totals.sgst)} />
            </>
          )}
          <div className="flex items-center justify-between text-sm py-1.5">
            <span className="text-slate-500">Discount</span>
            <input
              type="number"
              step="0.01"
              className="input w-28 text-right"
              value={discount}
              onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)}
            />
          </div>
          <div className="flex items-center justify-between text-sm py-1.5">
            <span className="text-slate-500">Round off</span>
            <input
              type="number"
              step="0.01"
              className="input w-28 text-right"
              value={roundOff}
              onChange={(e) => setRoundOff(parseFloat(e.target.value) || 0)}
            />
          </div>
          <div className="border-t border-slate-200 mt-2 pt-2 flex items-center justify-between">
            <span className="font-bold">Grand Total</span>
            <span className="font-bold text-lg">{formatINR(totals.grand)}</span>
          </div>
          <button disabled={loading} className="btn-primary w-full mt-4">
            {loading ? "Saving..." : cfg.saveLabel}
          </button>
        </div>
      </div>
    </form>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm py-1.5">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
