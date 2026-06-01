import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";

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

    // Record stock movements
    await tx.stockMovement.create({
      data: {
        companyId: ctx.company!.id,
        itemId,
        type: "OUT",
        quantity: qty,
        reference: `Transfer to ${toGodownId}`,
        notes: `Stock transfer: ${notes || ""}`,
      },
    });
    await tx.stockMovement.create({
      data: {
        companyId: ctx.company!.id,
        itemId,
        type: "IN",
        quantity: qty,
        reference: `Transfer from ${fromGodownId}`,
        notes: `Stock transfer: ${notes || ""}`,
      },
    });

    return created;
  });

  return NextResponse.json(transfer);
}
