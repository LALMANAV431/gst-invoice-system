import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import InvoiceForm from "../../invoices/InvoiceForm";

export default async function NewPurchasePage() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;
  const [parties, items] = await Promise.all([
    db.party.findMany({
      where: { companyId: ctx.company.id, type: { in: ["VENDOR", "BOTH"] } },
      orderBy: { name: "asc" },
    }),
    db.item.findMany({ where: { companyId: ctx.company.id }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">New Purchase</h1>
        <p className="text-sm text-slate-500">Record a vendor bill</p>
      </div>
      <InvoiceForm
        parties={parties}
        items={items}
        mode="purchase"
        companyStateCode={ctx.company.stateCode}
      />
    </div>
  );
}
