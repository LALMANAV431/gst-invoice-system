import Link from "next/link";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { toRupees } from "@/lib/money";
import { formatPaise, formatNumber } from "@/lib/utils";
import { ArrowLeft } from "lucide-react";
import Gstr1Export from "./Gstr1Export";

export const dynamic = "force-dynamic";

export default async function Gstr1Page({
  searchParams,
}: {
  searchParams: { from?: string; to?: string };
}) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;
  const company = ctx.company;

  const from = searchParams.from ? new Date(searchParams.from) : startOfMonth();
  const to = searchParams.to ? new Date(searchParams.to) : endOfMonth();
  to.setHours(23, 59, 59, 999);

  const invoices = await db.invoice.findMany({
    where: { companyId: company.id, date: { gte: from, lte: to } },
    include: { party: true, items: true },
    orderBy: { date: "asc" },
  });

  // B2B: party has GSTIN; B2C: no GSTIN
  const b2b = invoices.filter((i) => i.party.gstin);
  const b2c = invoices.filter((i) => !i.party.gstin);

  const sum = (arr: typeof invoices, key: "subTotalPaise" | "taxTotalPaise" | "grandTotalPaise") =>
    arr.reduce((s, i) => s + (i[key] as number), 0);

  // HSN summary
  const hsnMap = new Map<
    string,
    { hsn: string; gstRate: number; qty: number; taxablePaise: number; cgstPaise: number; sgstPaise: number; igstPaise: number; totalPaise: number }
  >();
  for (const inv of invoices) {
    for (const it of inv.items) {
      const key = `${it.hsn || "NA"}-${it.gstRate}`;
      const cur =
        hsnMap.get(key) ||
        { hsn: it.hsn || "NA", gstRate: it.gstRate, qty: 0, taxablePaise: 0, cgstPaise: 0, sgstPaise: 0, igstPaise: 0, totalPaise: 0 };
      cur.qty += it.quantity;
      cur.taxablePaise += it.taxablePaise;
      cur.cgstPaise += it.cgstPaise;
      cur.sgstPaise += it.sgstPaise;
      cur.igstPaise += it.igstPaise;
      cur.totalPaise += it.totalPaise;
      hsnMap.set(key, cur);
    }
  }
  const hsnRows = Array.from(hsnMap.values()).sort((a, b) => b.taxablePaise - a.taxablePaise);

  const period = `${iso(from)}_${iso(to)}`;

  // Simplified GSTR-1 JSON (portal-style structure)
  const gstr1Json = {
    gstin: company.gstin || "URP",
    fp: `${String(from.getMonth() + 1).padStart(2, "0")}${from.getFullYear()}`,
    gt: +toRupees(sum(invoices, "grandTotalPaise")).toFixed(2),
    cur_gt: +toRupees(sum(invoices, "grandTotalPaise")).toFixed(2),
    b2b: b2b.map((inv) => ({
      ctin: inv.party.gstin,
      inv: [
        {
          inum: inv.number,
          idt: formatDDMMYYYY(inv.date),
          val: +toRupees(inv.grandTotalPaise).toFixed(2),
          pos: inv.party.stateCode || company.stateCode || "",
          rchrg: "N",
          itms: inv.items.map((it, idx) => ({
            num: idx + 1,
            itm_det: {
              txval: +toRupees(it.taxablePaise).toFixed(2),
              rt: it.gstRate,
              camt: +toRupees(it.cgstPaise).toFixed(2),
              samt: +toRupees(it.sgstPaise).toFixed(2),
              iamt: +toRupees(it.igstPaise).toFixed(2),
            },
          })),
        },
      ],
    })),
    b2cs: b2c.map((inv) => ({
      sply_ty: inv.isInterState ? "INTER" : "INTRA",
      pos: inv.party.stateCode || company.stateCode || "",
      typ: "OE",
      txval: +toRupees(inv.subTotalPaise).toFixed(2),
      iamt: +toRupees(inv.igstTotalPaise).toFixed(2),
      camt: +toRupees(inv.cgstTotalPaise).toFixed(2),
      samt: +toRupees(inv.sgstTotalPaise).toFixed(2),
    })),
    hsn: {
      data: hsnRows.map((h, i) => ({
        num: i + 1,
        hsn_sc: h.hsn,
        rt: h.gstRate,
        qty: +h.qty.toFixed(2),
        txval: +toRupees(h.taxablePaise).toFixed(2),
        camt: +toRupees(h.cgstPaise).toFixed(2),
        samt: +toRupees(h.sgstPaise).toFixed(2),
        iamt: +toRupees(h.igstPaise).toFixed(2),
      })),
    },
  };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <Link href="/reports" className="btn-ghost text-sm -ml-2 mb-1">
            <ArrowLeft className="h-4 w-4" /> Reports
          </Link>
          <h1 className="text-2xl font-bold">GSTR-1 Summary</h1>
          <p className="text-sm text-slate-500">Outward supplies — B2B, B2C and HSN summary</p>
        </div>
        <Gstr1Export data={gstr1Json} period={period} />
      </div>

      <form className="card card-padding flex flex-wrap gap-3 items-end">
        <div>
          <label className="label">From</label>
          <input type="date" name="from" defaultValue={iso(from)} className="input" />
        </div>
        <div>
          <label className="label">To</label>
          <input type="date" name="to" defaultValue={iso(to)} className="input" />
        </div>
        <button className="btn-primary">Apply</button>
      </form>

      <div className="grid sm:grid-cols-3 gap-4">
        <Stat label="Total Taxable" value={formatPaise(sum(invoices, "subTotalPaise"))} />
        <Stat label="Total Tax" value={formatPaise(sum(invoices, "taxTotalPaise"))} />
        <Stat label="Total Invoice Value" value={formatPaise(sum(invoices, "grandTotalPaise"))} />
      </div>

      <div className="card card-padding">
        <h2 className="font-semibold mb-3">B2B — Registered ({b2b.length})</h2>
        <div className="overflow-x-auto -mx-5">
          <table className="table">
            <thead>
              <tr>
                <th>Invoice</th>
                <th>GSTIN</th>
                <th>Party</th>
                <th className="text-right">Taxable</th>
                <th className="text-right">Tax</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {b2b.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-6 text-slate-500">
                    No B2B invoices in period.
                  </td>
                </tr>
              ) : (
                b2b.map((i) => (
                  <tr key={i.id}>
                    <td className="font-medium">{i.number}</td>
                    <td className="text-xs">{i.party.gstin}</td>
                    <td>{i.party.name}</td>
                    <td className="text-right">{formatPaise(i.subTotalPaise)}</td>
                    <td className="text-right">{formatPaise(i.taxTotalPaise)}</td>
                    <td className="text-right font-semibold">{formatPaise(i.grandTotalPaise)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      <div className="card card-padding">
        <h2 className="font-semibold mb-3">HSN-wise Summary</h2>
        <div className="overflow-x-auto -mx-5">
          <table className="table">
            <thead>
              <tr>
                <th>HSN</th>
                <th className="text-right">GST%</th>
                <th className="text-right">Qty</th>
                <th className="text-right">Taxable</th>
                <th className="text-right">CGST</th>
                <th className="text-right">SGST</th>
                <th className="text-right">IGST</th>
                <th className="text-right">Total</th>
              </tr>
            </thead>
            <tbody>
              {hsnRows.length === 0 ? (
                <tr>
                  <td colSpan={8} className="text-center py-6 text-slate-500">
                    No data in period.
                  </td>
                </tr>
              ) : (
                hsnRows.map((h, i) => (
                  <tr key={i}>
                    <td>{h.hsn}</td>
                    <td className="text-right">{h.gstRate}%</td>
                    <td className="text-right">{formatNumber(h.qty, 0)}</td>
                    <td className="text-right">{formatPaise(h.taxablePaise)}</td>
                    <td className="text-right">{formatPaise(h.cgstPaise)}</td>
                    <td className="text-right">{formatPaise(h.sgstPaise)}</td>
                    <td className="text-right">{formatPaise(h.igstPaise)}</td>
                    <td className="text-right font-semibold">{formatPaise(h.totalPaise)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="card card-padding card-hover">
      <div className="text-xs text-slate-500 uppercase font-semibold">{label}</div>
      <div className="text-xl font-bold mt-2">{value}</div>
    </div>
  );
}

function startOfMonth() {
  const d = new Date();
  d.setDate(1);
  d.setHours(0, 0, 0, 0);
  return d;
}
function endOfMonth() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1, 0);
  return d;
}
function iso(d: Date) {
  return d.toISOString().slice(0, 10);
}
function formatDDMMYYYY(d: Date | string) {
  const dt = new Date(d);
  return `${String(dt.getDate()).padStart(2, "0")}-${String(dt.getMonth() + 1).padStart(2, "0")}-${dt.getFullYear()}`;
}
