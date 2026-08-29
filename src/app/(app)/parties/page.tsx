import Link from "next/link";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { formatPaise } from "@/lib/utils";
import { Plus, Pencil } from "lucide-react";
import DeleteButton from "./DeleteButton";
import EmptyState from "@/components/EmptyState";
import CsvImport from "@/components/CsvImport";

export const dynamic = "force-dynamic";

export default async function PartiesPage({
  searchParams,
}: {
  searchParams: { type?: string; q?: string };
}) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;

  const where: any = { companyId: ctx.company.id };
  if (searchParams.type) where.type = searchParams.type;
  if (searchParams.q) where.name = { contains: searchParams.q };

  const parties = await db.party.findMany({ where, orderBy: { name: "asc" } });

  // Compute outstanding for each
  const balances = await Promise.all(
    parties.map(async (p) => {
      const inv = await db.invoice.aggregate({
        where: { partyId: p.id },
        _sum: { grandTotalPaise: true, amountPaidPaise: true },
      });
      const pur = await db.purchase.aggregate({
        where: { partyId: p.id },
        _sum: { grandTotalPaise: true, amountPaidPaise: true },
      });
      const creditAgg = await db.creditNote.aggregate({
        where: { partyId: p.id, kind: "CREDIT" },
        _sum: { grandTotalPaise: true },
      });
      const debitAgg = await db.creditNote.aggregate({
        where: { partyId: p.id, kind: "DEBIT" },
        _sum: { grandTotalPaise: true },
      });
      const receivable =
        (inv._sum.grandTotalPaise ?? 0) - (inv._sum.amountPaidPaise ?? 0) -
        (creditAgg._sum.grandTotalPaise ?? 0) +
        (p.balanceType === "RECEIVABLE" ? p.openingBalancePaise : 0);
      const payable =
        (pur._sum.grandTotalPaise ?? 0) - (pur._sum.amountPaidPaise ?? 0) -
        (debitAgg._sum.grandTotalPaise ?? 0) +
        (p.balanceType === "PAYABLE" ? p.openingBalancePaise : 0);
      return { id: p.id, receivable, payable };
    })
  );
  const balMap = new Map(balances.map((b) => [b.id, b]));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Parties</h1>
          <p className="text-sm text-slate-500">Customers and vendors</p>
        </div>
        <div className="flex gap-2">
          <CsvImport
            endpoint="/api/parties/import"
            label="Import"
            sampleHeaders={["name", "type", "gstin", "phone", "email", "city", "state", "stateCode", "openingBalancePaise"]}
          />
          <Link href="/parties/new" className="btn-primary">
            <Plus className="h-4 w-4" /> Add Party
          </Link>
        </div>
      </div>

      <div className="card card-padding">
        <form className="flex flex-wrap gap-2 mb-4">
          <input
            name="q"
            defaultValue={searchParams.q}
            placeholder="Search by name..."
            className="input max-w-xs"
          />
          <select name="type" defaultValue={searchParams.type ?? ""} className="input max-w-[180px]">
            <option value="">All types</option>
            <option value="CUSTOMER">Customers</option>
            <option value="VENDOR">Vendors</option>
            <option value="BOTH">Both</option>
          </select>
          <button className="btn-secondary">Filter</button>
        </form>

        <div className="overflow-x-auto -mx-5">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>Type</th>
                <th>GSTIN</th>
                <th>Phone</th>
                <th>City</th>
                <th className="text-right">Receivable</th>
                <th className="text-right">Payable</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {parties.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      title="No parties yet"
                      description="Add customers and vendors to start invoicing and tracking balances."
                      ctaHref="/parties/new"
                      ctaLabel="Add Party"
                    />
                  </td>
                </tr>
              ) : (
                parties.map((p) => {
                  const b = balMap.get(p.id);
                  return (
                    <tr key={p.id}>
                      <td>
                        <Link
                          href={`/parties/${p.id}`}
                          className="font-medium text-brand-600 hover:underline"
                        >
                          {p.name}
                        </Link>
                      </td>
                      <td>
                        <span className="badge-slate">{p.type}</span>
                      </td>
                      <td className="text-xs">{p.gstin || "—"}</td>
                      <td>{p.phone || "—"}</td>
                      <td>{p.city || "—"}</td>
                      <td className="text-right text-emerald-700 font-medium">
                        {b && b.receivable > 0 ? formatPaise(b.receivable) : "—"}
                      </td>
                      <td className="text-right text-rose-700 font-medium">
                        {b && b.payable > 0 ? formatPaise(b.payable) : "—"}
                      </td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <Link href={`/parties/${p.id}`} className="btn-ghost p-2" title="Edit">
                            <Pencil className="h-4 w-4" />
                          </Link>
                          <DeleteButton id={p.id} />
                        </div>
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
