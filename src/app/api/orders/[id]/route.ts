import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { writeGuard } from "@/lib/guard";
import { logAudit } from "@/lib/audit";
import { PeriodLockedError } from "@/server/numbering";
import { ValidationError } from "@/server/services/invoice.service";
import { cancelOrderDocument } from "@/server/services/order.service";

export async function GET(_: Request, { params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const doc = await db.orderDocument.findFirst({
    where: { id: params.id, companyId: ctx.company.id },
    include: {
      party: true,
      items: true,
      godown: { select: { id: true, name: true } },
      sourceDocument: { select: { id: true, number: true, docType: true } },
      derivedDocuments: { select: { id: true, number: true, docType: true, date: true } },
    },
  });
  if (!doc) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json(doc);
}

const cancelSchema = z.object({
  reason: z.string().min(1, "Give a reason for cancelling").max(300),
});

/**
 * Cancel rather than delete.
 *
 * A delivery challan accompanies a physical movement of goods, so its number must
 * stay accountable even when the movement is called off. Deleting the row would
 * leave a gap in a series that a GST officer can ask about.
 */
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;

  let reason = "Cancelled by user";
  try {
    const parsed = cancelSchema.safeParse(await req.json());
    if (parsed.success) reason = parsed.data.reason;
  } catch {
    // A body is optional here; the default reason is used.
  }

  try {
    const doc = await cancelOrderDocument(ctx.company.id, params.id, reason);

    await logAudit({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      action: "UPDATE",
      entity: "OrderDocument",
      entityId: doc.id,
      changes: { status: "CANCELLED", reason, number: doc.number },
    });

    return NextResponse.json({ ok: true, number: doc.number });
  } catch (e) {
    if (e instanceof ValidationError) {
      return NextResponse.json({ error: e.message }, { status: 400 });
    }
    if (e instanceof PeriodLockedError) {
      return NextResponse.json({ error: e.message }, { status: 409 });
    }
    console.error("[orders] cancel failed:", e);
    return NextResponse.json({ error: "Could not cancel the document" }, { status: 500 });
  }
}
