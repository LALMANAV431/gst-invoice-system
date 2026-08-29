import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { planActive, invoiceLimitFor, getPlan } from "@/lib/plan";
import { writeGuard } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { createInvoice, ValidationError } from "@/server/services/invoice.service";
import { PeriodLockedError } from "@/server/numbering";
import { parsePagination, paginated } from "@/lib/pagination";

const lineSchema = z.object({
  itemId: z.string().nullish(),
  itemName: z.string().min(1, "Item name is required"),
  hsn: z.string().nullish(),
  quantity: z.coerce.number().positive("Quantity must be greater than zero"),
  unit: z.string().optional(),
  rate: z.union([z.string(), z.number()]),
  discount: z.union([z.string(), z.number()]).optional(),
  gstRate: z.coerce.number().min(0).max(100),
  cessRate: z.coerce.number().min(0).max(500).optional(),
  cessPerUnit: z.union([z.string(), z.number()]).optional(),
  supplyType: z.enum(["TAXABLE", "EXEMPT", "NIL_RATED", "NON_GST", "ZERO_RATED"]).optional(),
  pricingMode: z.enum(["EXCLUSIVE", "INCLUSIVE"]).optional(),
});

const createSchema = z.object({
  partyId: z.string().min(1, "Customer is required"),
  date: z.coerce.date().optional(),
  dueDate: z.coerce.date().nullish(),
  notes: z.string().nullish(),
  items: z.array(lineSchema).min(1, "Add at least one item"),
  discount: z.union([z.string(), z.number()]).optional(),
  additionalCharges: z.union([z.string(), z.number()]).optional(),
  additionalChargesGstRate: z.coerce.number().min(0).max(100).optional(),
  reverseCharge: z.coerce.boolean().optional(),
  tdsRate: z.coerce.number().min(0).max(100).optional(),
  placeOfSupply: z.string().nullish(),
});

export async function GET(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  // Previously this returned every invoice for the company with the party
  // joined, which does not survive a tenant with tens of thousands of invoices.
  const { skip, take, page, pageSize } = parsePagination(req);
  const where = { companyId: ctx.company.id };

  const [rows, total] = await Promise.all([
    db.invoice.findMany({
      where,
      include: { party: { select: { id: true, name: true, gstin: true } } },
      orderBy: { date: "desc" },
      skip,
      take,
    }),
    db.invoice.count({ where }),
  ]);

  return NextResponse.json(paginated(rows, total, page, pageSize));
}

export async function POST(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;

  const company = ctx.company;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = createSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const input = parsed.data;

  // Plan limit: monthly invoice cap.
  const activePlan = planActive(company.plan, company.planExpiry);
  const limit = invoiceLimitFor(activePlan);
  if (limit !== Infinity) {
    const monthStart = new Date();
    monthStart.setDate(1);
    monthStart.setHours(0, 0, 0, 0);
    const usedThisMonth = await db.invoice.count({
      where: { companyId: company.id, date: { gte: monthStart } },
    });
    if (usedThisMonth >= limit) {
      return NextResponse.json(
        {
          error: `You've reached the ${getPlan(activePlan).name} plan limit of ${limit} invoices this month. Upgrade to create more.`,
          code: "PLAN_LIMIT",
          upgrade: true,
        },
        { status: 402 }
      );
    }
  }

  try {
    const invoice = await createInvoice({
      companyId: company.id,
      userId: ctx.user.id,
      partyId: input.partyId,
      date: input.date,
      dueDate: input.dueDate ?? null,
      notes: input.notes ?? null,
      lines: input.items,
      invoiceDiscount: input.discount,
      additionalCharges: input.additionalCharges,
      additionalChargesGstRate: input.additionalChargesGstRate,
      reverseCharge: input.reverseCharge,
      tdsRate: input.tdsRate,
      placeOfSupply: input.placeOfSupply ?? null,
    });

    await logAudit({
      companyId: company.id,
      userId: ctx.user.id,
      action: "CREATE",
      entity: "Invoice",
      entityId: invoice.id,
      changes: { number: invoice.number, grandTotalPaise: invoice.grandTotalPaise },
    });

    return NextResponse.json(invoice);
  } catch (e) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (e instanceof PeriodLockedError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    console.error("[invoices] create failed:", e);
    return NextResponse.json({ error: "Could not create the invoice" }, { status: 500 });
  }
}
