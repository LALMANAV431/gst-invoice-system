import Link from "next/link";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { getGstSummary } from "@/server/ledger";
import { formatPaise } from "@/lib/money";
import { ArrowLeft } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * GST liability summary — the core of GSTR-3B.
 *
 * Derived from the Output/Input tax ledgers rather than by re-summing invoices,
 * so it cannot disagree with the books.
 */
export default async function GstSummaryPage({
  searchParams,
}: {
  searchParams: { month?: string };
}) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;

  // Default to the current month, which is the GST filing period.
  const now = new Date();
  const monthParam = searchParams.month ?? `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}`;
  const [year, month] = monthParam.split("-").map(Number);
  const from = new Date(year, month - 1, 1, 0, 0, 0, 0);
  const to = new Date(year, month, 0, 23, 59, 59, 999);

  const gst = await getGstSummary(ctx.company.id, from, to);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href="/reports" className="btn-ghost p-2">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold">GST Summary</h1>
          <p className="text-sm text-slate-500">
            {from.toLocaleDateString("en-IN", { month: "long", year: "numeric" })}
          </p>
        </div>
      </div>

      <form className="card card-padding flex flex-wrap items-end gap-3">
        <div>
          <label className="label">Month</label>
          <input type="month" name="month" defaultValue={monthParam} className="input" />
        </div>
        <button className="btn-primary">Apply</button>
      </form>

      <div className="grid gap-4 md:grid-cols-3">
        <div className="card card-padding">
          <div className="text-sm text-slate-500">Output tax (collected)</div>
          <div className="mt-1 text-2xl font-bold text-amber-600">
            {formatPaise(gst.outputTotalPaise)}
          </div>
        </div>
        <div className="card card-padding">
          <div className="text-sm text-slate-500">Input credit (available)</div>
          <div className="mt-1 text-2xl font-bold text-emerald-600">
            {formatPaise(gst.inputTotalPaise)}
          </div>
        </div>
        <div className="card card-padding">
          <div className="text-sm text-slate-500">
            {gst.netPayablePaise >= 0 ? "Net payable" : "Credit carried forward"}
          </div>
          <div
            className={`mt-1 text-2xl font-bold ${
              gst.netPayablePaise >= 0 ? "text-rose-600" : "text-emerald-600"
            }`}
          >
            {formatPaise(Math.abs(gst.netPayablePaise))}
          </div>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <table className="table">
          <thead>
            <tr>
              <th>Head</th>
              <th className="text-right">Output tax</th>
              <th className="text-right">Input credit</th>
              <th className="text-right">Net</th>
            </tr>
          </thead>
          <tbody>
            <Row label="CGST" output={gst.outputCgstPaise} input={gst.inputCgstPaise} net={gst.netCgstPaise} />
            <Row label="SGST" output={gst.outputSgstPaise} input={gst.inputSgstPaise} net={gst.netSgstPaise} />
            <Row label="IGST" output={gst.outputIgstPaise} input={gst.inputIgstPaise} net={gst.netIgstPaise} />
            <Row label="Cess" output={gst.outputCessPaise} input={gst.inputCessPaise} net={gst.netCessPaise} />
          </tbody>
          <tfoot>
            <tr className="font-bold">
              <td>Total</td>
              <td className="text-right">{formatPaise(gst.outputTotalPaise)}</td>
              <td className="text-right">{formatPaise(gst.inputTotalPaise)}</td>
              <td className="text-right">{formatPaise(gst.netPayablePaise)}</td>
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="card card-padding text-xs text-slate-500 space-y-1">
        <p>
          <strong>Set-off rules are not applied here.</strong> IGST credit must be used against IGST
          first, then CGST, then SGST, and cess credit can only offset cess. This table shows each
          head separately so you can see the position; the actual utilisation order affects what you
          pay in cash.
        </p>
        <p>
          Reverse-charge liability, ineligible credit under s.17(5) and amendments to earlier periods
          are not reflected. Have your CA reconcile against GSTR-2B before filing.
        </p>
      </div>
    </div>
  );
}

function Row({
  label,
  output,
  input,
  net,
}: {
  label: string;
  output: number;
  input: number;
  net: number;
}) {
  return (
    <tr>
      <td className="font-medium">{label}</td>
      <td className="text-right">{formatPaise(output)}</td>
      <td className="text-right">{formatPaise(input)}</td>
      <td className={`text-right ${net > 0 ? "text-rose-600" : net < 0 ? "text-emerald-600" : ""}`}>
        {formatPaise(net)}
      </td>
    </tr>
  );
}
