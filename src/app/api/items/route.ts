import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { writeGuard } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { recordOpeningStock } from "@/server/services/inventory.service";

export async function GET(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const items = await db.item.findMany({
    where: { companyId: ctx.company.id },
    orderBy: { name: "asc" },
  });
  return NextResponse.json(items);
}

export async function POST(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;
  const body = await req.json();
  if (!body.name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const opening = parseFloat(body.openingStock) || 0;
  const purchasePricePaise = parseFloat(body.purchasePricePaise) || 0;
  // Cost of the opening stock. Captured separately so that re-pricing the item
  // later does not retrospectively revalue stock we already held.
  const openingRatePaise =
    body.openingRatePaise !== undefined && body.openingRatePaise !== null && body.openingRatePaise !== ""
      ? parseFloat(body.openingRatePaise) || 0
      : purchasePricePaise;

  const item = await db.$transaction(async (tx) => {
    const created = await tx.item.create({
      data: {
        companyId: ctx.company!.id,
        name: body.name,
        sku: body.sku || null,
        hsn: body.hsn || null,
        unit: body.unit || "NOS",
        salePricePaise: parseFloat(body.salePricePaise) || 0,
        purchasePricePaise,
        gstRate: parseFloat(body.gstRate) || 0,
        openingStock: opening,
        openingRatePaise,
        currentStock: opening,
        lowStockAlert: parseFloat(body.lowStockAlert) || 0,
        trackBatches: Boolean(body.trackBatches),
        description: body.description || null,
      },
    });

    // Opening stock gets a real movement row, so the stock ledger is the
    // complete history of the item and `sum(IN) - sum(OUT)` equals currentStock.
    // Without it, valuation has to infer the opening position.
    if (opening !== 0) {
      await recordOpeningStock(tx, {
        companyId: ctx.company!.id,
        itemId: created.id,
        quantity: opening,
        ratePaise: openingRatePaise,
      });
    }

    return created;
  });
  await logAudit({
    companyId: ctx.company.id,
    userId: ctx.user.id,
    action: "CREATE",
    entity: "Item",
    entityId: item.id,
    changes: { name: item.name },
  });
  return NextResponse.json(item);
}
