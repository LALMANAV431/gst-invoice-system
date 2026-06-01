import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";

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
  const body = await req.json();
  if (!body.name) return NextResponse.json({ error: "Name required" }, { status: 400 });
  const opening = parseFloat(body.openingStock) || 0;
  const item = await db.item.create({
    data: {
      companyId: ctx.company.id,
      name: body.name,
      sku: body.sku || null,
      hsn: body.hsn || null,
      unit: body.unit || "NOS",
      salePrice: parseFloat(body.salePrice) || 0,
      purchasePrice: parseFloat(body.purchasePrice) || 0,
      gstRate: parseFloat(body.gstRate) || 0,
      openingStock: opening,
      currentStock: opening,
      lowStockAlert: parseFloat(body.lowStockAlert) || 0,
      description: body.description || null,
    },
  });
  return NextResponse.json(item);
}
