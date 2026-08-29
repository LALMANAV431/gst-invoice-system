import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { writeGuard } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { isValuationMethod } from "@/lib/inventory";

export async function PUT(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;
  const body = await req.json();
  const company = ctx.company;

  // Stock valuation method.
  //
  // Inventory value is DERIVED from the movement ledger rather than stored, so
  // switching method does not just affect future stock - it restates every
  // historical valuation, and with it the gross profit of periods that may
  // already have been reported. AS 2 requires a change of accounting policy to
  // be deliberate and disclosed, so the change is refused unless the caller
  // acknowledges the restatement.
  let stockValuationMethod = company.stockValuationMethod;
  if (body.stockValuationMethod && body.stockValuationMethod !== company.stockValuationMethod) {
    if (!isValuationMethod(body.stockValuationMethod)) {
      return NextResponse.json(
        { error: "Stock valuation method must be FIFO or WEIGHTED_AVERAGE" },
        { status: 400 }
      );
    }
    if (body.acknowledgeRestatement !== true) {
      return NextResponse.json(
        {
          error:
            `Changing the valuation method from ${company.stockValuationMethod} to ` +
            `${body.stockValuationMethod} restates closing stock and cost of goods sold for ` +
            `every past period, because inventory value is recomputed from the stock ledger. ` +
            `AS 2 requires a change of accounting policy to be disclosed in your accounts. ` +
            `Resend with acknowledgeRestatement: true to proceed.`,
          code: "VALUATION_RESTATEMENT",
          from: company.stockValuationMethod,
          to: body.stockValuationMethod,
        },
        { status: 409 }
      );
    }
    stockValuationMethod = body.stockValuationMethod;
  }

  const deadStockDays =
    body.deadStockDays != null
      ? Math.min(Math.max(parseInt(String(body.deadStockDays), 10) || 90, 1), 3650)
      : company.deadStockDays;

  const updated = await db.company.update({
    where: { id: company.id },
    data: {
      name: body.name ?? company.name,
      gstin: body.gstin || null,
      pan: body.pan || null,
      email: body.email || null,
      phone: body.phone || null,
      addressLine1: body.addressLine1 || null,
      addressLine2: body.addressLine2 || null,
      city: body.city || null,
      state: body.state || null,
      stateCode: body.stateCode || null,
      pincode: body.pincode || null,
      invoicePrefix: body.invoicePrefix || "INV",
      purchasePrefix: body.purchasePrefix || "PUR",
      quotationPrefix: body.quotationPrefix || "QUO",
      creditNotePrefix: body.creditNotePrefix || "CN",
      debitNotePrefix: body.debitNotePrefix || "DN",
      expensePrefix: body.expensePrefix || "EXP",
      adjustmentPrefix: body.adjustmentPrefix || company.adjustmentPrefix || "ADJ",
      stockCountPrefix: body.stockCountPrefix || company.stockCountPrefix || "PC",
      bankName: body.bankName || null,
      bankAccountNo: body.bankAccountNo || null,
      bankIfsc: body.bankIfsc || null,
      upiId: body.upiId || null,
      terms: body.terms || null,
      financialYear: body.financialYear || company.financialYear,
      stockValuationMethod,
      deadStockDays,
    },
  });

  if (stockValuationMethod !== company.stockValuationMethod) {
    await logAudit({
      companyId: company.id,
      userId: ctx.user.id,
      action: "UPDATE",
      entity: "Company",
      entityId: company.id,
      changes: {
        stockValuationMethod: { from: company.stockValuationMethod, to: stockValuationMethod },
      },
    });
  }

  return NextResponse.json(updated);
}
