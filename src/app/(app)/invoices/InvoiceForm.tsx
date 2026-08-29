"use client";
import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Plus, Trash2 } from "lucide-react";
import { inputDate } from "@/lib/utils";
import { formatPaise, toRupees } from "@/lib/money";
import { computeGstInvoice, GST_RATES, SupplyType } from "@/lib/gst";

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
  salePricePaise: number;
  purchasePricePaise: number;
  gstRate: number;
  cessRate: number;
  supplyType: string;
  pricingMode: string;
};

/** Line as edited in the form. Rate and discount stay in RUPEES here, because
 *  that is what the user types; conversion to paise happens in the engine. */
type Line = {
  itemId: string | null;
  itemName: string;
  hsn: string;
  quantity: number;
  unit: string;
  rate: number;
  discount: number;
  gstRate: number;
  cessRate: number;
  supplyType: SupplyType;
  pricingMode: "EXCLUSIVE" | "INCLUSIVE";
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
  cessRate: 0,
  supplyType: "TAXABLE",
  pricingMode: "EXCLUSIVE",
});

const SUPPLY_TYPE_LABELS: Record<SupplyType, string> = {
  TAXABLE: "Taxable",
  EXEMPT: "Exempt",
  NIL_RATED: "Nil rated",
  NON_GST: "Non-GST",
  ZERO_RATED: "Zero rated (export/SEZ)",
};

type ModeConfig = {
  endpoint: string;
  redirectBase: string;
  partyLabel: string;
  saveLabel: string;
  priceField: "salePricePaise" | "purchasePricePaise";
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
    priceField: "salePricePaise",
    showVendorBill: false,
    showValidUntil: false,
    showReason: false,
  },
  purchase: {
    endpoint: "/api/purchases",
    redirectBase: "/purchases",
    partyLabel: "Vendor",
    saveLabel: "Save Purchase",
    priceField: "purchasePricePaise",
    showVendorBill: true,
    showValidUntil: false,
    showReason: false,
  },
  quotation: {
    endpoint: "/api/quotations",
    redirectBase: "/quotations",
    partyLabel: "Customer",
    saveLabel: "Save Quotation",
    priceField: "salePricePaise",
    showVendorBill: false,
    showValidUntil: true,
    showReason: false,
  },
  credit: {
    endpoint: "/api/credit-notes",
    redirectBase: "/credit-notes",
    partyLabel: "Customer",
    saveLabel: "Save Credit Note",
    priceField: "salePricePaise",
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
    priceField: "purchasePricePaise",
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
  const [additionalCharges, setAdditionalCharges] = useState(0);
  const [reverseCharge, setReverseCharge] = useState(false);
  const [tdsRate, setTdsRate] = useState(0);
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [loading, setLoading] = useState(false);

  const selectedParty = parties.find((p) => p.id === partyId) || null;

  /**
   * The live preview runs the SAME engine the server uses, so the total shown
   * here is the total that gets saved. Previously the form used a separate
   * `calcLineGST` helper and applied the invoice discount after tax, so the
   * preview and the stored invoice could disagree.
   */
  const gst = useMemo(() => {
    try {
      return computeGstInvoice({
        supplierStateCode: companyStateCode,
        placeOfSupplyStateCode: selectedParty?.stateCode,
        lines: lines.map((l) => ({
          quantity: l.quantity,
          rate: l.rate,
          discount: l.discount,
          gstRate: l.gstRate,
          cessRate: l.cessRate,
          supplyType: l.supplyType,
          pricingMode: l.pricingMode,
        })),
        invoiceDiscount: discount,
        additionalCharges,
        reverseCharge,
        tdsRate: mode === "sales" ? tdsRate : 0,
        roundToNearestRupee: true,
      });
    } catch {
      // An empty or half-typed row is not an error worth surfacing mid-edit.
      return null;
    }
  }, [
    lines,
    discount,
    additionalCharges,
    reverseCharge,
    tdsRate,
    mode,
    companyStateCode,
    selectedParty?.stateCode,
  ]);

  const isInterState = gst?.isInterState ?? false;

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
      // Stored in paise; the form edits rupees.
      rate: toRupees(it[cfg.priceField]),
      gstRate: it.gstRate,
      cessRate: it.cessRate ?? 0,
      supplyType: (it.supplyType as SupplyType) ?? "TAXABLE",
      pricingMode: it.pricingMode === "INCLUSIVE" ? "INCLUSIVE" : "EXCLUSIVE",
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
        additionalCharges,
        reverseCharge,
        tdsRate: mode === "sales" ? tdsRate : 0,
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
      if (j.upgrade) router.push("/billing");
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
        <div className="md:col-span-2 flex items-end">
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={reverseCharge}
              onChange={(e) => setReverseCharge(e.target.checked)}
            />
            <span>
              Reverse charge applies
              <span className="block text-xs text-slate-500">
                Tax is payable by the recipient; no GST is collected here.
              </span>
            </span>
          </label>
        </div>
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
                <th style={{ width: "22%" }}>Item</th>
                <th>HSN</th>
                <th className="text-right">Qty</th>
                <th>Unit</th>
                <th className="text-right">Rate</th>
                <th className="text-right">Disc</th>
                <th className="text-right">GST%</th>
                <th className="text-right">Cess%</th>
                <th>Supply</th>
                <th className="text-right">Total</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => {
                // Comes from the same engine result the totals use.
                const computed = gst?.lines[i];
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
                      <select
                        className="input mt-1 text-xs"
                        value={l.pricingMode}
                        onChange={(e) =>
                          updateLine(i, {
                            pricingMode: e.target.value as "EXCLUSIVE" | "INCLUSIVE",
                          })
                        }
                      >
                        <option value="EXCLUSIVE">+ GST</option>
                        <option value="INCLUSIVE">GST incl.</option>
                      </select>
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
                      <select
                        className="input text-right"
                        value={l.gstRate}
                        onChange={(e) =>
                          updateLine(i, { gstRate: parseFloat(e.target.value) || 0 })
                        }
                        disabled={l.supplyType !== "TAXABLE"}
                      >
                        {GST_RATES.map((r) => (
                          <option key={r} value={r}>
                            {r}%
                          </option>
                        ))}
                      </select>
                    </td>
                    <td>
                      <input
                        type="number"
                        step="0.01"
                        className="input text-right"
                        value={l.cessRate}
                        onChange={(e) =>
                          updateLine(i, { cessRate: parseFloat(e.target.value) || 0 })
                        }
                        disabled={l.supplyType !== "TAXABLE"}
                      />
                    </td>
                    <td>
                      <select
                        className="input text-xs"
                        value={l.supplyType}
                        onChange={(e) =>
                          updateLine(i, { supplyType: e.target.value as SupplyType })
                        }
                      >
                        {(Object.keys(SUPPLY_TYPE_LABELS) as SupplyType[]).map((t) => (
                          <option key={t} value={t}>
                            {SUPPLY_TYPE_LABELS[t]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="text-right font-medium">
                      {formatPaise(computed?.totalPaise ?? 0)}
                    </td>
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
          <Row label="Taxable value" value={formatPaise(gst?.taxablePaise ?? 0)} />
          {isInterState ? (
            <Row label="IGST" value={formatPaise(gst?.igstPaise ?? 0)} />
          ) : (
            <>
              <Row label="CGST" value={formatPaise(gst?.cgstPaise ?? 0)} />
              <Row label="SGST" value={formatPaise(gst?.sgstPaise ?? 0)} />
            </>
          )}
          {(gst?.cessPaise ?? 0) > 0 && (
            <Row label="Cess" value={formatPaise(gst?.cessPaise ?? 0)} />
          )}

          <div className="flex items-center justify-between text-sm py-1.5">
            <span className="text-slate-500">
              Discount
              <span className="block text-xs text-slate-400">Applied before tax</span>
            </span>
            <input
              type="number"
              step="0.01"
              className="input w-28 text-right"
              value={discount}
              onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)}
            />
          </div>
          <div className="flex items-center justify-between text-sm py-1.5">
            <span className="text-slate-500">Freight / packing</span>
            <input
              type="number"
              step="0.01"
              className="input w-28 text-right"
              value={additionalCharges}
              onChange={(e) => setAdditionalCharges(parseFloat(e.target.value) || 0)}
            />
          </div>

          {/* Round-off is computed, not typed: the server rounds the grand total
              to the nearest rupee and posts the difference to a Round Off ledger. */}
          {(gst?.roundOffPaise ?? 0) !== 0 && (
            <Row label="Round off" value={formatPaise(gst?.roundOffPaise ?? 0)} />
          )}

          <div className="border-t border-slate-200 mt-2 pt-2 flex items-center justify-between">
            <span className="font-bold">Grand Total</span>
            <span className="font-bold text-lg">{formatPaise(gst?.grandTotalPaise ?? 0)}</span>
          </div>

          {mode === "sales" && (
            <div className="flex items-center justify-between text-sm py-1.5">
              <span className="text-slate-500">TDS %</span>
              <select
                className="input w-28 text-right"
                value={tdsRate}
                onChange={(e) => setTdsRate(parseFloat(e.target.value) || 0)}
              >
                {[0, 0.1, 1, 2, 5, 10].map((r) => (
                  <option key={r} value={r}>
                    {r}%
                  </option>
                ))}
              </select>
            </div>
          )}
          {/* TDS does NOT reduce the invoice value - the customer withholds it
              when paying. Showing it separately keeps the invoice face value
              correct and matches what the customer's books will say. */}
          {mode === "sales" && (gst?.tdsPaise ?? 0) > 0 && (
            <div className="mt-1 rounded-md bg-slate-50 p-2 text-xs text-slate-600">
              <div className="flex justify-between">
                <span>TDS the customer will withhold</span>
                <span className="font-medium">{formatPaise(gst?.tdsPaise ?? 0)}</span>
              </div>
              <div className="flex justify-between">
                <span>Expected in bank</span>
                <span className="font-medium">
                  {formatPaise(gst?.expectedReceiptPaise ?? 0)}
                </span>
              </div>
            </div>
          )}

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
