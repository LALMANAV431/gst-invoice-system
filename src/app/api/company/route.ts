import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";

export async function PUT(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const updated = await db.company.update({
    where: { id: ctx.company.id },
    data: {
      name: body.name ?? ctx.company.name,
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
      bankName: body.bankName || null,
      bankAccountNo: body.bankAccountNo || null,
      bankIfsc: body.bankIfsc || null,
      upiId: body.upiId || null,
      terms: body.terms || null,
      financialYear: body.financialYear || ctx.company.financialYear,
    },
  });
  return NextResponse.json(updated);
}
