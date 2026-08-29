import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { writeGuard } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { computeDocument } from "@/server/services/document.service";
import { allocateDocumentNumber, assertPeriodOpen, PeriodLockedError } from "@/server/numbering";
import {
  ensureChartOfAccounts,
  ensurePartyLedger,
  postJournalEntry,
} from "@/server/ledger";
import { buildPurchasePosting } from "@/lib/accounting";
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
  partyId: z.string().min(1, "Supplier is required"),
  vendorBillNo: z.string().nullish(),
  date: z.coerce.date().optional(),
  dueDate: z.coerce.date().nullish(),
  notes: z.string().nullish(),
  items: z.array(lineSchema).min(1, "Add at least one item"),
  discount: z.union([z.string(), z.number()]).optional(),
  additionalCharges: z.union([z.string(), z.number()]).optional(),
  reverseCharge: z.coerce.boolean().optional(),
  itcEligible: z.coerce.boolean().optional(),
  placeOfSupply: z.string().nullish(),
});

export async function GET(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { skip, take, page, pageSize } = parsePagination(req);
  const where = { companyId: ctx.company.id };

  const [rows, total] = await Promise.all([
    db.purchase.findMany({
      where,
      include: { party: { select: { id: true, name: true, gstin: true } } },
      orderBy: { date: "desc" },
      skip,
      take,
    }),
    db.purchase.count({ where }),
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
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }
  const input = parsed.data;
  const date = input.date ?? new Date();

  const party = await db.party.findFirst({
    where: { id: input.partyId, companyId: company.id },
    select: { id: true, name: true, type: true, stateCode: true, balanceType: true },
  });
  if (!party) return NextResponse.json({ error: "Invalid supplier" }, { status: 400 });

  try {
    await assertPeriodOpen(db, company.id, date);

    const { header, lines } = computeDocument({
      supplierStateCode: company.stateCode,
      partyStateCode: party.stateCode,
      placeOfSupply: input.placeOfSupply,
      lines: input.items,
      invoiceDiscount: input.discount,
      additionalCharges: input.additionalCharges,
      reverseCharge: input.reverseCharge,
      roundToNearestRupee: company.roundInvoices,
    });

    const itcEligible = input.itcEligible ?? true;

    const purchase = await db.$transaction(async (tx) => {
      const { number } = await allocateDocumentNumber(tx, {
        companyId: company.id,
        documentType: "PURCHASE",
        prefix: company.purchasePrefix,
        date,
      });

      const created = await tx.purchase.create({
        data: {
          companyId: company.id,
          partyId: party.id,
          number,
          vendorBillNo: input.vendorBillNo ?? null,
          date,
          dueDate: input.dueDate ?? null,
          notes: input.notes ?? null,
          status: "UNPAID",
          itcEligible,
          ...header,
          items: { create: lines },
        },
        include: { items: true },
      });

      // Stock in.
      for (const line of lines) {
        if (!line.itemId) continue;
        await tx.item.update({
          where: { id: line.itemId },
          data: { currentStock: { increment: line.quantity } },
        });
        await tx.stockMovement.create({
          data: {
            companyId: company.id,
            itemId: line.itemId,
            type: "IN",
            quantity: line.quantity,
            reference: number,
            notes: `Purchase: ${number}`,
            date,
          },
        });
      }

      await ensureChartOfAccounts(tx, company.id);
      const partyLedger = await ensurePartyLedger(tx, company.id, party);

      const posting = buildPurchasePosting({
        partyLedger: partyLedger.name,
        date,
        number,
        purchaseId: created.id,
        taxablePaise: header.subTotalPaise,
        cgstPaise: header.cgstTotalPaise,
        sgstPaise: header.sgstTotalPaise,
        igstPaise: header.igstTotalPaise,
        cessPaise: header.cessTotalPaise,
        additionalChargesPaise: header.additionalChargesPaise,
        roundOffPaise: header.roundOffPaise,
        grandTotalPaise: header.grandTotalPaise,
        itcEligible,
      });

      await postJournalEntry(tx, {
        companyId: company.id,
        userId: ctx.user.id,
        posting,
        voucherNo: number,
        journalPrefix: company.journalPrefix,
      });

      return created;
    });

    await logAudit({
      companyId: company.id,
      userId: ctx.user.id,
      action: "CREATE",
      entity: "Purchase",
      entityId: purchase.id,
      changes: { number: purchase.number, grandTotalPaise: purchase.grandTotalPaise },
    });

    return NextResponse.json(purchase);
  } catch (e) {
    if (e instanceof PeriodLockedError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    console.error("[purchases] create failed:", e);
    return NextResponse.json({ error: "Could not create the purchase" }, { status: 500 });
  }
}
