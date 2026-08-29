import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { writeGuard } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { PeriodLockedError } from "@/server/numbering";
import { ValidationError } from "@/server/services/invoice.service";
import {
  createOrderDocument,
  DOC_CONFIG,
  type OrderDocType,
} from "@/server/services/order.service";
import { parsePagination, paginated } from "@/lib/pagination";

/**
 * Sales orders, delivery challans, purchase orders and goods receipt notes.
 *
 * One endpoint for all four, discriminated by `docType`, matching the single
 * service and single table behind them.
 */

const DOC_TYPES = ["SALES_ORDER", "DELIVERY_CHALLAN", "PURCHASE_ORDER", "GRN"] as const;

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
  docType: z.enum(DOC_TYPES),
  partyId: z.string().min(1, "Party is required"),
  date: z.coerce.date().optional(),
  expectedDate: z.coerce.date().nullish(),
  notes: z.string().nullish(),
  externalRef: z.string().max(60).nullish(),
  transporterName: z.string().max(120).nullish(),
  vehicleNumber: z.string().max(30).nullish(),
  movementReason: z
    .enum(["JOB_WORK", "APPROVAL", "BRANCH_TRANSFER", "REPLACEMENT", "OTHER"])
    .nullish(),
  godownId: z.string().nullish(),
  sourceDocumentId: z.string().nullish(),
  items: z.array(lineSchema).min(1, "Add at least one item"),
  discount: z.union([z.string(), z.number()]).optional(),
  additionalCharges: z.union([z.string(), z.number()]).optional(),
  reverseCharge: z.coerce.boolean().optional(),
  placeOfSupply: z.string().nullish(),
});

export async function GET(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const docType = searchParams.get("docType");
  const status = searchParams.get("status");
  const pendingOnly = searchParams.get("pending") === "true";

  const where: {
    companyId: string;
    docType?: string;
    status?: string | { not: string };
    convertedToId?: null;
  } = { companyId: ctx.company.id };

  if (docType && (DOC_TYPES as readonly string[]).includes(docType)) where.docType = docType;
  if (status) where.status = status;
  // "Pending" means still actionable: not converted and not cancelled.
  if (pendingOnly) {
    where.convertedToId = null;
    where.status = { not: "CANCELLED" };
  }

  const { skip, take, page, pageSize } = parsePagination(req);
  const [rows, total] = await Promise.all([
    db.orderDocument.findMany({
      where,
      include: {
        party: { select: { id: true, name: true, gstin: true } },
        items: { select: { id: true, quantity: true, fulfilledQuantity: true } },
      },
      orderBy: { date: "desc" },
      skip,
      take,
    }),
    db.orderDocument.count({ where }),
  ]);

  return NextResponse.json(paginated(rows, total, page, pageSize));
}

export async function POST(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;

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

  try {
    const doc = await createOrderDocument({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      docType: input.docType as OrderDocType,
      partyId: input.partyId,
      date: input.date,
      expectedDate: input.expectedDate ?? null,
      notes: input.notes ?? null,
      externalRef: input.externalRef ?? null,
      transporterName: input.transporterName ?? null,
      vehicleNumber: input.vehicleNumber ?? null,
      movementReason: input.movementReason ?? null,
      godownId: input.godownId ?? null,
      sourceDocumentId: input.sourceDocumentId ?? null,
      lines: input.items,
      discount: input.discount,
      additionalCharges: input.additionalCharges,
      reverseCharge: input.reverseCharge,
      placeOfSupply: input.placeOfSupply ?? null,
    });

    await logAudit({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      action: "CREATE",
      entity: "OrderDocument",
      entityId: doc.id,
      changes: {
        docType: input.docType,
        number: doc.number,
        grandTotalPaise: doc.grandTotalPaise,
      },
    });

    return NextResponse.json({ ...doc, label: DOC_CONFIG[input.docType as OrderDocType].label });
  } catch (e) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (e instanceof PeriodLockedError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    console.error("[orders] create failed:", e);
    return NextResponse.json({ error: "Could not create the document" }, { status: 500 });
  }
}
