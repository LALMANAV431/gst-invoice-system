import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { toRupees } from "@/lib/money";

function toCSV(headers: string[], rows: (string | number)[][]) {
  const csv = [
    headers.join(","),
    ...rows.map((r) =>
      r.map((c) => {
        const s = String(c ?? "").replace(/"/g, '""');
        return s.includes(",") || s.includes('"') ? `"${s}"` : s;
      }).join(",")
    ),
  ].join("\n");
  return "\uFEFF" + csv;
}

export async function GET(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type");
  const companyId = ctx.company.id;

  let csv = "";
  let filename = "export.csv";

  switch (type) {
    case "parties": {
      const data = await db.party.findMany({ where: { companyId }, orderBy: { name: "asc" } });
      const headers = ["Name", "Type", "GSTIN", "Phone", "Email", "City", "State", "Opening Balance"];
      const rows = data.map((p) => [p.name, p.type, p.gstin || "", p.phone || "", p.email || "", p.city || "", p.state || "", p.openingBalancePaise]);
      csv = toCSV(headers, rows);
      filename = "parties.csv";
      break;
    }
    case "items": {
      const data = await db.item.findMany({ where: { companyId }, orderBy: { name: "asc" } });
      const headers = ["Name", "SKU", "HSN", "Barcode", "Unit", "Sale Price", "Purchase Price", "GST Rate", "Current Stock"];
      const rows = data.map((i) => [i.name, i.sku || "", i.hsn || "", i.barcode || "", i.unit, i.salePricePaise, i.purchasePricePaise, i.gstRate, i.currentStock]);
      csv = toCSV(headers, rows);
      filename = "items.csv";
      break;
    }
    case "invoices": {
      const data = await db.invoice.findMany({ where: { companyId }, include: { party: true }, orderBy: { date: "desc" } });
      const headers = ["Invoice #", "Date", "Party", "GSTIN", "Subtotal", "Tax", "Total", "Status", "Amount Paid"];
      const rows = data.map((i) => [i.number, new Date(i.date).toLocaleDateString("en-IN"), i.party.name, i.party.gstin || "", i.subTotalPaise, i.taxTotalPaise, i.grandTotalPaise, i.status, i.amountPaidPaise]);
      csv = toCSV(headers, rows);
      filename = "invoices.csv";
      break;
    }
    case "purchases": {
      const data = await db.purchase.findMany({ where: { companyId }, include: { party: true }, orderBy: { date: "desc" } });
      const headers = ["Purchase #", "Date", "Vendor", "GSTIN", "Subtotal", "Tax", "Total", "Status"];
      const rows = data.map((p) => [p.number, new Date(p.date).toLocaleDateString("en-IN"), p.party.name, p.party.gstin || "", p.subTotalPaise, p.taxTotalPaise, p.grandTotalPaise, p.status]);
      csv = toCSV(headers, rows);
      filename = "purchases.csv";
      break;
    }
    case "payments": {
      const data = await db.payment.findMany({ where: { companyId }, include: { party: true }, orderBy: { date: "desc" } });
      const headers = ["Payment #", "Date", "Party", "Type", "Mode", "Amount", "Reference"];
      const rows = data.map((p) => [p.number, new Date(p.date).toLocaleDateString("en-IN"), p.party.name, p.type, p.mode, toRupees(p.amountPaise).toFixed(2), p.reference || ""]);
      csv = toCSV(headers, rows);
      filename = "payments.csv";
      break;
    }
    default:
      return NextResponse.json({ error: "Invalid type. Use: parties, items, invoices, purchases, payments" }, { status: 400 });
  }

  return new NextResponse(csv, {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="${filename}"`,
    },
  });
}
