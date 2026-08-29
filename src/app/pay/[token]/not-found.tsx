import { XCircle } from "lucide-react";

/**
 * Shown for an unknown payment link token, with a real 404 status.
 *
 * Deliberately says nothing about whether the token was ever valid, expired, or
 * belongs to another business — a payment URL is guessable-adjacent, and
 * confirming which tokens once existed would leak information.
 */
export default function PaymentLinkNotFound() {
  return (
    <main className="flex min-h-screen items-center justify-center bg-slate-100 p-4 dark:bg-slate-950">
      <div className="w-full max-w-md rounded-2xl bg-white p-6 text-center shadow-sm ring-1 ring-slate-200 dark:bg-slate-900 dark:ring-slate-800">
        <XCircle className="mx-auto h-10 w-10 text-slate-300" />
        <h1 className="mt-3 text-lg font-semibold">Payment link not available</h1>
        <p className="mt-1 text-sm text-slate-500">
          This link cannot be opened. Please ask the sender for a new one.
        </p>
      </div>
    </main>
  );
}
