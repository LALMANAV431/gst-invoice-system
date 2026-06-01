import { db } from "./db";

export async function nextInvoiceNumber(companyId: string, prefix: string) {
  const last = await db.invoice.findFirst({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    select: { number: true },
  });
  return computeNext(prefix, last?.number);
}

export async function nextPurchaseNumber(companyId: string, prefix: string) {
  const last = await db.purchase.findFirst({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    select: { number: true },
  });
  return computeNext(prefix, last?.number);
}

export async function nextPaymentNumber(companyId: string, prefix: string) {
  const last = await db.payment.findFirst({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    select: { number: true },
  });
  return computeNext(prefix, last?.number);
}

function computeNext(prefix: string, lastNumber?: string) {
  if (!lastNumber) return `${prefix}-0001`;
  const m = lastNumber.match(/(\d+)$/);
  const n = m ? parseInt(m[1], 10) + 1 : 1;
  return `${prefix}-${String(n).padStart(4, "0")}`;
}


export async function nextQuotationNumber(companyId: string, prefix: string) {
  const last = await db.quotation.findFirst({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    select: { number: true },
  });
  return computeNext(prefix, last?.number);
}

export async function nextCreditNoteNumber(companyId: string, prefix: string, kind: string) {
  const last = await db.creditNote.findFirst({
    where: { companyId, kind },
    orderBy: { createdAt: "desc" },
    select: { number: true },
  });
  return computeNext(prefix, last?.number);
}

export async function nextExpenseNumber(companyId: string, prefix: string) {
  const last = await db.expense.findFirst({
    where: { companyId },
    orderBy: { createdAt: "desc" },
    select: { number: true },
  });
  return computeNext(prefix, last?.number);
}
