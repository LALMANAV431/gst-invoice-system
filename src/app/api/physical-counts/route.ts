import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { writeGuard } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { InventoryError, createPhysicalCount } from "@/server/services/inventory.service";
import { parsePagination, paginated } from "@/lib/pagination";

/**
 * Physical stock counts (stock takes).
 *
 * Creating a count freezes the book quantity onto every line. Counted figures
 * are entered against that snapshot, and posting turns the variances into a
 * single stock adjustment.
 */

const createSchema = z.object({
  date: z.coerce.date().optional(),
  notes: z.string().max(500).optional(),
  godownId: z.string().optional(),
  countedBy: z.string().max(120).optional(),
  /** Omit to take the whole company (or godown). */
  itemIds: z.array(z.string().min(1)).optional(),
});

export async function GET(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const status = searchParams.get("status");
  const where = {
    companyId: ctx.company.id,
    ...(status && ["DRAFT", "POSTED", "CANCELLED"].includes(status) ? { status } : {}),
  };

  const { skip, take, page, pageSize } = parsePagination(req);
  const [rows, total] = await Promise.all([
    db.physicalCount.findMany({
      where,
      include: {
        godown: { select: { name: true } },
        adjustment: { select: { id: true, number: true } },
        _count: { select: { items: true } },
      },
      orderBy: { date: "desc" },
      skip,
      take,
    }),
    db.physicalCount.count({ where }),
  ]);

  // A count's headline figure is how many lines disagree, so summarise rather
  // than making the client fetch every line of every sheet to find out.
  const variances = await db.physicalCountItem.groupBy({
    by: ["countId"],
    where: { countId: { in: rows.map((r) => r.id) }, NOT: { variance: 0 } },
    _count: { _all: true },
  });
  const varianceByCount = new Map(variances.map((v) => [v.countId, v._count._all]));

  return NextResponse.json(
    paginated(
      rows.map((r) => ({ ...r, varianceLines: varianceByCount.get(r.id) ?? 0 })),
      total,
      page,
      pageSize
    )
  );
}

export async function POST(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;

  const parsed = createSchema.safeParse((await req.json().catch(() => null)) ?? {});
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  try {
    const count = await createPhysicalCount({
      companyId: ctx.company.id,
      date: parsed.data.date,
      notes: parsed.data.notes,
      godownId: parsed.data.godownId,
      countedBy: parsed.data.countedBy ?? ctx.user.name ?? ctx.user.email,
      itemIds: parsed.data.itemIds,
    });

    await logAudit({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      action: "CREATE",
      entity: "PhysicalCount",
      entityId: count.id,
      changes: { number: count.number, lines: count.items.length },
    });

    return NextResponse.json(count, { status: 201 });
  } catch (e) {
    if (e instanceof InventoryError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    throw e;
  }
}
