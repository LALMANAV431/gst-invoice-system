import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";

// Bulk import items from parsed CSV rows.
// Expected keys (case-insensitive): name, sku, hsn, barcode, unit, salePrice, purchasePrice, gstRate, openingStock, lowStockAlert
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
      await db.item.create({
        data: {
          companyId: ctx.company.id,
          name,
          sku: (norm(r, "sku", "code") || "")?.toString() || null,
          hsn: (norm(r, "hsn") || "")?.toString() || null,
          barcode: (norm(r, "barcode", "ean", "upc") || "")?.toString() || null,
          unit: (norm(r, "unit") || "NOS")?.toString() || "NOS",
          salePrice: parseFloat(norm(r, "saleprice", "sellingprice", "mrp", "rate")) || 0,
          purchasePrice: parseFloat(norm(r, "purchaseprice", "costprice", "cost")) || 0,
          gstRate: parseFloat(norm(r, "gstrate", "gst", "tax")) || 0,
          openingStock: opening,
          currentStock: opening,
          lowStockAlert: parseFloat(norm(r, "lowstockalert", "reorder", "minstock")) || 0,
        },
      });
      created++;
    } catch (e: any) {
      errors.push(`Row ${i + 1}: ${e.message?.slice(0, 60) || "failed"}`);
      skipped++;
    }
  }

  return NextResponse.json({ created, skipped, errors: errors.slice(0, 5) });
}
