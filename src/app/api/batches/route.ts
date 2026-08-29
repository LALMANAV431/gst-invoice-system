import { NextResponse } from "next/server";
import { z } from "zod";
import { db } from "@/lib/db";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { writeGuard } from "@/lib/guard";
import { expiryStatus } from "@/lib/inventory";
import { parsePagination, paginated } from "@/lib/pagination";

/**
 * Batches / lots, for items where shelf life or traceability matters.
 *
 * A batch is created empty and takes on quantity from the movements that name
 * it. It is never given a quantity directly: that would be a stock change with
 * no movement behind it, which is exactly what puts valuation out of agreement
 * with the ledger.
 */

const createSchema = z.object({
  itemId: z.string().min(1),
  batchNo: z.string().min(1, "Batch number is required").max(60),
  mfgDate: z.coerce.date().optional(),
  expiryDate: z.coerce.date().optional(),
  notes: z.string().max(300).optional(),
});

export async function GET(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { searchParams } = new URL(req.url);
  const itemId = searchParams.get("itemId");
  const inStockOnly = searchParams.get("inStock") === "true";

  const where = {
    companyId: ctx.company.id,
    ...(itemId ? { itemId } : {}),
    ...(inStockOnly ? { quantity: { gt: 0 } } : {}),
  };

  const { skip, take, page, pageSize } = parsePagination(req);
  const asOf = new Date();
  const [rows, total] = await Promise.all([
    db.batch.findMany({
      where,
      include: { item: { select: { name: true, unit: true } } },
      orderBy: [{ expiryDate: "asc" }, { batchNo: "asc" }],
      skip,
      take,
    }),
    db.batch.count({ where }),
  ]);

  return NextResponse.json(
    paginated(
      rows.map((b) => ({ ...b, status: expiryStatus(b.expiryDate, asOf) })),
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

  const parsed = createSchema.safeParse(await req.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }
  const input = parsed.data;

  const item = await db.item.findFirst({
    where: { id: input.itemId, companyId: ctx.company.id },
    select: { id: true, name: true },
  });
  if (!item) return NextResponse.json({ error: "Item not found" }, { status: 404 });

  if (input.mfgDate && input.expiryDate && input.expiryDate <= input.mfgDate) {
    return NextResponse.json(
      { error: "Expiry date must be after the manufacturing date" },
      { status: 400 }
    );
  }

  const existing = await db.batch.findFirst({
    where: { itemId: input.itemId, batchNo: input.batchNo.trim() },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json(
      { error: `Batch "${input.batchNo}" already exists for ${item.name}`, code: "DUPLICATE" },
      { status: 409 }
    );
  }

  const batch = await db.batch.create({
    data: {
      companyId: ctx.company.id,
      itemId: input.itemId,
      batchNo: input.batchNo.trim(),
      mfgDate: input.mfgDate ?? null,
      expiryDate: input.expiryDate ?? null,
      notes: input.notes ?? null,
    },
    include: { item: { select: { name: true, unit: true } } },
  });

  return NextResponse.json({ ...batch, status: expiryStatus(batch.expiryDate, new Date()) }, { status: 201 });
}
