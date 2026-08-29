import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { hasFeature, planActive } from "@/lib/plan";
import { estimateCostRate, recordStockMovement } from "@/server/stock";

export async function GET() {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const transfers = await db.stockTransfer.findMany({
    where: { companyId: ctx.company.id },
    orderBy: { date: "desc" },
  });
  return NextResponse.json(transfers);
}

export async function POST(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  if (!hasFeature(planActive(ctx.company.plan, ctx.company.planExpiry), "godowns"))
    return NextResponse.json(
      { error: "Stock transfer requires the Basic plan. Please upgrade.", code: "PLAN_LIMIT", upgrade: true },
      { status: 402 }
    );
  const body = await req.json();
  const { itemId, fromGodownId, toGodownId, quantity, notes, date } = body;

  if (!itemId || !fromGodownId || !toGodownId || !quantity)
    return NextResponse.json({ error: "Missing required fields" }, { status: 400 });
  if (fromGodownId === toGodownId)
    return NextResponse.json({ error: "From and To godown must be different" }, { status: 400 });

  const qty = parseFloat(quantity);
  if (qty <= 0) return NextResponse.json({ error: "Quantity must be > 0" }, { status: 400 });

  const transfer = await db.$transaction(async (tx) => {
    const created = await tx.stockTransfer.create({
      data: {
        companyId: ctx.company!.id,
        itemId,
        fromGodownId,
        toGodownId,
        quantity: qty,
        notes: notes || null,
        date: date ? new Date(date) : new Date(),
      },
    });

    // A transfer is one movement out of the source godown and one into the
    // destination. Company-level quantity is unchanged, so the pair must use the
    // SAME cost: valuing the receipt independently would create or destroy value
    // by moving goods between our own shelves.
    const ratePaise = await estimateCostRate(tx, ctx.company!.id, itemId);
    const fromName = (await tx.godown.findUnique({ where: { id: fromGodownId }, select: { name: true } }))?.name ?? "godown";
    const toName = (await tx.godown.findUnique({ where: { id: toGodownId }, select: { name: true } }))?.name ?? "godown";

    await recordStockMovement(tx, {
      companyId: ctx.company!.id,
      itemId,
      direction: "OUT",
      quantity: qty,
      date: created.date,
      reference: `Transfer to ${toName}`,
      notes: `Stock transfer: ${notes || ""}`,
      sourceType: "TRANSFER",
      sourceId: created.id,
      godownId: fromGodownId,
    });
    await recordStockMovement(tx, {
      companyId: ctx.company!.id,
      itemId,
      direction: "IN",
      quantity: qty,
      date: created.date,
      reference: `Transfer from ${fromName}`,
      notes: `Stock transfer: ${notes || ""}`,
      sourceType: "TRANSFER",
      sourceId: created.id,
      godownId: toGodownId,
      ratePaise,
    });

    return created;
  });

  return NextResponse.json(transfer);
}
