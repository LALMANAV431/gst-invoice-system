import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { writeGuard } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { toPaise } from "@/lib/money";
import { ADJUSTMENT_REASONS, adjustmentDirection } from "@/lib/inventory";
import { PeriodLockedError } from "@/server/numbering";
import { InventoryError, createAdjustment } from "@/server/services/inventory.service";
import { parsePagination, paginated } from "@/lib/pagination";

/**
 * Stock adjustments: the documented way stock changes without an invoice or a
 * purchase - damage, theft, expiry, samples, production output, count variances.
 *
 * The reason code, not the request, decides the direction, so a client cannot
 * file a "damage" that increases stock.
 */

const lineSchema = z.object({
  itemId: z.string().min(1),
  quantity: z.coerce.number().positive("Quantity must be greater than zero"),
  /** Cost per unit in rupees. Defaults to the item's estimated cost. */
  rate: z.union([z.string(), z.number()]).optional(),
  batchNo: z.string().max(60).optional(),
  notes: z.string().max(300).optional(),
});

const createSchema = z.object({
  reason: z.enum(Object.keys(ADJUSTMENT_REASONS) as [string, ...string[]]),
  date: z.coerce.date().optional(),
  notes: z.string().max(500).optional(),
  godownId: z.string().optional(),
  lines: z.array(lineSchema).min(1, "Add at least one item"),
});

export async function GET(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const reason = searchParams.get("reason");
  const where = {
    companyId: ctx.company.id,
    ...(reason && reason in ADJUSTMENT_REASONS ? { reason } : {}),
  };

  const { skip, take, page, pageSize } = parsePagination(req);
  const [rows, total] = await Promise.all([
    db.stockAdjustment.findMany({
      where,
      include: {
        items: { include: { item: { select: { name: true, unit: true } } } },
        godown: { select: { name: true } },
      },
      orderBy: { date: "desc" },
      skip,
      take,
    }),
    db.stockAdjustment.count({ where }),
  ]);

  return NextResponse.json({
    ...paginated(rows, total, page, pageSize),
    reasons: Object.entries(ADJUSTMENT_REASONS).map(([code, meta]) => ({
      code,
      label: meta.label,
      direction: meta.direction,
    })),
  });
}

export async function POST(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request", issues: parsed.error.issues },
      { status: 400 }
    );
  }
  const input = parsed.data;

  try {
    const adjustment = await createAdjustment({
      companyId: ctx.company.id,
      reason: input.reason,
      date: input.date,
      notes: input.notes,
      godownId: input.godownId,
      lines: input.lines.map((l) => ({
        itemId: l.itemId,
        quantity: l.quantity,
        ratePaise: l.rate !== undefined ? toPaise(l.rate) : undefined,
        batchNo: l.batchNo,
        notes: l.notes,
      })),
    });

    await logAudit({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      action: "CREATE",
      entity: "StockAdjustment",
      entityId: adjustment!.id,
      changes: {
        number: adjustment!.number,
        reason: input.reason,
        direction: adjustmentDirection(input.reason as keyof typeof ADJUSTMENT_REASONS),
        lines: input.lines.length,
      },
    });

    return NextResponse.json(adjustment, { status: 201 });
  } catch (e) {
    if (e instanceof InventoryError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (e instanceof PeriodLockedError) {
      return NextResponse.json({ error: e.message, code: "PERIOD_LOCKED" }, { status: 409 });
    }
    throw e;
  }
}
