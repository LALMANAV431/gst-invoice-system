"use client";
import { useEffect, useMemo, useState } from "react";
import toast from "react-hot-toast";
import { Plus, SlidersHorizontal, Trash2 } from "lucide-react";
import { formatPaise } from "@/lib/money";
import { formatDate, formatNumber } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

type Reason = { code: string; label: string; direction: "IN" | "OUT" };
type Item = { id: string; name: string; unit: string; purchasePricePaise: number };
type Line = { itemId: string; quantity: string; rate: string; notes: string };

const EMPTY_LINE: Line = { itemId: "", quantity: "", rate: "", notes: "" };

export default function StockAdjustmentsPage() {
  const { t } = useT();
  const [rows, setRows] = useState<any[]>([]);
  const [reasons, setReasons] = useState<Reason[]>([]);
  const [items, setItems] = useState<Item[]>([]);
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  const [reason, setReason] = useState("DAMAGE");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [notes, setNotes] = useState("");
  const [lines, setLines] = useState<Line[]>([{ ...EMPTY_LINE }]);

  async function load() {
    const res = await fetch("/api/stock-adjustments");
    const json = await res.json();
    setRows(json.data ?? []);
    setReasons(json.reasons ?? []);
  }

  useEffect(() => {
    load();
    fetch("/api/items")
      .then((r) => r.json())
      .then((d) => setItems(Array.isArray(d) ? d : []));
  }, []);

  const selectedReason = useMemo(
    () => reasons.find((r) => r.code === reason),
    [reasons, reason]
  );

  function setLine(index: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, i) => (i === index ? { ...l, ...patch } : l)));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const payload = lines
      .filter((l) => l.itemId && parseFloat(l.quantity) > 0)
      .map((l) => ({
        itemId: l.itemId,
        quantity: parseFloat(l.quantity),
        // Blank rate means "use the item's cost", decided on the server.
        ...(l.rate.trim() ? { rate: l.rate } : {}),
        ...(l.notes.trim() ? { notes: l.notes } : {}),
      }));
    if (payload.length === 0) {
      toast.error("Add at least one item with a quantity");
      return;
    }

    setSaving(true);
    const res = await fetch("/api/stock-adjustments", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ reason, date, notes: notes || undefined, lines: payload }),
    });
    setSaving(false);

    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Could not save the adjustment");
      return;
    }
    const created = await res.json();
    toast.success(`Saved ${created.number}`);
    setOpen(false);
    setLines([{ ...EMPTY_LINE }]);
    setNotes("");
    load();
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <SlidersHorizontal className="h-6 w-6 text-brand-600" /> {t("adj.title")}
          </h1>
          <p className="text-sm text-slate-500">{t("adj.subtitle")}</p>
        </div>
        <button className="btn-primary" onClick={() => setOpen((o) => !o)}>
          <Plus className="h-4 w-4" /> {t("adj.new")}
        </button>
      </div>

      {/* Stated explicitly, because "why did my profit not change?" is the first
          question a bookkeeper asks after writing off stock. */}
      <p className="text-xs text-slate-500 bg-slate-50 border rounded-lg p-3">
        {t("adj.noLedgerNote")}
      </p>

      {open && (
        <form onSubmit={submit} className="card card-padding space-y-4">
          <div className="grid sm:grid-cols-3 gap-3">
            <div>
              <label className="label">{t("adj.reason")} *</label>
              <select
                className="input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
              >
                {reasons.map((r) => (
                  <option key={r.code} value={r.code}>
                    {r.label}
                  </option>
                ))}
              </select>
              {selectedReason && (
                <p className="text-xs text-slate-500 mt-1">
                  {selectedReason.direction === "IN" ? t("adj.increases") : t("adj.decreases")}
                </p>
              )}
            </div>
            <div>
              <label className="label">{t("adj.date")}</label>
              <input
                type="date"
                className="input"
                value={date}
                onChange={(e) => setDate(e.target.value)}
              />
            </div>
            <div>
              <label className="label">{t("adj.notes")}</label>
              <input
                className="input"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Water damage in transit"
              />
            </div>
          </div>

          <div className="space-y-2">
            <label className="label">{t("adj.lines")}</label>
            {lines.map((line, i) => (
              <div key={i} className="flex flex-wrap gap-2 items-end">
                <select
                  className="input flex-1 min-w-[180px]"
                  value={line.itemId}
                  onChange={(e) => {
                    const item = items.find((it) => it.id === e.target.value);
                    setLine(i, {
                      itemId: e.target.value,
                      // Pre-fill the cost so the user sees what will be used and
                      // can override it, rather than it happening invisibly.
                      rate: item ? (item.purchasePricePaise / 100).toFixed(2) : "",
                    });
                  }}
                >
                  <option value="">Select an item…</option>
                  {items.map((it) => (
                    <option key={it.id} value={it.id}>
                      {it.name}
                    </option>
                  ))}
                </select>
                <input
                  className="input w-28"
                  type="number"
                  step="any"
                  min="0"
                  placeholder="Qty"
                  value={line.quantity}
                  onChange={(e) => setLine(i, { quantity: e.target.value })}
                />
                <input
                  className="input w-32"
                  type="number"
                  step="0.01"
                  min="0"
                  placeholder="Cost/unit"
                  value={line.rate}
                  onChange={(e) => setLine(i, { rate: e.target.value })}
                />
                <input
                  className="input flex-1 min-w-[140px]"
                  placeholder="Line note"
                  value={line.notes}
                  onChange={(e) => setLine(i, { notes: e.target.value })}
                />
                {lines.length > 1 && (
                  <button
                    type="button"
                    className="btn-ghost p-2"
                    onClick={() => setLines((ls) => ls.filter((_, x) => x !== i))}
                    aria-label="Remove line"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              className="btn-ghost text-sm"
              onClick={() => setLines((ls) => [...ls, { ...EMPTY_LINE }])}
            >
              <Plus className="h-3 w-3" /> Add item
            </button>
          </div>

          <div className="flex gap-2">
            <button className="btn-primary" disabled={saving}>
              {saving ? "Saving…" : t("adj.save")}
            </button>
            <button type="button" className="btn-ghost" onClick={() => setOpen(false)}>
              Cancel
            </button>
          </div>
        </form>
      )}

      <div className="card card-padding overflow-x-auto">
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">{t("adj.none")}</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t("adj.number")}</th>
                <th>{t("adj.date")}</th>
                <th>{t("adj.reason")}</th>
                <th>{t("adj.lines")}</th>
                <th className="text-right">{t("inv.value")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="font-mono text-xs">{r.number}</td>
                  <td>{formatDate(r.date)}</td>
                  <td>
                    <span className="badge bg-slate-100 text-slate-700">{r.reason}</span>
                    {r.notes && <span className="ml-2 text-xs text-slate-500">{r.notes}</span>}
                  </td>
                  <td className="text-xs">
                    {r.items.map((li: any) => (
                      <div key={li.id}>
                        {li.direction === "IN" ? "+" : "−"}
                        {formatNumber(li.quantity, 2)} {li.item?.unit} {li.item?.name}
                      </div>
                    ))}
                  </td>
                  <td className="text-right">
                    {formatPaise(
                      r.items.reduce(
                        (s: number, li: any) =>
                          s + (li.direction === "IN" ? li.valuePaise : -li.valuePaise),
                        0
                      )
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
