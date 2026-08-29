"use client";
import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ClipboardList, Plus } from "lucide-react";
import { formatDate } from "@/lib/utils";
import { useT } from "@/lib/i18n/client";

const STATUS_STYLE: Record<string, string> = {
  DRAFT: "bg-amber-100 text-amber-700",
  POSTED: "bg-emerald-100 text-emerald-700",
  CANCELLED: "bg-slate-100 text-slate-500",
};

export default function PhysicalCountsPage() {
  const { t } = useT();
  const router = useRouter();
  const [rows, setRows] = useState<any[]>([]);
  const [creating, setCreating] = useState(false);

  async function load() {
    const res = await fetch("/api/physical-counts");
    const json = await res.json();
    setRows(json.data ?? []);
  }

  useEffect(() => {
    load();
  }, []);

  async function start() {
    setCreating(true);
    const res = await fetch("/api/physical-counts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({}),
    });
    setCreating(false);
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      toast.error(err.error ?? "Could not start a count");
      return;
    }
    const count = await res.json();
    toast.success(`Count ${count.number} started`);
    router.push(`/physical-counts/${count.id}`);
  }

  const statusLabel = (status: string) =>
    status === "DRAFT" ? t("count.draft") : status === "POSTED" ? t("count.posted") : t("count.cancelled");

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold flex items-center gap-2">
            <ClipboardList className="h-6 w-6 text-brand-600" /> {t("count.title")}
          </h1>
          <p className="text-sm text-slate-500">{t("count.subtitle")}</p>
        </div>
        <button className="btn-primary" onClick={start} disabled={creating}>
          <Plus className="h-4 w-4" /> {creating ? "Starting…" : t("count.new")}
        </button>
      </div>

      <div className="card card-padding overflow-x-auto">
        {rows.length === 0 ? (
          <p className="text-sm text-slate-500">{t("count.none")}</p>
        ) : (
          <table className="table">
            <thead>
              <tr>
                <th>{t("count.number")}</th>
                <th>{t("adj.date")}</th>
                <th>{t("count.status")}</th>
                <th className="text-right">{t("adj.lines")}</th>
                <th className="text-right">{t("count.varianceLines")}</th>
                <th>{t("adj.number")}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td>
                    <Link
                      href={`/physical-counts/${r.id}`}
                      className="font-mono text-xs hover:text-brand-600"
                    >
                      {r.number}
                    </Link>
                  </td>
                  <td>{formatDate(r.date)}</td>
                  <td>
                    <span className={`badge ${STATUS_STYLE[r.status] ?? ""}`}>
                      {statusLabel(r.status)}
                    </span>
                  </td>
                  <td className="text-right">{r._count?.items ?? 0}</td>
                  <td className="text-right">
                    {r.varianceLines > 0 ? (
                      <span className="text-amber-700 font-medium">{r.varianceLines}</span>
                    ) : (
                      0
                    )}
                  </td>
                  <td className="font-mono text-xs text-slate-500">
                    {r.adjustment?.number ?? "—"}
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
