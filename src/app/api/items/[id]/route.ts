import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const existing = await db.item.findFirst({
    where: { id: params.id, companyId: ctx.company.id },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // If openingStock changed, adjust currentStock by the diff
  let currentStock = existing.currentStock;
  if (body.openingStock != null) {
    const newOpening = parseFloat(body.openingStock) || 0;
    const diff = newOpening - existing.openingStock;
    currentStock = existing.currentStock + diff;
  }

  const item = await db.item.update({
    where: { id: params.id },
    data: {
      name: body.name ?? existing.name,
      sku: body.sku ?? existing.sku,
      hsn: body.hsn ?? existing.hsn,
      unit: body.unit ?? existing.unit,
      salePrice: body.salePrice != null ? parseFloat(body.salePrice) : existing.salePrice,
      purchasePrice:
        body.purchasePrice != null ? parseFloat(body.purchasePrice) : existing.purchasePrice,
      gstRate: body.gstRate != null ? parseFloat(body.gstRate) : existing.gstRate,
      openingStock:
        body.openingStock != null ? parseFloat(body.openingStock) : existing.openingStock,
      currentStock,
      lowStockAlert:
        body.lowStockAlert != null ? parseFloat(body.lowStockAlert) : existing.lowStockAlert,
      description: body.description ?? existing.description,
    },
  });
  return NextResponse.json(item);
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  try {
    await db.item.delete({ where: { id: params.id } });
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json(
      { error: "Cannot delete — item used in invoices/purchases." },
      { status: 400 }
    );
  }
}
