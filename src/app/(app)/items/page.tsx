import Link from "next/link";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { formatINR, formatNumber } from "@/lib/utils";
import { Plus, Pencil } from "lucide-react";
import DeleteButton from "./DeleteButton";
import EmptyState from "@/components/EmptyState";
import CsvImport from "@/components/CsvImport";

export const dynamic = "force-dynamic";

export default async function ItemsPage({ searchParams }: { searchParams: { q?: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;
  const where: any = { companyId: ctx.company.id };
  if (searchParams.q) where.name = { contains: searchParams.q };
  const items = await db.item.findMany({ where, orderBy: { name: "asc" } });

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-3 items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold">Items / Inventory</h1>
          <p className="text-sm text-slate-500">Track products with HSN, GST and stock</p>
        </div>
        <div className="flex gap-2">
          <CsvImport
            endpoint="/api/items/import"
            label="Import"
            sampleHeaders={["name", "sku", "hsn", "barcode", "unit", "salePrice", "purchasePrice", "gstRate", "openingStock", "lowStockAlert"]}
          />
          <Link href="/items/new" className="btn-primary">
            <Plus className="h-4 w-4" /> Add Item
          </Link>
        </div>
      </div>

      <div className="card card-padding">
        <form className="flex flex-wrap gap-2 mb-4">
          <input
            name="q"
            defaultValue={searchParams.q}
            placeholder="Search items..."
            className="input max-w-xs"
          />
          <button className="btn-secondary">Search</button>
        </form>

        <div className="overflow-x-auto -mx-5">
          <table className="table">
            <thead>
              <tr>
                <th>Name</th>
                <th>HSN</th>
                <th>Unit</th>
                <th className="text-right">Sale ₹</th>
                <th className="text-right">Purchase ₹</th>
                <th className="text-right">GST %</th>
                <th className="text-right">Stock</th>
                <th className="text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {items.length === 0 ? (
                <tr>
                  <td colSpan={8}>
                    <EmptyState
                      title="No items yet"
                      description="Add products with HSN codes, GST rates and stock levels."
                      ctaHref="/items/new"
                      ctaLabel="Add Item"
                    />
                  </td>
                </tr>
              ) : (
                items.map((it) => {
                  const low = it.lowStockAlert > 0 && it.currentStock <= it.lowStockAlert;
                  return (
                    <tr key={it.id}>
                      <td>
                        <Link
                          href={`/items/${it.id}`}
                          className="font-medium text-brand-600 hover:underline"
                        >
                          {it.name}
                        </Link>
                        {it.sku && <div className="text-xs text-slate-400">{it.sku}</div>}
                      </td>
                      <td className="text-xs">{it.hsn || "—"}</td>
                      <td>{it.unit}</td>
                      <td className="text-right">{formatINR(it.salePrice)}</td>
                      <td className="text-right">{formatINR(it.purchasePrice)}</td>
                      <td className="text-right">{it.gstRate}%</td>
                      <td className={`text-right font-medium ${low ? "text-rose-600" : ""}`}>
                        {formatNumber(it.currentStock, 0)} {it.unit}
                      </td>
                      <td>
                        <div className="flex justify-end gap-1">
                          <Link href={`/items/${it.id}`} className="btn-ghost p-2">
                            <Pencil className="h-4 w-4" />
                          </Link>
                          <DeleteButton id={it.id} />
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
