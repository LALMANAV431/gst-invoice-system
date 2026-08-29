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
import { buildCreditNotePosting } from "@/lib/accounting";
import { parsePagination, paginated } from "@/lib/pagination";
import { estimateCostRate, recordStockMovement } from "@/server/stock";

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
  partyId: z.string().min(1, "Party is required"),
  kind: z.enum(["CREDIT", "DEBIT"]).optional(),
  date: z.coerce.date().optional(),
  reason: z.string().nullish(),
  originalRef: z.string().nullish(),
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

  const { searchParams } = new URL(req.url);
  const kind = searchParams.get("kind");
  const where: { companyId: string; kind?: string } = { companyId: ctx.company.id };
  if (kind === "CREDIT" || kind === "DEBIT") where.kind = kind;

  const { skip, take, page, pageSize } = parsePagination(req);
  const [rows, total] = await Promise.all([
    db.creditNote.findMany({
      where,
      include: { party: { select: { id: true, name: true, gstin: true } } },
      orderBy: { date: "desc" },
      skip,
      take,
    }),
    db.creditNote.count({ where }),
  ]);

  return NextResponse.json(paginated(rows, total, page, pageSize));
}

export async function POST(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // This route previously had no write guard.
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
  const noteKind = input.kind === "DEBIT" ? "DEBIT" : "CREDIT";
  const date = input.date ?? new Date();

  const party = await db.party.findFirst({
    where: { id: input.partyId, companyId: company.id },
    select: { id: true, name: true, type: true, stateCode: true, balanceType: true },
  });
  if (!party) return NextResponse.json({ error: "Invalid party" }, { status: 400 });

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
      isComposition: company.gstScheme === "COMPOSITION",
    });

    const note = await db.$transaction(async (tx) => {
      const { number } = await allocateDocumentNumber(tx, {
        companyId: company.id,
        documentType: noteKind === "DEBIT" ? "DEBIT" : "CREDIT",
        prefix: noteKind === "DEBIT" ? company.debitNotePrefix : company.creditNotePrefix,
        date,
      });

      const created = await tx.creditNote.create({
        data: {
          companyId: company.id,
          partyId: party.id,
          number,
          kind: noteKind,
          date,
          reason: input.reason ?? null,
          originalRef: input.originalRef ?? null,
          notes: input.notes ?? null,
          ...header,
          items: { create: lines },
        },
        include: { items: true },
      });

      // CREDIT (sales return) -> goods come back IN.
      // DEBIT (purchase return) -> goods go back OUT.
      const movementType = noteKind === "CREDIT" ? "IN" : "OUT";
      for (const line of lines) {
        if (!line.itemId) continue;
        // A sales return comes back at COST, not at the price we credited: a
        // credit note states what the customer is owed, which includes our
        // margin. A purchase return leaves at cost, which the engine derives.
        const ratePaise =
          movementType === "IN"
            ? await estimateCostRate(tx, company.id, line.itemId)
            : undefined;
        await recordStockMovement(tx, {
          companyId: company.id,
          itemId: line.itemId,
          direction: movementType,
          quantity: line.quantity,
          date,
          reference: number,
          notes: `${noteKind === "CREDIT" ? "Sales return" : "Purchase return"}: ${number}`,
          sourceType: noteKind === "CREDIT" ? "SALES_RETURN" : "PURCHASE_RETURN",
          sourceId: created.id,
          ratePaise,
        });
      }

      await ensureChartOfAccounts(tx, company.id);
      const partyLedger = await ensurePartyLedger(tx, company.id, party);

      const posting = buildCreditNotePosting({
        partyLedger: partyLedger.name,
        date,
        number,
        creditNoteId: created.id,
        kind: noteKind,
        taxablePaise: header.subTotalPaise + header.additionalChargesPaise,
        cgstPaise: header.cgstTotalPaise,
        sgstPaise: header.sgstTotalPaise,
        igstPaise: header.igstTotalPaise,
        cessPaise: header.cessTotalPaise,
        roundOffPaise: header.roundOffPaise,
        grandTotalPaise: header.grandTotalPaise,
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
      entity: "CreditNote",
      entityId: note.id,
      changes: { number: note.number, kind: noteKind, grandTotalPaise: note.grandTotalPaise },
    });

    return NextResponse.json(note);
  } catch (e) {
    if (e instanceof PeriodLockedError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    console.error("[credit-notes] create failed:", e);
    return NextResponse.json({ error: "Could not create the note" }, { status: 500 });
  }
}
