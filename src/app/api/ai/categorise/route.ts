import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { writeGuard } from "@/lib/guard";
import { ask, parseJsonResponse } from "@/server/ai/service";
import { AiBudgetExceededError, AiUnavailableError } from "@/server/ai/types";

const schema = z.object({
  description: z.string().min(1, "Describe the expense").max(300),
});

/**
 * Suggest an expense ledger for a free-text description.
 *
 * Returns a SUGGESTION. It does not create the expense or post anything — the
 * user picks the head. An auto-categorised expense that lands in the wrong P&L
 * line is a silent error, and silent errors in accounts are the expensive kind.
 *
 * The model is constrained to the tenant's existing expense ledgers, so it cannot
 * invent a head that does not exist in their chart of accounts.
 */
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

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  const companyId = ctx.company.id;

  // Constrain the model to heads that actually exist for this tenant.
  const expenseLedgers = await db.ledger.findMany({
    where: {
      companyId,
      group: { nature: "EXPENSE" },
    },
    select: { name: true },
    orderBy: { name: "asc" },
    take: 100,
  });

  const allowed = expenseLedgers.map((l) => l.name);

  try {
    const result = await ask({
      companyId,
      userId: ctx.user.id,
      feature: "CATEGORISE",
      system:
        "You classify small-business expenses into an existing chart of accounts. " +
        "Return ONLY JSON: {\"suggestedLedger\": string, \"confidence\": number, \"reason\": string}. " +
        "suggestedLedger MUST be chosen from the ALLOWED list exactly as written. " +
        "If nothing fits, choose the closest general expense head. " +
        "The description may be in Hindi or English.",
      prompt: `ALLOWED LEDGERS:\n${allowed.join("\n")}\n\nEXPENSE DESCRIPTION: ${parsed.data.description}`,
    });

    const raw = parseJsonResponse<{
      suggestedLedger?: string;
      confidence?: number;
      reason?: string;
    }>(result.text);

    if (!raw?.suggestedLedger) {
      return NextResponse.json(
        { error: "Could not suggest a category for that." },
        { status: 422 }
      );
    }

    // Verify the suggestion is real. A model that returns a plausible-sounding
    // head that does not exist would otherwise create a new ledger on save.
    const exists = allowed.some(
      (name) => name.toLowerCase() === raw.suggestedLedger!.trim().toLowerCase()
    );

    return NextResponse.json({
      suggestion: exists ? raw.suggestedLedger.trim() : null,
      existsInChart: exists,
      confidence: Math.min(1, Math.max(0, raw.confidence ?? 0.5)),
      reason: raw.reason ?? null,
      provider: result.provider,
      mock: result.mock,
      // The user chooses; nothing is posted here.
      requiresReview: true,
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
    console.error("[ai/categorise] failed:", e);
    return NextResponse.json({ error: "Could not suggest a category" }, { status: 500 });
  }
}
