import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";

// Match a bank transaction to a payment
export async function POST(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const body = await req.json();
  const { bankTransactionId, paymentId } = body;

  if (!bankTransactionId) return NextResponse.json({ error: "bankTransactionId required" }, { status: 400 });

  await db.bankTransaction.update({
    where: { id: bankTransactionId },
    data: { isMatched: true, matchedPaymentId: paymentId || null },
  });

  return NextResponse.json({ ok: true });
}
