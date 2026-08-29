import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { writeGuard } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { recordStockMovement } from "@/server/stock";

export async function PUT(req: Request, { params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;
  const body = await req.json();
  const companyId = ctx.company.id;
  const existing = await db.item.findFirst({ where: { id: params.id, companyId } });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const newOpening =
    body.openingStock != null ? parseFloat(body.openingStock) || 0 : existing.openingStock;
  const openingDiff = newOpening - existing.openingStock;
  const openingRatePaise =
    body.openingRatePaise != null
      ? parseFloat(body.openingRatePaise) || 0
      : existing.openingRatePaise ||
        (body.purchasePricePaise != null
          ? parseFloat(body.purchasePricePaise) || 0
          : existing.purchasePricePaise);

  const item = await db.$transaction(async (tx) => {
    const updated = await tx.item.update({
      where: { id: params.id },
      data: {
        name: body.name ?? existing.name,
        sku: body.sku ?? existing.sku,
        hsn: body.hsn ?? existing.hsn,
        unit: body.unit ?? existing.unit,
        salePricePaise:
          body.salePricePaise != null ? parseFloat(body.salePricePaise) : existing.salePricePaise,
        purchasePricePaise:
          body.purchasePricePaise != null
            ? parseFloat(body.purchasePricePaise)
            : existing.purchasePricePaise,
        gstRate: body.gstRate != null ? parseFloat(body.gstRate) : existing.gstRate,
        openingStock: newOpening,
        openingRatePaise,
        lowStockAlert:
          body.lowStockAlert != null ? parseFloat(body.lowStockAlert) : existing.lowStockAlert,
        trackBatches: body.trackBatches != null ? Boolean(body.trackBatches) : existing.trackBatches,
        description: body.description ?? existing.description,
      },
    });

    // Changing opening stock changes the quantity on hand, so it must leave a
    // movement. The previous version adjusted currentStock directly and wrote
    // nothing, which put the denormalised quantity out of agreement with the
    // stock ledger that valuation is derived from - visible afterwards only as
    // an unexplained drift figure.
    if (openingDiff !== 0) {
      await recordStockMovement(tx, {
        companyId,
        itemId: params.id,
        direction: openingDiff > 0 ? "IN" : "OUT",
        quantity: Math.abs(openingDiff),
        reference: "Opening",
        notes: `Opening stock revised from ${existing.openingStock} to ${newOpening}`,
        sourceType: "OPENING",
        sourceId: params.id,
        ratePaise: openingRatePaise,
      });
    }

    return updated;
  });

  await logAudit({
    companyId,
    userId: ctx.user.id,
    action: "UPDATE",
    entity: "Item",
    entityId: item.id,
    changes: { name: item.name, openingStock: newOpening },
  });

  return NextResponse.json(item);
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;
  const companyId = ctx.company.id;

  // The previous version deleted by id alone, so any signed-in user could delete
  // an item belonging to a DIFFERENT company by guessing its id. Scope first.
  const existing = await db.item.findFirst({
    where: { id: params.id, companyId },
    select: { id: true, name: true },
  });
  if (!existing) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // Stock movements cascade with the item, so deleting one that has traded would
  // destroy the history behind past valuations. Refuse and let the user stop
  // using it instead.
  const movementCount = await db.stockMovement.count({ where: { companyId, itemId: params.id } });
  if (movementCount > 0) {
    return NextResponse.json(
      {
        error:
          "This item has stock history and cannot be deleted. Set its stock to zero and stop using it instead.",
        code: "HAS_MOVEMENTS",
      },
      { status: 400 }
    );
  }

  try {
    await db.item.delete({ where: { id: params.id } });
    await logAudit({
      companyId,
      userId: ctx.user.id,
      action: "DELETE",
      entity: "Item",
      entityId: params.id,
      changes: { name: existing.name },
    });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Cannot delete — item is used in invoices or purchases." },
      { status: 400 }
    );
  }
}
