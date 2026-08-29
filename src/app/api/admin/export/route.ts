import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getSuperAdmin } from "@/lib/auth";
import { getEffectivePlans, planActive, type PlanId } from "@/lib/plan";

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
  const admin = await getSuperAdmin();
  if (!admin) return NextResponse.json({ error: "Forbidden" }, { status: 403 });
  const { searchParams } = new URL(req.url);
  const type = searchParams.get("type") || "companies";

  if (type === "companies") {
    const plans = await getEffectivePlans();
    const companies = await db.company.findMany({
      orderBy: { createdAt: "desc" },
      include: {
        owner: { select: { name: true, email: true } },
        _count: { select: { invoices: true } },
      },
    });
    const headers = ["Company", "GSTIN", "Owner", "Email", "Plan", "Monthly Price (paise)", "Suspended", "Invoices", "Joined"];
    const rows = companies.map((c) => {
      const active = planActive(c.plan, c.planExpiry) as PlanId;
      return [
        c.name,
        c.gstin || "",
        c.owner.name,
        c.owner.email,
        active,
        // Paise, matching every other money column in the export.
        plans[active]?.priceMonthlyPaise || 0,
        c.isSuspended ? "Yes" : "No",
        c._count.invoices,
        new Date(c.createdAt).toLocaleDateString("en-IN"),
      ];
    });
    return new NextResponse(toCSV(headers, rows), {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": 'attachment; filename="platform-companies.csv"',
      },
    });
  }

  return NextResponse.json({ error: "Invalid type" }, { status: 400 });
}
