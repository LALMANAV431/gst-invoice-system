import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import PosClient from "./PosClient";

export const dynamic = "force-dynamic";

export default async function PosPage() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return null;

  const [items, parties] = await Promise.all([
    db.item.findMany({
      where: { companyId: ctx.company.id },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        sku: true,
        barcode: true,
        hsn: true,
        unit: true,
        salePricePaise: true,
        gstRate: true,
        currentStock: true,
      },
    }),
    db.party.findMany({
      where: { companyId: ctx.company.id, type: { in: ["CUSTOMER", "BOTH"] } },
      orderBy: { name: "asc" },
      select: { id: true, name: true, stateCode: true },
    }),
  ]);

  return (
    <PosClient
      items={items}
      parties={parties}
      companyStateCode={ctx.company.stateCode}
    />
  );
}
