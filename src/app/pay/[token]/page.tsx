import { formatPaise } from "@/lib/money";
import { formatDate } from "@/lib/utils";
import { getPublicPaymentLink } from "@/server/payments/link.service";
import { gatewayIsLive } from "@/server/payments/gateway";
import { notFound } from "next/navigation";
import { CheckCircle2, Clock, AlertTriangle } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * Customer-facing payment page.
 *
 * OUTSIDE the authenticated layout: the person paying is the tenant's customer,
 * not a user of the app. It therefore exposes only what a payer needs — the
 * invoice number, the amount, and who is asking — and never the tenant's
 * customer list, other invoices, or any internal id.
 *
 * The URL carries an unguessable token rather than a row id, so links cannot be
 * enumerated.
 */
export default async function PayPage({ params }: { params: { token: string } }) {
  const link = await getPublicPaymentLink(params.token);

  // A real 404 rather than a 200 carrying a "not found" message: the status code
  // is what stops search engines indexing dead payment URLs, and it is the honest
  // answer to a request for a resource that does not exist.
  if (!link) notFound();

  if (link.status === "PAID") {
    return (
      <Shell>
        <div className="text-center">
          <CheckCircle2 className="mx-auto h-10 w-10 text-emerald-500" />
          <h1 className="mt-3 text-lg font-semibold">Already paid</h1>
          <p className="mt-1 text-sm text-slate-500">
            {formatPaise(link.paidPaise)} was received for invoice {link.invoice.number}.
            Nothing further is due on this link.
          </p>
        </div>
      </Shell>
    );
  }

  if (link.status === "EXPIRED" || link.status === "CANCELLED") {
    return (
      <Shell>
        <div className="text-center">
          <Clock className="mx-auto h-10 w-10 text-amber-500" />
          <h1 className="mt-3 text-lg font-semibold">
            This link has {link.status === "EXPIRED" ? "expired" : "been cancelled"}
          </h1>
          <p className="mt-1 text-sm text-slate-500">
            Ask {link.company.name} for a fresh payment link.
          </p>
        </div>
      </Shell>
    );
  }

  const live = gatewayIsLive();
  const outstanding = link.amountPaise - link.paidPaise;

  return (
    <Shell>
      <div className="text-center">
        <div className="text-sm text-slate-500">Payment requested by</div>
        <h1 className="text-xl font-bold">{link.company.name}</h1>
        {link.company.gstin && (
          <div className="mt-0.5 text-xs text-slate-400">GSTIN: {link.company.gstin}</div>
        )}
      </div>

      <div className="mt-6 rounded-xl bg-slate-50 p-4 text-sm dark:bg-slate-800/60">
        <Row label="Invoice" value={link.invoice.number} />
        <Row label="Invoice date" value={formatDate(link.invoice.date)} />
        <Row label="Invoice total" value={formatPaise(link.invoice.grandTotalPaise)} />
        {link.paidPaise > 0 && (
          <Row label="Already received" value={formatPaise(link.paidPaise)} />
        )}
      </div>

      <div className="mt-4 text-center">
        <div className="text-sm text-slate-500">Amount due now</div>
        <div className="text-3xl font-bold">{formatPaise(outstanding)}</div>
      </div>

      {!live && (
        <div className="mt-4 flex items-start gap-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" />
          <div>
            <div className="font-semibold">Test mode — no real payment will be taken</div>
            <div>
              No live payment gateway is configured for this account, so this page cannot
              collect money yet. Pay {link.company.name} directly
              {link.company.upiId ? ` (UPI: ${link.company.upiId})` : ""}.
            </div>
          </div>
        </div>
      )}

      {live && (
        <button
          type="button"
          disabled
          className="btn-primary mt-5 w-full justify-center opacity-60"
          title="Checkout is wired server-side; the browser checkout script is not bundled yet"
        >
          Pay {formatPaise(outstanding)}
        </button>
      )}

      <p className="mt-4 text-center text-xs text-slate-400">
        Payments are confirmed by the gateway directly with {link.company.name}. This page never
        sees your card or bank details.
      </p>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        {children}
      </div>
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between py-1">
      <span className="text-slate-500">{label}</span>
      <span className="font-medium">{value}</span>
    </div>
  );
}
