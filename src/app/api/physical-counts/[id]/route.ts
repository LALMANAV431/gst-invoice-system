import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { writeGuard } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { InventoryError, updatePhysicalCount } from "@/server/services/inventory.service";

const updateSchema = z.object({
  lines: z
    .array(
      z.object({
        itemId: z.string().min(1),
        countedQuantity: z.coerce.number().min(0, "Counted quantity cannot be negative"),
        notes: z.string().max(300).optional(),
      })
    )
    .min(1),
});

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const count = await db.physicalCount.findFirst({
    where: { id: params.id, companyId: ctx.company.id },
    include: {
      items: {
        include: { item: { select: { name: true, sku: true, unit: true } } },
        orderBy: { item: { name: "asc" } },
      },
      godown: { select: { name: true } },
      adjustment: { select: { id: true, number: true } },
    },
  });
  if (!count) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const varianceLines = count.items.filter((i) => i.variance !== 0);
  return NextResponse.json({
    ...count,
    summary: {
      lines: count.items.length,
      varianceLines: varianceLines.length,
      shortageLines: varianceLines.filter((i) => i.variance < 0).length,
      excessLines: varianceLines.filter((i) => i.variance > 0).length,
      // Net value effect of posting, so the user sees the size of what they are
      // about to write off BEFORE committing to it.
      netValuePaise: varianceLines.reduce((s, i) => s + Math.round(i.ratePaise * i.variance), 0),
    },
  });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;

  const parsed = updateSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  try {
    const count = await updatePhysicalCount(ctx.company.id, params.id, parsed.data.lines);
    return NextResponse.json(count);
  } catch (e) {
    if (e instanceof InventoryError) {
      const notFound = e.message === "Count not found";
      return NextResponse.json({ error: e.message }, { status: notFound ? 404 : 400 });
    }
    throw e;
  }
}

export async function DELETE(_: Request, { params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;

  const count = await db.physicalCount.findFirst({
    where: { id: params.id, companyId: ctx.company.id },
    select: { id: true, number: true, status: true },
  });
  if (!count) return NextResponse.json({ error: "Not found" }, { status: 404 });

  // A posted count is the evidence behind a stock adjustment that has already
  // moved stock. Cancelling it is recorded, not erased.
  if (count.status === "POSTED") {
    return NextResponse.json(
      {
        error: `Count ${count.number} is posted and cannot be deleted. Reverse its stock adjustment instead.`,
        code: "ALREADY_POSTED",
      },
      { status: 400 }
    );
  }

  await db.physicalCount.update({ where: { id: count.id }, data: { status: "CANCELLED" } });
  await logAudit({
    companyId: ctx.company.id,
    userId: ctx.user.id,
    action: "UPDATE",
    entity: "PhysicalCount",
    entityId: count.id,
    changes: { number: count.number },
  });
  return NextResponse.json({ ok: true, status: "CANCELLED" });
}
