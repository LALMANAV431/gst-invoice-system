"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Plus, Trash2 } from "lucide-react";
import { formatPaise, toRupees } from "@/lib/money";
import { computeGstInvoice, GST_RATES, type SupplyType } from "@/lib/gst";
import { inputDate } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

type Party = { id: string; name: string; stateCode: string | null; gstin: string | null };
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
type SourceOption = { id: string; number: string; partyId: string; partyName: string };

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
};

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
});

const MOVEMENT_REASONS = [
  { value: "JOB_WORK", label: "Job work" },
  { value: "APPROVAL", label: "Sent on approval" },
  { value: "BRANCH_TRANSFER", label: "Branch transfer" },
  { value: "REPLACEMENT", label: "Replacement" },
  { value: "OTHER", label: "Other" },
];

/**
 * Create a sales order, delivery challan, purchase order or GRN.
 *
 * Uses the same GST engine as the server, so the totals shown are the totals
 * stored — and so an order converts to an invoice without the figures moving.
 */
export default function OrderForm({
  docType,
  parties,
  items,
  godowns,
  sourceOptions,
  companyStateCode,
  preselectedSourceId,
}: {
  docType: "SALES_ORDER" | "DELIVERY_CHALLAN" | "PURCHASE_ORDER" | "GRN";
  parties: Party[];
  items: Item[];
  godowns: { id: string; name: string }[];
  sourceOptions: SourceOption[];
  companyStateCode: string | null;
  preselectedSourceId: string | null;
}) {
  const router = useRouter();
  const { t } = useT();

  const isPurchaseSide = docType === "PURCHASE_ORDER" || docType === "GRN";
  const needsTransport = docType === "DELIVERY_CHALLAN";
  const movesStock = docType === "DELIVERY_CHALLAN" || docType === "GRN";
  const priceField = isPurchaseSide ? "purchasePricePaise" : "salePricePaise";

  const [sourceDocumentId, setSourceDocumentId] = useState(preselectedSourceId ?? "");
  const [partyId, setPartyId] = useState(parties[0]?.id ?? "");
  const [date, setDate] = useState(inputDate(new Date()));
  const [expectedDate, setExpectedDate] = useState("");
  const [externalRef, setExternalRef] = useState("");
  const [transporterName, setTransporterName] = useState("");
  const [vehicleNumber, setVehicleNumber] = useState("");
  const [movementReason, setMovementReason] = useState("JOB_WORK");
  const [godownId, setGodownId] = useState("");
  const [notes, setNotes] = useState("");
  const [discount, setDiscount] = useState(0);
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [saving, setSaving] = useState(false);

  // Selecting a source order fixes the party: a challan must go to the customer
  // who placed the order.
  useEffect(() => {
    if (!sourceDocumentId) return;
    const source = sourceOptions.find((s) => s.id === sourceDocumentId);
    if (source) setPartyId(source.partyId);
  }, [sourceDocumentId, sourceOptions]);

  // Pull the source order's lines in, so a challan does not have to be retyped.
  useEffect(() => {
    if (!sourceDocumentId) return;
    let cancelled = false;

    (async () => {
      try {
        const res = await fetch(`/api/orders/${sourceDocumentId}`);
        if (!res.ok) return;
        const doc = await res.json();
        if (cancelled || !Array.isArray(doc.items)) return;

        const pending = doc.items
          // Only what is still outstanding, so a part-delivered order does not
          // re-despatch what already went.
          .map((it: Record<string, number | string | null>) => ({
            ...it,
            remaining: Number(it.quantity) - Number(it.fulfilledQuantity ?? 0),
          }))
          .filter((it: { remaining: number }) => it.remaining > 0);

        if (pending.length === 0) {
          toast("That order is already fully fulfilled", { icon: "ℹ️" });
          return;
        }

        setLines(
          pending.map((it: Record<string, never>) => ({
            itemId: (it.itemId as unknown as string) ?? null,
            itemName: it.itemName as unknown as string,
            hsn: (it.hsn as unknown as string) ?? "",
            quantity: it.remaining as unknown as number,
            unit: (it.unit as unknown as string) ?? "NOS",
            rate: toRupees(it.ratePaise as unknown as number),
            discount: 0,
            gstRate: it.gstRate as unknown as number,
            cessRate: (it.cessRate as unknown as number) ?? 0,
            supplyType: ((it.supplyType as unknown as string) ?? "TAXABLE") as SupplyType,
          }))
        );
      } catch {
        // A failed prefill is not fatal — the user can still enter lines.
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [sourceDocumentId]);

  const selectedParty = parties.find((p) => p.id === partyId) ?? null;

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
        })),
        invoiceDiscount: discount,
        roundToNearestRupee: true,
      });
    } catch {
      return null;
    }
  }, [lines, discount, companyStateCode, selectedParty?.stateCode]);

  function update(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  function selectItem(i: number, itemId: string) {
    if (!itemId) return update(i, { itemId: null });
    const it = items.find((x) => x.id === itemId);
    if (!it) return;
    update(i, {
      itemId: it.id,
      itemName: it.name,
      hsn: it.hsn ?? "",
      unit: it.unit,
      rate: toRupees(it[priceField]),
      gstRate: it.gstRate,
      cessRate: it.cessRate ?? 0,
      supplyType: (it.supplyType as SupplyType) ?? "TAXABLE",
    });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!partyId) return toast.error("Select a party");

    const valid = lines.filter((l) => l.itemName && l.quantity > 0);
    if (valid.length === 0) return toast.error("Add at least one item");

    if (needsTransport && !vehicleNumber.trim() && !transporterName.trim()) {
      return toast.error(
        "A delivery challan moves goods without an invoice, so GST needs a vehicle number or transporter."
      );
    }

    setSaving(true);
    try {
      const res = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          docType,
          partyId,
          date,
          expectedDate: expectedDate || null,
          notes: notes || null,
          externalRef: externalRef || null,
          transporterName: needsTransport ? transporterName || null : null,
          vehicleNumber: needsTransport ? vehicleNumber || null : null,
          movementReason: needsTransport ? movementReason : null,
          godownId: godownId || null,
          sourceDocumentId: sourceDocumentId || null,
          discount,
          items: valid,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t("state.error"));
        return;
      }
      toast.success(`${data.label ?? "Document"} ${data.number} created`);
      router.push(`/orders?docType=${docType}`);
      router.refresh();
    } catch {
      toast.error(t("state.error"));
    } finally {
      setSaving(false);
    }
  }

  return (
    <form onSubmit={submit} className="space-y-4">
      <div className="card card-padding grid gap-4 md:grid-cols-4">
        {sourceOptions.length > 0 && (
          <div className="md:col-span-2">
            <label className="label">
              Raise from {docType === "GRN" ? "purchase order" : "sales order"}
            </label>
            <select
              className="input"
              value={sourceDocumentId}
              onChange={(e) => setSourceDocumentId(e.target.value)}
            >
              <option value="">— none, enter manually —</option>
              {sourceOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.number} · {s.partyName}
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-slate-500">
              Pulls in the outstanding quantities and records fulfilment against the order.
            </p>
          </div>
        )}

        <div className={sourceOptions.length > 0 ? "md:col-span-2" : "md:col-span-2"}>
          <label className="label">
            {isPurchaseSide ? t("label.supplier") : t("label.customer")} *
          </label>
          <select
            className="input"
            value={partyId}
            onChange={(e) => setPartyId(e.target.value)}
            required
            disabled={!!sourceDocumentId}
          >
            <option value="">Select party</option>
            {parties.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} {p.gstin ? `· ${p.gstin}` : ""}
              </option>
            ))}
          </select>
          {gst && (
            <div className="mt-1 text-xs text-slate-500">
              {gst.isInterState ? t("tax.interState") : t("tax.intraState")}
            </div>
          )}
        </div>

        <div>
          <label className="label">{t("label.date")}</label>
          <input
            type="date"
            className="input"
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </div>

        {!movesStock && (
          <div>
            <label className="label">Expected date</label>
            <input
              type="date"
              className="input"
              value={expectedDate}
              onChange={(e) => setExpectedDate(e.target.value)}
            />
          </div>
        )}

        <div>
          <label className="label">
            {docType === "SALES_ORDER"
              ? "Buyer's order no."
              : docType === "GRN"
                ? "Supplier's challan no."
                : "Reference"}
          </label>
          <input
            className="input"
            value={externalRef}
            onChange={(e) => setExternalRef(e.target.value)}
            placeholder={t("label.optional")}
          />
        </div>

        {godowns.length > 0 && movesStock && (
          <div>
            <label className="label">Godown</label>
            <select className="input" value={godownId} onChange={(e) => setGodownId(e.target.value)}>
              <option value="">Default</option>
              {godowns.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.name}
                </option>
              ))}
            </select>
          </div>
        )}

        {needsTransport && (
          <>
            <div>
              <label className="label">Vehicle number</label>
              <input
                className="input"
                value={vehicleNumber}
                onChange={(e) => setVehicleNumber(e.target.value.toUpperCase())}
                placeholder="MH 12 AB 1234"
                maxLength={30}
              />
            </div>
            <div>
              <label className="label">Transporter</label>
              <input
                className="input"
                value={transporterName}
                onChange={(e) => setTransporterName(e.target.value)}
                placeholder={t("label.optional")}
              />
            </div>
            <div>
              <label className="label">Reason for movement</label>
              <select
                className="input"
                value={movementReason}
                onChange={(e) => setMovementReason(e.target.value)}
              >
                {MOVEMENT_REASONS.map((r) => (
                  <option key={r.value} value={r.value}>
                    {r.label}
                  </option>
                ))}
              </select>
            </div>
          </>
        )}
      </div>

      <div className="card card-padding">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">{t("doc.items")}</h2>
          <button
            type="button"
            className="btn-secondary text-sm"
            onClick={() => setLines((ls) => [...ls, newLine()])}
          >
            <Plus className="h-4 w-4" /> {t("action.addRow")}
          </button>
        </div>

        <div className="-mx-5 overflow-x-auto">
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: "26%" }}>{t("label.item")}</th>
                <th>{t("tax.hsn")}</th>
                <th className="text-right">{t("label.quantity")}</th>
                <th>{t("label.unit")}</th>
                <th className="text-right">{t("label.rate")}</th>
                <th className="text-right">{t("tax.gstRate")}</th>
                <th className="text-right">{t("label.total")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
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
                      onChange={(e) => update(i, { itemName: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      className="input"
                      value={l.hsn}
                      onChange={(e) => update(i, { hsn: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      className="input text-right"
                      value={l.quantity}
                      onChange={(e) => update(i, { quantity: parseFloat(e.target.value) || 0 })}
                    />
                  </td>
                  <td>
                    <input
                      className="input"
                      value={l.unit}
                      onChange={(e) => update(i, { unit: e.target.value })}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      className="input text-right"
                      value={l.rate}
                      onChange={(e) => update(i, { rate: parseFloat(e.target.value) || 0 })}
                    />
                  </td>
                  <td>
                    <select
                      className="input text-right"
                      value={l.gstRate}
                      onChange={(e) => update(i, { gstRate: parseFloat(e.target.value) || 0 })}
                      disabled={l.supplyType !== "TAXABLE"}
                    >
                      {GST_RATES.map((r) => (
                        <option key={r} value={r}>
                          {r}%
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="text-right font-medium">
                    {formatPaise(gst?.lines[i]?.totalPaise ?? 0)}
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
              ))}
            </tbody>
          </table>
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="card card-padding md:col-span-2">
          <label className="label">{t("label.notes")}</label>
          <textarea
            className="input"
            rows={4}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
          />
        </div>
        <div className="card card-padding">
          <div className="flex items-center justify-between py-1.5 text-sm">
            <span className="text-slate-500">{t("tax.taxableValue")}</span>
            <span className="font-medium">{formatPaise(gst?.taxablePaise ?? 0)}</span>
          </div>
          <div className="flex items-center justify-between py-1.5 text-sm">
            <span className="text-slate-500">
              {gst?.isInterState ? t("tax.igst") : `${t("tax.cgst")} + ${t("tax.sgst")}`}
            </span>
            <span className="font-medium">{formatPaise(gst?.taxPaise ?? 0)}</span>
          </div>
          <div className="flex items-center justify-between py-1.5 text-sm">
            <span className="text-slate-500">
              {t("label.discount")}
              <span className="block text-xs text-slate-400">{t("tax.discountBeforeTax")}</span>
            </span>
            <input
              type="number"
              step="0.01"
              className="input w-28 text-right"
              value={discount}
              onChange={(e) => setDiscount(parseFloat(e.target.value) || 0)}
            />
          </div>
          <div className="mt-2 flex items-center justify-between border-t border-slate-200 pt-2">
            <span className="font-bold">{t("tax.grandTotal")}</span>
            <span className="text-lg font-bold">{formatPaise(gst?.grandTotalPaise ?? 0)}</span>
          </div>
          <button disabled={saving} className="btn-primary mt-4 w-full">
            {saving ? t("action.saving") : t("action.save")}
          </button>
        </div>
      </div>
    </form>
  );
}
