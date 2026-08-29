"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import toast from "react-hot-toast";
import { ArrowRightLeft, Ban, Loader2 } from "lucide-react";
import { useT } from "@/lib/i18n/client";

/**
 * Convert or cancel an order document.
 *
 * Conversion is the point at which a commitment becomes a financial event, so it
 * asks for confirmation and names what will be created.
 */
export default function OrderActions({
  id,
  number,
  label,
  convertsTo,
  alreadyConverted,
  cancelled,
}: {
  id: string;
  number: string;
  label: string;
  convertsTo: "INVOICE" | "PURCHASE";
  alreadyConverted: boolean;
  cancelled: boolean;
}) {
  const router = useRouter();
  const { t } = useT();
  const [busy, setBusy] = useState<"convert" | "cancel" | null>(null);

  const target = convertsTo === "INVOICE" ? "invoice" : "purchase";

  async function convert() {
    if (
      !confirm(
        `Convert ${label} ${number} into a ${target}?\n\n` +
          `This posts to the ledger. Stock already moved by this document will not move again.`
      )
    ) {
      return;
    }

    setBusy("convert");
    try {
      const res = await fetch(`/api/orders/${id}/convert`, { method: "POST" });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t("state.error"));
        return;
      }
      toast.success(`${data.kind === "invoice" ? "Invoice" : "Purchase"} ${data.number} created`);
      router.push(data.kind === "invoice" ? `/invoices/${data.id}` : `/purchases/${data.id}`);
      router.refresh();
    } catch {
      toast.error(t("state.error"));
    } finally {
      setBusy(null);
    }
  }

  async function cancelDoc() {
    const reason = prompt(`Why are you cancelling ${label} ${number}?`);
    if (!reason?.trim()) return;

    setBusy("cancel");
    try {
      const res = await fetch(`/api/orders/${id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reason }),
      });
      const data = await res.json();
      if (!res.ok) {
        toast.error(data.error ?? t("state.error"));
        return;
      }
      toast.success(`${label} cancelled`);
      router.refresh();
    } catch {
      toast.error(t("state.error"));
    } finally {
      setBusy(null);
    }
  }

  if (cancelled) return <span className="text-xs text-slate-400">—</span>;

  return (
    <div className="flex items-center justify-end gap-1">
      {!alreadyConverted && (
        <>
          <button
            type="button"
            onClick={convert}
            disabled={busy !== null}
            className="btn-ghost p-2 text-brand-600 disabled:opacity-50"
            title={`Convert to ${target}`}
          >
            {busy === "convert" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <ArrowRightLeft className="h-4 w-4" />
            )}
          </button>
          <button
            type="button"
            onClick={cancelDoc}
            disabled={busy !== null}
            className="btn-ghost p-2 text-rose-600 disabled:opacity-50"
            title={t("action.cancel")}
          >
            {busy === "cancel" ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Ban className="h-4 w-4" />
            )}
          </button>
        </>
      )}
    </div>
  );
}
