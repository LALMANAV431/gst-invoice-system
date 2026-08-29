import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { recordOpeningStock } from "@/server/services/inventory.service";

// Bulk import items from parsed CSV rows.
// Expected keys (case-insensitive): name, sku, hsn, barcode, unit, salePricePaise, purchasePricePaise, gstRate, openingStock, lowStockAlert
export async function POST(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const rows: any[] = Array.isArray(body.rows) ? body.rows : [];
  if (rows.length === 0)
    return NextResponse.json({ error: "No rows to import" }, { status: 400 });

  const norm = (r: any, ...keys: string[]) => {
    for (const k of Object.keys(r)) {
      const lk = k.trim().toLowerCase().replace(/\s+/g, "");
      if (keys.some((key) => key.toLowerCase().replace(/\s+/g, "") === lk)) return r[k];
    }
    return undefined;
  };

  let created = 0;
  let skipped = 0;
  const errors: string[] = [];

  for (const [i, r] of rows.entries()) {
    const name = (norm(r, "name", "itemname", "item") || "").toString().trim();
    if (!name) {
      skipped++;
      continue;
    }
    try {
      const opening = parseFloat(norm(r, "openingstock", "stock", "qty")) || 0;
      const purchasePricePaise = parseFloat(norm(r, "purchaseprice", "costprice", "cost")) || 0;
      // Imported opening stock is valued at the imported cost price, and gets a
      // real OPENING movement so valuation does not have to infer it.
      const openingRatePaise =
        parseFloat(norm(r, "openingrate", "openingcost")) || purchasePricePaise;

      await db.$transaction(async (tx) => {
        const item = await tx.item.create({
          data: {
            companyId: ctx.company!.id,
            name,
            sku: (norm(r, "sku", "code") || "")?.toString() || null,
            hsn: (norm(r, "hsn") || "")?.toString() || null,
            barcode: (norm(r, "barcode", "ean", "upc") || "")?.toString() || null,
            unit: (norm(r, "unit") || "NOS")?.toString() || "NOS",
            salePricePaise: parseFloat(norm(r, "saleprice", "sellingprice", "mrp", "rate")) || 0,
            purchasePricePaise,
            gstRate: parseFloat(norm(r, "gstrate", "gst", "tax")) || 0,
            openingStock: opening,
            openingRatePaise,
            currentStock: opening,
            lowStockAlert: parseFloat(norm(r, "lowstockalert", "reorder", "minstock")) || 0,
          },
        });
        if (opening !== 0) {
          await recordOpeningStock(tx, {
            companyId: ctx.company!.id,
            itemId: item.id,
            quantity: opening,
            ratePaise: openingRatePaise,
          });
        }
      });
      created++;
    } catch (e: any) {
      errors.push(`Row ${i + 1}: ${e.message?.slice(0, 60) || "failed"}`);
      skipped++;
    }
  }

  return NextResponse.json({ created, skipped, errors: errors.slice(0, 5) });
}
