"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { AlertTriangle, ArrowLeft, Check, Save } from "lucide-react";
import { formatPaise } from "@/lib/money";
import { formatDate, formatNumber } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

/**
 * A count sheet.
 *
 * The book quantity shown here is the snapshot frozen when the sheet was
 * created, NOT the live figure. That is the point of a count: the variance is
 * measured against what the books claimed at the time of counting.
 */
export default function CountSheetPage({ params }: { params: { id: string } }) {
  const { t } = useT();
  const router = useRouter();
  const [count, setCount] = useState<any>(null);
  const [counted, setCounted] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [posting, setPosting] = useState(false);

  async function load() {
    const res = await fetch(`/api/physical-counts/${params.id}`);
    if (!res.ok) {
      toast.error("Count not found");
      router.push("/physical-counts");
      return;
    }
    const json = await res.json();
    setCount(json);
    setCounted(
      Object.fromEntries(json.items.map((i: any) => [i.itemId, String(i.countedQuantity)]))
    );
  }

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params.id]);

  if (!count) return <p className="text-sm text-slate-500">Loading…</p>;

  const isDraft = count.status === "DRAFT";

  async function save() {
    setSaving(true);
    const res = await fetch(`/api/physical-counts/${params.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lines: count.items.map((i: any) => ({
          itemId: i.itemId,
          countedQuantity: parseFloat(counted[i.itemId] ?? "0") || 0,
        })),
      }),
    });
    setSaving(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Could not save");
      return;
    }
    toast.success("Saved");
    load();
  }

  async function post() {
    if (!confirm(t("count.postWarning"))) return;
    setPosting(true);
    const res = await fetch(`/api/physical-counts/${params.id}/post`, { method: "POST" });
    setPosting(false);
    const json = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast.error(json.error ?? "Could not post the count");
      return;
    }
    toast.success(json.message ?? "Posted");
    load();
  }

  // Live variance from what is typed, so the user sees the effect before saving.
  const liveVariance = (item: any) => {
    const value = parseFloat(counted[item.itemId] ?? "");
    if (!Number.isFinite(value)) return 0;
    return value - item.systemQuantity;
  };
  const varianceCount = count.items.filter((i: any) => Math.abs(liveVariance(i)) > 1e-9).length;

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3 flex-wrap">
        <Link href="/physical-counts" className="btn-ghost p-2">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div className="flex-1">
          <h1 className="text-2xl font-bold">{count.number}</h1>
          <p className="text-sm text-slate-500">
            {formatDate(count.date)}
            {count.countedBy ? ` · ${count.countedBy}` : ""}
            {count.postedAt ? ` · ${t("count.postedOn")} ${formatDate(count.postedAt)}` : ""}
          </p>
        </div>
        {isDraft ? (
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={save} disabled={saving}>
              <Save className="h-4 w-4" /> {saving ? "Saving…" : t("count.save")}
            </button>
            <button className="btn-primary" onClick={post} disabled={posting}>
              <Check className="h-4 w-4" /> {posting ? "Posting…" : t("count.post")}
            </button>
          </div>
        ) : (
          <span className="badge bg-emerald-100 text-emerald-700">{t("count.posted")}</span>
        )}
      </div>

      {count.adjustment && (
        <p className="text-sm text-slate-600 bg-emerald-50 border border-emerald-200 rounded-lg p-3">
          Posted as stock adjustment{" "}
          <Link href="/stock-adjustments" className="font-mono underline">
            {count.adjustment.number}
          </Link>
          .
        </p>
      )}

      {isDraft && varianceCount > 0 && (
        <div className="card card-padding border-amber-200 bg-amber-50 flex gap-2 items-start">
          <AlertTriangle className="h-4 w-4 text-amber-600 mt-0.5 shrink-0" />
          <p className="text-sm text-amber-900">
            {varianceCount} line(s) differ from the books. Net effect{" "}
            <strong>
              {formatPaise(
                count.items.reduce(
                  (s: number, i: any) => s + Math.round(i.ratePaise * liveVariance(i)),
                  0
                )
              )}
            </strong>
            . {t("count.postWarning")}
          </p>
        </div>
      )}

      <div className="card card-padding overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>{t("inv.item")}</th>
              <th className="text-right">{t("count.systemQty")}</th>
              <th className="text-right">{t("count.countedQty")}</th>
              <th className="text-right">{t("count.variance")}</th>
              <th className="text-right">{t("inv.value")}</th>
            </tr>
          </thead>
          <tbody>
            {count.items.map((i: any) => {
              const variance = isDraft ? liveVariance(i) : i.variance;
              return (
                <tr key={i.id}>
                  <td>
                    {i.item.name}
                    {i.item.sku && (
                      <span className="text-xs text-slate-400 ml-2">{i.item.sku}</span>
                    )}
                  </td>
                  <td className="text-right text-slate-500">
                    {formatNumber(i.systemQuantity, 2)} {i.item.unit}
                  </td>
                  <td className="text-right">
                    {isDraft ? (
                      <input
                        className="input w-24 text-right"
                        type="number"
                        step="any"
                        min="0"
                        value={counted[i.itemId] ?? ""}
                        onChange={(e) =>
                          setCounted((c) => ({ ...c, [i.itemId]: e.target.value }))
                        }
                      />
                    ) : (
                      <>
                        {formatNumber(i.countedQuantity, 2)} {i.item.unit}
                      </>
                    )}
                  </td>
                  <td
                    className={`text-right font-medium ${
                      Math.abs(variance) < 1e-9
                        ? "text-slate-400"
                        : variance > 0
                          ? "text-emerald-700"
                          : "text-rose-700"
                    }`}
                  >
                    {Math.abs(variance) < 1e-9
                      ? "—"
                      : `${variance > 0 ? "+" : ""}${formatNumber(variance, 2)}`}
                  </td>
                  <td className="text-right text-slate-500">
                    {Math.abs(variance) < 1e-9
                      ? "—"
                      : formatPaise(Math.round(i.ratePaise * variance))}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
        {!isDraft && count.summary?.varianceLines === 0 && (
          <p className="text-sm text-emerald-700 mt-3">{t("count.agreed")}</p>
        )}
      </div>
    </div>
  );
}
