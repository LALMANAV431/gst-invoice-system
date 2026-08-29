import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { writeGuard } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { computeDocument } from "@/server/services/document.service";
import { allocateDocumentNumber } from "@/server/numbering";
import { parsePagination, paginated } from "@/lib/pagination";

const lineSchema = z.object({
  itemId: z.string().nullish(),
  itemName: z.string().min(1),
  hsn: z.string().nullish(),
  quantity: z.coerce.number().positive(),
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
  validUntil: z.coerce.date().nullish(),
  notes: z.string().nullish(),
  items: z.array(lineSchema).min(1, "Add at least one item"),
  discount: z.union([z.string(), z.number()]).optional(),
  additionalCharges: z.union([z.string(), z.number()]).optional(),
  reverseCharge: z.coerce.boolean().optional(),
  placeOfSupply: z.string().nullish(),
});

export async function GET(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { skip, take, page, pageSize } = parsePagination(req);
  const where = { companyId: ctx.company.id };

  const [rows, total] = await Promise.all([
    db.quotation.findMany({
      where,
      include: { party: { select: { id: true, name: true, gstin: true } } },
      orderBy: { date: "desc" },
      skip,
      take,
    }),
    db.quotation.count({ where }),
  ]);

  return NextResponse.json(paginated(rows, total, page, pageSize));
}

export async function POST(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // This route previously had no write guard, so a VIEWER or a suspended
  // company could still create quotations.
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
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }
  const input = parsed.data;
  const date = input.date ?? new Date();

  const party = await db.party.findFirst({
    where: { id: input.partyId, companyId: company.id },
    select: { id: true, stateCode: true },
  });
  if (!party) return NextResponse.json({ error: "Invalid customer" }, { status: 400 });

  try {
    const { header, lines } = computeDocument({
      supplierStateCode: company.stateCode,
      partyStateCode: party.stateCode,
      placeOfSupply: input.placeOfSupply,
      lines: input.items,
      invoiceDiscount: input.discount,
      additionalCharges: input.additionalCharges,
      reverseCharge: input.reverseCharge,
      roundToNearestRupee: company.roundInvoices,
      isComposition: company.gstScheme === "COMPOSITION",
    });

    // A quotation is not a financial transaction, so it gets no ledger posting
    // and no stock movement. Both happen when it converts to an invoice.
    const quotation = await db.$transaction(async (tx) => {
      const { number } = await allocateDocumentNumber(tx, {
        companyId: company.id,
        documentType: "QUOTATION",
        prefix: company.quotationPrefix,
        date,
      });

      return tx.quotation.create({
        data: {
          companyId: company.id,
          partyId: party.id,
          number,
          date,
          validUntil: input.validUntil ?? null,
          notes: input.notes ?? null,
          status: "OPEN",
          ...header,
          items: { create: lines },
        },
      });
    });

    await logAudit({
      companyId: company.id,
      userId: ctx.user.id,
      action: "CREATE",
      entity: "Quotation",
      entityId: quotation.id,
      changes: { number: quotation.number, grandTotalPaise: quotation.grandTotalPaise },
    });

    return NextResponse.json(quotation);
  } catch (e) {
    console.error("[quotations] create failed:", e);
    return NextResponse.json({ error: "Could not create the quotation" }, { status: 500 });
  }
}
