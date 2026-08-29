import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";

// Bulk import parties from parsed CSV rows.
// Expected keys (case-insensitive): name, type, gstin, phone, email, city, state, stateCode, openingBalancePaise
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
    const name = (norm(r, "name", "partyname", "customer", "vendor") || "").toString().trim();
    if (!name) {
      skipped++;
      continue;
    }
    const rawType = (norm(r, "type") || "CUSTOMER").toString().toUpperCase();
    const type = ["CUSTOMER", "VENDOR", "BOTH"].includes(rawType) ? rawType : "CUSTOMER";
    const gstin = (norm(r, "gstin", "gst") || "")?.toString() || null;
    try {
      await db.party.create({
        data: {
          companyId: ctx.company.id,
          name,
          type,
          gstin,
          phone: (norm(r, "phone", "mobile", "contact") || "")?.toString() || null,
          email: (norm(r, "email") || "")?.toString() || null,
          city: (norm(r, "city") || "")?.toString() || null,
          state: (norm(r, "state") || "")?.toString() || null,
          stateCode:
            (norm(r, "statecode") || "")?.toString() ||
            (gstin ? gstin.slice(0, 2) : null),
          openingBalancePaise: parseFloat(norm(r, "openingbalance", "balance", "opening")) || 0,
          balanceType: type === "VENDOR" ? "PAYABLE" : "RECEIVABLE",
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
