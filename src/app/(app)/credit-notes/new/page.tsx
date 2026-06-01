import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import InvoiceForm from "../../invoices/InvoiceForm";

export default async function NewCreditNotePage({
  searchParams,
}: {
  searchParams: { kind?: string };
}) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;
  const isDebit = searchParams.kind === "DEBIT";

  const [parties, items] = await Promise.all([
    db.party.findMany({
      where: {
        companyId: ctx.company.id,
        type: { in: isDebit ? ["VENDOR", "BOTH"] : ["CUSTOMER", "BOTH"] },
      },
      orderBy: { name: "asc" },
    }),
    db.item.findMany({ where: { companyId: ctx.company.id }, orderBy: { name: "asc" } }),
  ]);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="text-2xl font-bold">{isDebit ? "New Debit Note" : "New Credit Note"}</h1>
        <p className="text-sm text-slate-500">
          {isDebit
            ? "Purchase return — stock will be reduced, vendor payable decreases"
            : "Sales return — stock comes back in, customer receivable decreases"}
        </p>
      </div>
      <InvoiceForm
        parties={parties}
        items={items}
        mode={isDebit ? "debit" : "credit"}
        companyStateCode={ctx.company.stateCode}
      />
    </div>
  );
}
