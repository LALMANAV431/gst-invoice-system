import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { ask } from "@/server/ai/service";
import { AiBudgetExceededError, AiUnavailableError } from "@/server/ai/types";
import { toRupees } from "@/lib/money";
import { getGstSummary, getTrialBalance } from "@/server/ledger";
import { financialYearRange } from "@/server/numbering";

const schema = z.object({
  question: z.string().min(1, "Ask a question").max(500),
});

/**
 * Natural-language questions about the tenant's own books, in Hindi or English.
 *
 * HOW THIS AVOIDS HALLUCINATED FIGURES
 * ------------------------------------
 * The model is never asked to compute anything. A compact, factual summary of the
 * tenant's position is gathered from the ledger first and passed in as context;
 * the model's only job is to answer in natural language using those numbers.
 *
 * This matters because a confident wrong number in an accounting app is worse
 * than no answer. It also keeps prompts small, which keeps cost predictable.
 */
export async function POST(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const companyId = ctx.company.id;

  try {
    const context = await buildBusinessContext(companyId);

    const result = await ask({
      companyId,
      userId: ctx.user.id,
      feature: "ASSISTANT",
      system:
        "You are an accounting assistant for a small Indian business. " +
        "Answer ONLY from the FACTS provided. Never invent or recompute a figure. " +
        "If the facts do not contain the answer, say which report the user should open. " +
        "Reply in the same language as the question (Hindi or English). " +
        "Keep GST terms (CGST, SGST, IGST, HSN, GSTIN) in English. Be brief.",
      prompt: `FACTS:\n${context}\n\nQUESTION: ${parsed.data.question}`,
    });

    return NextResponse.json({
      answer: result.text,
      provider: result.provider,
      mock: result.mock,
      cached: result.cached,
    });
  } catch (e) {
    if (e instanceof AiUnavailableError) {
      return NextResponse.json({ error: e.message, available: false }, { status: 503 });
    }
    if (e instanceof AiBudgetExceededError) {
      return NextResponse.json(
        { error: e.message, code: "AI_BUDGET", upgrade: true },
        { status: 402 }
      );
    }
    console.error("[ai/assistant] failed:", e);
    return NextResponse.json({ error: "Could not answer that right now" }, { status: 500 });
  }
}

/**
 * Gather the numbers a business question is likely to need.
 *
 * Deliberately compact: every extra line is tokens spent on every question.
 */
async function buildBusinessContext(companyId: string): Promise<string> {
  const now = new Date();
  const todayStart = new Date(now);
  todayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const fy = financialYearRange(now);

  const [today, month, receivables, payables, lowStock, topItems, gst, tb] = await Promise.all([
    db.invoice.aggregate({
      where: { companyId, date: { gte: todayStart }, status: { not: "CANCELLED" } },
      _sum: { grandTotalPaise: true },
      _count: true,
    }),
    db.invoice.aggregate({
      where: { companyId, date: { gte: monthStart }, status: { not: "CANCELLED" } },
      _sum: { grandTotalPaise: true },
      _count: true,
    }),
    db.invoice.aggregate({
      where: { companyId, status: { notIn: ["PAID", "CANCELLED"] } },
      _sum: { grandTotalPaise: true, amountPaidPaise: true },
    }),
    db.purchase.aggregate({
      where: { companyId, status: { not: "PAID" } },
      _sum: { grandTotalPaise: true, amountPaidPaise: true },
    }),
    db.item.findMany({
      where: { companyId, lowStockAlert: { gt: 0 } },
      select: { name: true, currentStock: true, lowStockAlert: true },
      take: 40,
    }),
    db.invoiceItem.groupBy({
      by: ["itemName"],
      where: { invoice: { companyId, date: { gte: monthStart } } },
      _sum: { totalPaise: true },
      orderBy: { _sum: { totalPaise: "desc" } },
      take: 5,
    }),
    getGstSummary(companyId, monthStart, now),
    getTrialBalance(companyId, now),
  ]);

  const rs = (paise: number | null | undefined) => `Rs ${toRupees(paise ?? 0).toFixed(2)}`;
  const below = lowStock.filter((i) => i.currentStock <= i.lowStockAlert);

  return [
    `Today's sales: ${rs(today._sum.grandTotalPaise)} across ${today._count} invoices`,
    `This month's sales: ${rs(month._sum.grandTotalPaise)} across ${month._count} invoices`,
    `Receivables outstanding: ${rs((receivables._sum.grandTotalPaise ?? 0) - (receivables._sum.amountPaidPaise ?? 0))}`,
    `Payables outstanding: ${rs((payables._sum.grandTotalPaise ?? 0) - (payables._sum.amountPaidPaise ?? 0))}`,
    `GST this month - output: ${rs(gst.outputTotalPaise)}, input credit: ${rs(gst.inputTotalPaise)}, net payable: ${rs(gst.netPayablePaise)}`,
    `Books balanced: ${tb.isBalanced ? "yes" : "NO - there is a data problem"}`,
    `Financial year: ${fy.label}`,
    below.length
      ? `Items at or below reorder level (${below.length}): ${below.slice(0, 10).map((i) => `${i.name} (${i.currentStock})`).join(", ")}`
      : "No items below reorder level",
    topItems.length
      ? `Top selling this month: ${topItems.map((t) => `${t.itemName} ${rs(t._sum.totalPaise)}`).join(", ")}`
      : "No sales this month",
  ].join("\n");
}
