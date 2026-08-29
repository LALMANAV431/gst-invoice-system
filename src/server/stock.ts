/**
 * The one place stock changes.
 *
 * WHY THIS EXISTS
 * ---------------
 * Before this module, nine call sites each did the same two writes by hand:
 *
 *   await tx.item.update({ data: { currentStock: { decrement: qty } } });
 *   await tx.stockMovement.create({ data: { type: "OUT", quantity: qty, ... } });
 *
 * Two problems. First, nothing forced the pair to stay together, so a new code
 * path could move stock without leaving a movement row - and inventory
 * valuation is derived from those rows, so the value would silently stop
 * agreeing with the quantity. Second, none of them recorded a COST, which is
 * why valuation had to fall back to "current purchase price x quantity".
 *
 * Everything that moves stock now calls `recordStockMovement`. It writes the
 * movement, keeps `Item.currentStock` in step, and maintains the batch quantity
 * when a batch is named.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { Paise, roundHalfUp } from "@/lib/money";
import { StockDirection } from "@/lib/inventory";

type Client = Prisma.TransactionClient | typeof db;

/**
 * What caused a movement. Recorded so a valuation report can link back to the
 * document, and so opening balances can be told apart from trading activity.
 */
export type StockSource =
  | "OPENING"
  | "PURCHASE"
  | "PURCHASE_RETURN"
  | "SALE"
  | "SALES_RETURN"
  | "DELIVERY_CHALLAN"
  | "GRN"
  | "TRANSFER"
  | "ADJUSTMENT"
  | "COUNT";

export interface StockMovementInput {
  companyId: string;
  itemId: string;
  direction: StockDirection;
  quantity: number;
  date?: Date;
  reference?: string | null;
  notes?: string | null;
  sourceType: StockSource;
  sourceId?: string | null;
  godownId?: string | null;
  batchId?: string | null;
  /**
   * Total cost of an inbound movement. Leave undefined on OUT: the valuation
   * engine decides what an issue cost, and storing a sale price here would let
   * a report mistake revenue for cost.
   */
  valuePaise?: Paise;
  /** Per-unit cost, used when `valuePaise` is not supplied. */
  ratePaise?: Paise;
}

/**
 * Record a stock movement and update the denormalised balances.
 *
 * MUST be called with a transaction client so the movement, the item balance
 * and the document that caused it either all land or none do.
 */
export async function recordStockMovement(tx: Client, input: StockMovementInput) {
  const quantity = Math.abs(Number(input.quantity) || 0);
  if (quantity === 0) return null;

  const isIn = input.direction === "IN";

  // Cost is meaningful for receipts only.
  const valuePaise = isIn
    ? typeof input.valuePaise === "number"
      ? Math.trunc(input.valuePaise)
      : roundHalfUp((input.ratePaise ?? 0) * quantity)
    : 0;
  const ratePaise = isIn
    ? typeof input.ratePaise === "number"
      ? Math.trunc(input.ratePaise)
      : quantity > 0
        ? roundHalfUp(valuePaise / quantity)
        : 0
    : 0;

  await tx.item.update({
    where: { id: input.itemId },
    data: { currentStock: isIn ? { increment: quantity } : { decrement: quantity } },
  });

  if (input.batchId) {
    await tx.batch.update({
      where: { id: input.batchId },
      data: { quantity: isIn ? { increment: quantity } : { decrement: quantity } },
    });
  }

  return tx.stockMovement.create({
    data: {
      companyId: input.companyId,
      itemId: input.itemId,
      type: input.direction,
      quantity,
      date: input.date ?? new Date(),
      reference: input.reference ?? null,
      notes: input.notes ?? null,
      sourceType: input.sourceType,
      sourceId: input.sourceId ?? null,
      godownId: input.godownId ?? null,
      batchId: input.batchId ?? null,
      ratePaise,
      valuePaise,
    },
  });
}

/**
 * Cost of inventory purchased, per AS 2: the price paid, less trade discount,
 * excluding taxes recoverable from the authorities.
 *
 * A regular dealer claims input tax credit, so GST is recoverable and is NOT a
 * cost of the goods. A composition dealer cannot claim it, so for them the tax
 * IS part of what the stock cost. Getting this backwards misstates both closing
 * stock and gross profit by the whole tax amount, so the caller must pass the
 * scheme rather than let it default.
 */
export function purchaseCostPaise(
  line: {
    taxablePaise: number;
    cgstPaise?: number;
    sgstPaise?: number;
    igstPaise?: number;
    cessPaise?: number;
  },
  gstScheme: string
): Paise {
  const taxable = Math.trunc(line.taxablePaise || 0);
  if (gstScheme !== "COMPOSITION") return taxable;
  return (
    taxable +
    Math.trunc(line.cgstPaise || 0) +
    Math.trunc(line.sgstPaise || 0) +
    Math.trunc(line.igstPaise || 0) +
    Math.trunc(line.cessPaise || 0)
  );
}

/**
 * Best available unit cost for an item, used to value goods coming BACK into
 * stock (a sales return, a count excess) where no purchase document states a
 * cost.
 *
 * It is the weighted average of receipts that carry a cost, which is cheap (one
 * aggregate) and stays inside the range of prices actually paid. It falls back
 * to the item's purchase price only when the item has never been received with a
 * cost, e.g. immediately after import.
 *
 * This is deliberately an ESTIMATE and the only place one is used. Returning
 * goods at their original FIFO layer cost would require tracking which layer
 * each issue consumed; that is a bigger change and is recorded in
 * docs/ROADMAP.md. The estimate cannot unbalance anything: returned goods form a
 * new layer at this cost and the conservation invariant still holds.
 */
export async function estimateCostRate(
  tx: Client,
  companyId: string,
  itemId: string
): Promise<Paise> {
  const agg = await tx.stockMovement.aggregate({
    where: { companyId, itemId, type: "IN", valuePaise: { gt: 0 } },
    _sum: { quantity: true, valuePaise: true },
  });
  const qty = agg._sum.quantity ?? 0;
  const value = agg._sum.valuePaise ?? 0;
  if (qty > 0 && value > 0) return roundHalfUp(value / qty);

  const item = await tx.item.findUnique({
    where: { id: itemId },
    select: { purchasePricePaise: true, openingRatePaise: true },
  });
  return item?.openingRatePaise || item?.purchasePricePaise || 0;
}

/**
 * Find or create a batch by number.
 *
 * Batch numbers are supplied by the supplier and repeat across receipts of the
 * same lot, so a receipt naming an existing batch must add to it rather than
 * fail on the unique constraint.
 */
export async function resolveBatch(
  tx: Client,
  input: {
    companyId: string;
    itemId: string;
    batchNo: string;
    mfgDate?: Date | null;
    expiryDate?: Date | null;
  }
): Promise<string> {
  const batchNo = input.batchNo.trim();
  const existing = await tx.batch.findFirst({
    where: { itemId: input.itemId, batchNo },
    select: { id: true, expiryDate: true },
  });
  if (existing) {
    // A later receipt may carry the expiry the first one omitted.
    if (!existing.expiryDate && input.expiryDate) {
      await tx.batch.update({ where: { id: existing.id }, data: { expiryDate: input.expiryDate } });
    }
    return existing.id;
  }
  const created = await tx.batch.create({
    data: {
      companyId: input.companyId,
      itemId: input.itemId,
      batchNo,
      mfgDate: input.mfgDate ?? null,
      expiryDate: input.expiryDate ?? null,
    },
    select: { id: true },
  });
  return created.id;
}
