import Link from "next/link";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { DOC_CONFIG, type OrderDocType } from "@/server/services/order.service";
import { ArrowLeft } from "lucide-react";
import OrderForm from "./OrderForm";

export const dynamic = "force-dynamic";

const VALID: OrderDocType[] = [
  "SALES_ORDER",
  "DELIVERY_CHALLAN",
  "PURCHASE_ORDER",
  "GRN",
];

export default async function NewOrderPage({
  searchParams,
}: {
  searchParams: { docType?: string; from?: string };
}) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;
  const companyId = ctx.company.id;

  const docType = (VALID.includes(searchParams.docType as OrderDocType)
    ? searchParams.docType
    : "SALES_ORDER") as OrderDocType;
  const config = DOC_CONFIG[docType];

  const [parties, items, godowns, openOrders] = await Promise.all([
    db.party.findMany({
      // A purchase document needs suppliers, a sales document needs customers.
      // BOTH is valid for either.
      where: {
        companyId,
        type: config.partyType === "VENDOR" ? { in: ["VENDOR", "BOTH"] } : { in: ["CUSTOMER", "BOTH"] },
      },
      select: { id: true, name: true, stateCode: true, gstin: true },
      orderBy: { name: "asc" },
    }),
    db.item.findMany({
      where: { companyId },
      select: {
        id: true,
        name: true,
        hsn: true,
        unit: true,
        salePricePaise: true,
        purchasePricePaise: true,
        gstRate: true,
        cessRate: true,
        supplyType: true,
        pricingMode: true,
      },
      orderBy: { name: "asc" },
    }),
    db.godown.findMany({
      where: { companyId },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    // A challan is normally raised against a sales order, and a GRN against a
    // purchase order, so offer those as a starting point.
    docType === "DELIVERY_CHALLAN" || docType === "GRN"
      ? db.orderDocument.findMany({
          where: {
            companyId,
            docType: docType === "DELIVERY_CHALLAN" ? "SALES_ORDER" : "PURCHASE_ORDER",
            status: { in: ["OPEN", "PARTIAL"] },
            convertedToId: null,
          },
          select: {
            id: true,
            number: true,
            partyId: true,
            party: { select: { name: true } },
          },
          orderBy: { date: "desc" },
          take: 50,
        })
      : Promise.resolve([]),
  ]);

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-3">
        <Link href={`/orders?docType=${docType}`} className="btn-ghost p-2">
          <ArrowLeft className="h-4 w-4" />
        </Link>
        <div>
          <h1 className="text-xl font-bold">New {config.label}</h1>
          <p className="text-sm text-slate-500">
            {config.stockEffect === "NONE"
              ? "A commitment only — no stock moves and nothing posts to the ledger yet."
              : config.stockEffect === "OUT"
                ? "Stock will leave your godown. The ledger entry happens when you invoice it."
                : "Stock will be added. The payable is recorded when you book the supplier's bill."}
          </p>
        </div>
      </div>

      <OrderForm
        docType={docType}
        parties={parties}
        items={items}
        godowns={godowns}
        sourceOptions={openOrders.map((o) => ({
          id: o.id,
          number: o.number,
          partyId: o.partyId,
          partyName: o.party.name,
        }))}
        companyStateCode={ctx.company.stateCode}
        preselectedSourceId={searchParams.from ?? null}
      />
    </div>
  );
}
