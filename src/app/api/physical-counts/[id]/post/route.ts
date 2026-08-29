import { NextResponse } from "next/server";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { writeGuard } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { PeriodLockedError } from "@/server/numbering";
import { InventoryError, postPhysicalCount } from "@/server/services/inventory.service";

/**
 * Post a count sheet: convert its variances into one stock adjustment and mark
 * the sheet immutable.
 *
 * Separate from PATCH because posting is not an edit - it moves stock, and a
 * mistyped quantity saved during data entry must not be able to trigger it.
 */
export async function POST(_: Request, { params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;

  try {
    const result = await postPhysicalCount(ctx.company.id, params.id);

    await logAudit({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      action: "UPDATE",
      entity: "PhysicalCount",
      entityId: params.id,
      changes: {
        number: result.count.number,
        varianceLines: result.varianceCount,
        adjustment: result.adjustment?.number ?? null,
      },
    });

    return NextResponse.json({
      ok: true,
      count: { id: result.count.id, number: result.count.number, status: "POSTED" },
      adjustment: result.adjustment
        ? { id: result.adjustment.id, number: result.adjustment.number }
        : null,
      varianceLines: result.varianceCount,
      message:
        result.varianceCount === 0
          ? "Count posted. Every line agreed with the books, so no adjustment was needed."
          : `Count posted. ${result.varianceCount} line(s) adjusted via ${result.adjustment?.number}.`,
    });
  } catch (e) {
    if (e instanceof InventoryError) {
      const notFound = e.message === "Count not found";
      return NextResponse.json({ error: e.message }, { status: notFound ? 404 : 400 });
    }
    if (e instanceof PeriodLockedError) {
      return NextResponse.json({ error: e.message, code: "PERIOD_LOCKED" }, { status: 409 });
    }
    throw e;
  }
}
