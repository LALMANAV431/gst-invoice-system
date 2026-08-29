"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { Plus, Trash2, AlertTriangle, CheckCircle2 } from "lucide-react";
import { formatPaise, toPaise } from "@/lib/money";
import { inputDate } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

type LedgerOption = { id: string; name: string; groupName: string; isCash: boolean };

type Line = { ledgerId: string; debit: number; credit: number; narration: string };

const newLine = (): Line => ({ ledgerId: "", debit: 0, credit: 0, narration: "" });

/**
 * Manual journal / contra voucher entry.
 *
 * The balance indicator is the whole point of this screen: the server rejects an
 * unbalanced entry, so the user must be able to see the difference as they type
 * rather than discovering it on submit.
 */
export default function JournalForm({ ledgers }: { ledgers: LedgerOption[] }) {
  const router = useRouter();
  const { t } = useT();

  const [voucherType, setVoucherType] = useState<"JOURNAL" | "CONTRA">("JOURNAL");
  const [date, setDate] = useState(inputDate(new Date()));
  const [narration, setNarration] = useState("");
  const [lines, setLines] = useState<Line[]>([newLine(), newLine()]);
  const [saving, setSaving] = useState(false);

  // A contra voucher may only touch cash-equivalent accounts, matching the
  // server-side rule, so the picker cannot offer an option that will be rejected.
  const available = useMemo(
    () => (voucherType === "CONTRA" ? ledgers.filter((l) => l.isCash) : ledgers),
    [voucherType, ledgers]
  );

  const totals = useMemo(() => {
    const debitPaise = lines.reduce((s, l) => s + toPaise(l.debit || 0), 0);
    const creditPaise = lines.reduce((s, l) => s + toPaise(l.credit || 0), 0);
    return {
      debitPaise,
      creditPaise,
      differencePaise: debitPaise - creditPaise,
      balanced: debitPaise === creditPaise && debitPaise > 0,
    };
  }, [lines]);

  function update(i: number, patch: Partial<Line>) {
    setLines((ls) => ls.map((l, idx) => (idx === i ? { ...l, ...patch } : l)));
  }

  /** Entering a debit clears the credit on that line, and vice versa. */
  function setDebit(i: number, value: number) {
    update(i, { debit: value, credit: value > 0 ? 0 : lines[i].credit });
  }
  function setCredit(i: number, value: number) {
    update(i, { credit: value, debit: value > 0 ? 0 : lines[i].debit });
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();

    const filled = lines.filter((l) => l.ledgerId && (l.debit > 0 || l.credit > 0));
    if (filled.length < 2) return toast.error("A voucher needs at least two lines");
    if (!narration.trim()) return toast.error("Add a narration so the entry is auditable");
    if (!totals.balanced) {
      return toast.error(
        `Debits and credits must match. They differ by ${formatPaise(Math.abs(totals.differencePaise))}.`
      );
    }

    setSaving(true);
    try {
      const res = await fetch("/api/journal-entries", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          voucherType,
          date,
          narration,
          lines: filled.map((l) => ({
            ledgerId: l.ledgerId,
            debit: l.debit || undefined,
            credit: l.credit || undefined,
            narration: l.narration || null,
          })),
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t("state.error"));
        return;
      }
      toast.success(`${data.voucherType === "CONTRA" ? "Contra" : "Journal"} ${data.voucherNo} posted`);
      setLines([newLine(), newLine()]);
      setNarration("");
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
        <div>
          <label className="label">Voucher type</label>
          <select
            className="input"
            value={voucherType}
            onChange={(e) => {
              const next = e.target.value as "JOURNAL" | "CONTRA";
              setVoucherType(next);
              // Clear any ledger that is no longer selectable.
              if (next === "CONTRA") {
                setLines((ls) =>
                  ls.map((l) =>
                    ledgers.find((x) => x.id === l.ledgerId)?.isCash ? l : { ...l, ledgerId: "" }
                  )
                );
              }
            }}
          >
            <option value="JOURNAL">Journal</option>
            <option value="CONTRA">Contra (cash ↔ bank)</option>
          </select>
        </div>
        <div>
          <label className="label">{t("label.date")}</label>
          <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
        </div>
        <div className="md:col-span-2">
          <label className="label">Narration *</label>
          <input
            className="input"
            value={narration}
            onChange={(e) => setNarration(e.target.value)}
            placeholder="Depreciation for the year / cash deposited to bank"
            maxLength={500}
          />
        </div>
      </div>

      <div className="card card-padding">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-semibold">Entries</h2>
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
                <th style={{ width: "34%" }}>{t("report.ledger")}</th>
                <th>{t("label.notes")}</th>
                <th className="text-right">{t("report.debit")}</th>
                <th className="text-right">{t("report.credit")}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i}>
                  <td>
                    <select
                      className="input"
                      value={l.ledgerId}
                      onChange={(e) => update(i, { ledgerId: e.target.value })}
                    >
                      <option value="">— select ledger —</option>
                      {available.map((opt) => (
                        <option key={opt.id} value={opt.id}>
                          {opt.name} · {opt.groupName}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td>
                    <input
                      className="input"
                      value={l.narration}
                      onChange={(e) => update(i, { narration: e.target.value })}
                      placeholder={t("label.optional")}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="input text-right"
                      value={l.debit || ""}
                      onChange={(e) => setDebit(i, parseFloat(e.target.value) || 0)}
                    />
                  </td>
                  <td>
                    <input
                      type="number"
                      step="0.01"
                      min="0"
                      className="input text-right"
                      value={l.credit || ""}
                      onChange={(e) => setCredit(i, parseFloat(e.target.value) || 0)}
                    />
                  </td>
                  <td>
                    {lines.length > 2 && (
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
            <tfoot>
              <tr className="font-semibold">
                <td colSpan={2}>{t("label.total")}</td>
                <td className="text-right">{formatPaise(totals.debitPaise)}</td>
                <td className="text-right">{formatPaise(totals.creditPaise)}</td>
                <td></td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      <div
        className={`card card-padding flex items-center justify-between ${
          totals.balanced
            ? "border-emerald-200 bg-emerald-50"
            : totals.differencePaise !== 0
              ? "border-amber-300 bg-amber-50"
              : ""
        }`}
      >
        <div className="flex items-center gap-2 text-sm">
          {totals.balanced ? (
            <>
              <CheckCircle2 className="h-4 w-4 text-emerald-600" />
              <span className="font-medium text-emerald-800">Balanced</span>
            </>
          ) : (
            <>
              <AlertTriangle className="h-4 w-4 text-amber-600" />
              <span className="text-amber-800">
                {totals.differencePaise === 0
                  ? "Enter amounts on at least two lines"
                  : `Out by ${formatPaise(Math.abs(totals.differencePaise))} — ${
                      totals.differencePaise > 0 ? "credit" : "debit"
                    } short`}
              </span>
            </>
          )}
        </div>
        <button className="btn-primary" disabled={saving || !totals.balanced}>
          {saving ? t("action.saving") : "Post voucher"}
        </button>
      </div>
    </form>
  );
}
