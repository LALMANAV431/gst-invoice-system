/**
 * Inventory reporting: valuation, stock ledger, ageing, dead stock, expiry,
 * adjustments and physical counts.
 *
 * The arithmetic lives in src/lib/inventory.ts and is pure. This module's only
 * job is to load movements, hand them over, and persist the documents that
 * create movements. Keeping the split means the costing rules are testable
 * without a database and cannot be quietly bypassed by a route.
 */

import { Prisma } from "@prisma/client";
import { db } from "@/lib/db";
import { Paise } from "@/lib/money";
import {
  AgeingBucket,
  ExpiryStatus,
  FifoLayer,
  StockEntry,
  StockLedgerRow,
  ValuationMethod,
  ValuationResult,
  adjustmentDirection,
  assessDeadStock,
  countVariance,
  expiryStatus,
  isAdjustmentReason,
  isValuationMethod,
  stockAgeing,
  valuate,
  valuateFifo,
  varianceReason,
} from "@/lib/inventory";
import { allocateDocumentNumber, assertPeriodOpen } from "@/server/numbering";
import { estimateCostRate, recordStockMovement } from "@/server/stock";

export class InventoryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InventoryError";
  }
}

type Client = Prisma.TransactionClient | typeof db;

interface ItemRow {
  id: string;
  name: string;
  sku: string | null;
  hsn: string | null;
  unit: string;
  currentStock: number;
  openingStock: number;
  openingRatePaise: number;
  purchasePricePaise: number;
  salePricePaise: number;
  lowStockAlert: number;
  trackBatches: boolean;
  createdAt: Date;
  godownId: string | null;
}

interface MovementRow {
  id: string;
  itemId: string;
  date: Date;
  type: string;
  quantity: number;
  ratePaise: number;
  valuePaise: number;
  reference: string | null;
  sourceType: string | null;
}

/** Company-level valuation policy. */
export async function valuationPolicy(
  companyId: string
): Promise<{ method: ValuationMethod; deadStockDays: number; gstScheme: string }> {
  const company = await db.company.findUnique({
    where: { id: companyId },
    select: { stockValuationMethod: true, deadStockDays: true, gstScheme: true },
  });
  const raw = company?.stockValuationMethod;
  return {
    method: isValuationMethod(raw) ? raw : "FIFO",
    deadStockDays: company?.deadStockDays && company.deadStockDays > 0 ? company.deadStockDays : 90,
    gstScheme: company?.gstScheme ?? "REGULAR",
  };
}

/**
 * Turn stored movements into valuation entries, supplying an opening position
 * for items whose opening stock predates the movement ledger.
 *
 * Items created before movements recorded a cost, and items imported with an
 * opening quantity, have no OPENING movement. Without the synthetic entry their
 * held stock would be valued at zero and the first sale would look like a
 * negative-stock issue. The check is per item, so an item that DOES have a real
 * opening movement is never double-counted.
 */
function buildEntries(item: ItemRow, movements: MovementRow[]): {
  entries: StockEntry[];
  openingQuantity: number;
  openingValuePaise: Paise;
} {
  const hasOpeningMovement = movements.some((m) => m.sourceType === "OPENING");
  const entries: StockEntry[] = movements.map((m) => ({
    id: m.id,
    date: m.date,
    direction: m.type === "IN" ? "IN" : "OUT",
    quantity: m.quantity,
    valuePaise: m.type === "IN" ? m.valuePaise : undefined,
    ratePaise: m.ratePaise || undefined,
    reference: m.reference,
    sourceType: m.sourceType,
  }));

  if (hasOpeningMovement || item.openingStock === 0) {
    return { entries, openingQuantity: 0, openingValuePaise: 0 };
  }

  const rate = item.openingRatePaise || item.purchasePricePaise;
  return {
    entries,
    openingQuantity: item.openingStock,
    openingValuePaise: Math.round(rate * item.openingStock),
  };
}

const ITEM_SELECT = {
  id: true,
  name: true,
  sku: true,
  hsn: true,
  unit: true,
  currentStock: true,
  openingStock: true,
  openingRatePaise: true,
  purchasePricePaise: true,
  salePricePaise: true,
  lowStockAlert: true,
  trackBatches: true,
  createdAt: true,
  godownId: true,
} as const;

export interface ItemValuation {
  itemId: string;
  name: string;
  sku: string | null;
  hsn: string | null;
  unit: string;
  method: ValuationMethod;
  quantity: number;
  valuePaise: Paise;
  ratePaise: Paise;
  cogsPaise: Paise;
  inQuantity: number;
  inValuePaise: Paise;
  outQuantity: number;
  salePricePaise: Paise;
  /** Realisable value at the current sale price, for the AS 2 comparison. */
  realisableValuePaise: Paise;
  /**
   * True when cost exceeds what the goods would fetch. AS 2 requires stock to be
   * carried at the LOWER of cost and net realisable value, so these lines need a
   * write-down decision - we flag rather than silently revalue, because the
   * write-down is a judgement the business must make and record.
   */
  belowCost: boolean;
  negativeStockQuantity: number;
  costVariancePaise: Paise;
  lastInDate: Date | null;
  lastOutDate: Date | null;
  idleDays: number;
  neverSold: boolean;
  isDeadStock: boolean;
  isLowStock: boolean;
  /**
   * Difference between the denormalised Item.currentStock and the balance the
   * movement ledger implies. Should always be 0; a non-zero value means some
   * code path changed stock without recording a movement, and surfacing it is
   * how that bug gets found instead of quietly distorting valuation.
   */
  ledgerDriftQuantity: number;
  layers: FifoLayer[];
}

export interface StockSummary {
  method: ValuationMethod;
  asOf: Date;
  items: ItemValuation[];
  totals: {
    itemCount: number;
    quantity: number;
    valuePaise: Paise;
    cogsPaise: Paise;
    realisableValuePaise: Paise;
  };
  ageing: AgeingBucket[];
  flags: {
    negativeStockItems: number;
    driftItems: number;
    belowCostItems: number;
    deadStockItems: number;
    lowStockItems: number;
  };
}

export interface StockSummaryOptions {
  /** Value the position as at this instant. Movements after it are ignored. */
  asOf?: Date;
  /** Only count COGS for issues on or after this date (period P&L). */
  from?: Date;
  itemIds?: string[];
  godownId?: string;
}

/**
 * Value every item in the company.
 *
 * Loads all movements in one query and groups in memory rather than issuing a
 * query per item, because a per-item replay over a few hundred items is
 * hundreds of round trips. If a tenant ever outgrows this, the fix is a
 * materialised period-opening snapshot - noted in docs/ROADMAP.md - not a loop
 * of queries.
 */
export async function stockSummary(
  companyId: string,
  options: StockSummaryOptions = {}
): Promise<StockSummary> {
  const asOf = options.asOf ?? new Date();
  const { method, deadStockDays } = await valuationPolicy(companyId);

  const itemWhere: Prisma.ItemWhereInput = { companyId };
  if (options.itemIds?.length) itemWhere.id = { in: options.itemIds };
  if (options.godownId) itemWhere.godownId = options.godownId;

  const items = (await db.item.findMany({
    where: itemWhere,
    select: ITEM_SELECT,
    orderBy: { name: "asc" },
  })) as ItemRow[];

  if (items.length === 0) {
    return {
      method,
      asOf,
      items: [],
      totals: { itemCount: 0, quantity: 0, valuePaise: 0, cogsPaise: 0, realisableValuePaise: 0 },
      ageing: stockAgeing([], asOf),
      flags: {
        negativeStockItems: 0,
        driftItems: 0,
        belowCostItems: 0,
        deadStockItems: 0,
        lowStockItems: 0,
      },
    };
  }

  const movements = (await db.stockMovement.findMany({
    where: {
      companyId,
      itemId: { in: items.map((i) => i.id) },
      date: { lte: asOf },
      ...(options.godownId ? { godownId: options.godownId } : {}),
    },
    select: {
      id: true,
      itemId: true,
      date: true,
      type: true,
      quantity: true,
      ratePaise: true,
      valuePaise: true,
      reference: true,
      sourceType: true,
    },
    orderBy: { date: "asc" },
  })) as MovementRow[];

  const byItem = new Map<string, MovementRow[]>();
  for (const m of movements) {
    const list = byItem.get(m.itemId);
    if (list) list.push(m);
    else byItem.set(m.itemId, [m]);
  }

  const valuations: ItemValuation[] = [];
  const allLayers: FifoLayer[] = [];

  for (const item of items) {
    const itemMovements = byItem.get(item.id) ?? [];
    const { entries, openingQuantity, openingValuePaise } = buildEntries(item, itemMovements);
    const fallbackRatePaise = item.purchasePricePaise || item.openingRatePaise || 0;

    const result = valuate(entries, method, {
      openingQuantity,
      openingValuePaise,
      fallbackRatePaise,
    });

    // Ageing is a fact about when goods arrived, so it always reads FIFO layers
    // even for a company that values at weighted average.
    const layered: ValuationResult =
      method === "FIFO"
        ? result
        : valuateFifo(entries, { openingQuantity, openingValuePaise, fallbackRatePaise });

    const lastIn = lastDate(itemMovements, "IN");
    const lastOut = lastDate(itemMovements, "OUT");
    // How long the stock ON HAND has been sitting: the date of the oldest
    // remaining FIFO layer. Using the item's createdAt instead would report
    // imported or migrated stock as brand new however long it had been held.
    const oldestLayer = layered.layers.length ? layered.layers[0].date : null;
    const dead = assessDeadStock(
      {
        quantity: result.closingQuantity,
        valuePaise: result.closingValuePaise,
        lastOutDate: lastOut,
        stockSinceDate: oldestLayer,
        createdAt: item.createdAt,
      },
      asOf,
      deadStockDays
    );

    // COGS restricted to a period, when asked for.
    let cogsPaise = result.cogsPaise;
    if (options.from) {
      const from = options.from;
      const periodResult = valuate(
        entries.filter((e) => e.date >= from),
        method,
        {
          // Opening for the period is the position at `from`.
          ...periodOpening(entries, method, from, {
            openingQuantity,
            openingValuePaise,
            fallbackRatePaise,
          }),
          fallbackRatePaise,
        }
      );
      cogsPaise = periodResult.cogsPaise;
    }

    const realisableValuePaise = Math.round(item.salePricePaise * Math.max(0, result.closingQuantity));

    valuations.push({
      itemId: item.id,
      name: item.name,
      sku: item.sku,
      hsn: item.hsn,
      unit: item.unit,
      method,
      quantity: result.closingQuantity,
      valuePaise: result.closingValuePaise,
      ratePaise: result.closingRatePaise,
      cogsPaise,
      inQuantity: result.inQuantity,
      inValuePaise: result.inValuePaise,
      outQuantity: result.outQuantity,
      salePricePaise: item.salePricePaise,
      realisableValuePaise,
      belowCost:
        result.closingQuantity > 0 &&
        item.salePricePaise > 0 &&
        realisableValuePaise < result.closingValuePaise,
      negativeStockQuantity: result.negativeStockQuantity,
      costVariancePaise: result.costVariancePaise,
      lastInDate: lastIn,
      lastOutDate: lastOut,
      idleDays: dead.idleDays,
      neverSold: dead.neverSold,
      isDeadStock: dead.isDead,
      isLowStock: item.lowStockAlert > 0 && item.currentStock <= item.lowStockAlert,
      ledgerDriftQuantity: round6(item.currentStock - result.closingQuantity),
      layers: layered.layers,
    });

    allLayers.push(...layered.layers);
  }

  const totals = valuations.reduce(
    (acc, v) => ({
      itemCount: acc.itemCount + 1,
      quantity: round6(acc.quantity + v.quantity),
      valuePaise: acc.valuePaise + v.valuePaise,
      cogsPaise: acc.cogsPaise + v.cogsPaise,
      realisableValuePaise: acc.realisableValuePaise + v.realisableValuePaise,
    }),
    { itemCount: 0, quantity: 0, valuePaise: 0, cogsPaise: 0, realisableValuePaise: 0 }
  );

  return {
    method,
    asOf,
    items: valuations,
    totals,
    ageing: stockAgeing(allLayers, asOf),
    flags: {
      negativeStockItems: valuations.filter((v) => v.negativeStockQuantity > 0).length,
      driftItems: valuations.filter((v) => Math.abs(v.ledgerDriftQuantity) > 1e-6).length,
      belowCostItems: valuations.filter((v) => v.belowCost).length,
      deadStockItems: valuations.filter((v) => v.isDeadStock).length,
      lowStockItems: valuations.filter((v) => v.isLowStock).length,
    },
  };
}

/**
 * Position at the start of a period, so a period COGS figure does not have to
 * re-derive history from an empty opening.
 */
function periodOpening(
  entries: StockEntry[],
  method: ValuationMethod,
  from: Date,
  base: { openingQuantity: number; openingValuePaise: Paise; fallbackRatePaise: Paise }
): { openingQuantity: number; openingValuePaise: Paise } {
  const before = entries.filter((e) => e.date < from);
  const result = valuate(before, method, base);
  return { openingQuantity: result.closingQuantity, openingValuePaise: result.closingValuePaise };
}

function lastDate(movements: MovementRow[], type: string): Date | null {
  let latest: Date | null = null;
  for (const m of movements) {
    if (m.type !== type) continue;
    if (!latest || m.date > latest) latest = m.date;
  }
  return latest;
}

function round6(value: number): number {
  return Math.abs(value) < 1e-9 ? 0 : Math.round(value * 1e6) / 1e6;
}

/**
 * Full movement history for one item, with the running cost after each row.
 * This is the drill-down behind a valuation figure - the answer to "why is my
 * closing stock this number".
 */
export async function itemStockLedger(
  companyId: string,
  itemId: string,
  options: { asOf?: Date } = {}
): Promise<{
  item: ItemRow;
  method: ValuationMethod;
  rows: StockLedgerRow[];
  valuation: ValuationResult;
  ageing: AgeingBucket[];
}> {
  const asOf = options.asOf ?? new Date();
  const { method } = await valuationPolicy(companyId);
  const item = (await db.item.findFirst({
    where: { id: itemId, companyId },
    select: ITEM_SELECT,
  })) as ItemRow | null;
  if (!item) throw new InventoryError("Item not found");

  const movements = (await db.stockMovement.findMany({
    where: { companyId, itemId, date: { lte: asOf } },
    select: {
      id: true,
      itemId: true,
      date: true,
      type: true,
      quantity: true,
      ratePaise: true,
      valuePaise: true,
      reference: true,
      sourceType: true,
    },
    orderBy: { date: "asc" },
  })) as MovementRow[];

  const { entries, openingQuantity, openingValuePaise } = buildEntries(item, movements);
  const opts = {
    openingQuantity,
    openingValuePaise,
    fallbackRatePaise: item.purchasePricePaise || item.openingRatePaise || 0,
    includeRows: true,
  };
  const valuation = valuate(entries, method, opts);
  const layered = method === "FIFO" ? valuation : valuateFifo(entries, opts);

  return { item, method, rows: valuation.rows, valuation, ageing: stockAgeing(layered.layers, asOf) };
}

/* --------------------------------------------------------------- expiry */

export interface BatchExpiryRow {
  batchId: string;
  batchNo: string;
  itemId: string;
  itemName: string;
  unit: string;
  quantity: number;
  expiryDate: Date | null;
  mfgDate: Date | null;
  status: ExpiryStatus;
  daysToExpiry: number | null;
  valuePaise: Paise;
}

/**
 * Batches holding stock, classified by shelf life.
 *
 * Only batches with a positive quantity are reported: a batch that has been
 * fully sold cannot expire on our shelf, and listing it would bury the ones
 * that need action.
 */
export async function expiryReport(
  companyId: string,
  options: { asOf?: Date; includeOk?: boolean } = {}
): Promise<{ asOf: Date; rows: BatchExpiryRow[]; totals: Record<ExpiryStatus, Paise> }> {
  const asOf = options.asOf ?? new Date();
  const batches = await db.batch.findMany({
    where: { companyId, quantity: { gt: 0 } },
    include: { item: { select: { id: true, name: true, unit: true, purchasePricePaise: true } } },
    orderBy: [{ expiryDate: "asc" }, { batchNo: "asc" }],
  });

  const rows: BatchExpiryRow[] = [];
  const totals: Record<ExpiryStatus, Paise> = {
    EXPIRED: 0,
    EXPIRING_30: 0,
    EXPIRING_90: 0,
    OK: 0,
    NO_EXPIRY: 0,
  };

  for (const batch of batches) {
    const status = expiryStatus(batch.expiryDate, asOf);
    const valuePaise = Math.round(batch.item.purchasePricePaise * batch.quantity);
    totals[status] += valuePaise;
    if (status === "OK" && !options.includeOk) continue;
    rows.push({
      batchId: batch.id,
      batchNo: batch.batchNo,
      itemId: batch.item.id,
      itemName: batch.item.name,
      unit: batch.item.unit,
      quantity: batch.quantity,
      expiryDate: batch.expiryDate,
      mfgDate: batch.mfgDate,
      status,
      daysToExpiry: batch.expiryDate
        ? Math.floor((batch.expiryDate.getTime() - asOf.getTime()) / 86_400_000)
        : null,
      valuePaise,
    });
  }

  return { asOf, rows, totals };
}

/* ----------------------------------------------------------- adjustments */

export interface AdjustmentLineInput {
  itemId: string;
  quantity: number;
  /** Cost per unit. Defaults to the item's estimated cost when omitted. */
  ratePaise?: Paise;
  batchNo?: string;
  batchId?: string;
  notes?: string;
}

export interface AdjustmentInput {
  companyId: string;
  reason: string;
  date?: Date;
  notes?: string;
  godownId?: string;
  lines: AdjustmentLineInput[];
  /** Set when created by posting a physical count. */
  physicalCountId?: string;
  /** Direction override, used only by count posting where lines differ. */
  lineDirections?: Record<string, "IN" | "OUT">;
}

/**
 * Record a stock adjustment.
 *
 * The direction comes from the reason code, not from the request, so a client
 * cannot file a "damage" that increases stock. Only a physical count may mix
 * directions in one document, because a count legitimately finds both shortages
 * and excesses on the same sheet.
 */
export async function createAdjustment(input: AdjustmentInput) {
  if (!isAdjustmentReason(input.reason)) {
    throw new InventoryError(`Unknown adjustment reason "${input.reason}"`);
  }
  if (!input.lines.length) throw new InventoryError("An adjustment needs at least one line");

  const date = input.date ?? new Date();
  const reason = input.reason;
  const defaultDirection = adjustmentDirection(reason);

  return db.$transaction(async (tx) => {
    await assertPeriodOpen(tx, input.companyId, date);

    const company = await tx.company.findUnique({
      where: { id: input.companyId },
      select: { adjustmentPrefix: true },
    });

    const { number } = await allocateDocumentNumber(tx, {
      companyId: input.companyId,
      documentType: "ADJUSTMENT",
      prefix: company?.adjustmentPrefix || "ADJ",
      date,
    });

    const adjustment = await tx.stockAdjustment.create({
      data: {
        companyId: input.companyId,
        number,
        date,
        reason,
        notes: input.notes ?? null,
        godownId: input.godownId ?? null,
        physicalCountId: input.physicalCountId ?? null,
      },
    });

    for (const line of input.lines) {
      const quantity = Math.abs(Number(line.quantity) || 0);
      if (quantity === 0) continue;

      const item = await tx.item.findFirst({
        where: { id: line.itemId, companyId: input.companyId },
        select: { id: true, name: true, trackBatches: true },
      });
      if (!item) throw new InventoryError(`Item ${line.itemId} not found`);

      const direction = input.lineDirections?.[line.itemId] ?? defaultDirection;
      const ratePaise =
        typeof line.ratePaise === "number"
          ? Math.trunc(line.ratePaise)
          : await estimateCostRate(tx, input.companyId, line.itemId);

      let batchId = line.batchId ?? null;
      if (!batchId && line.batchNo) {
        const existing = await tx.batch.findFirst({
          where: { itemId: line.itemId, batchNo: line.batchNo.trim() },
          select: { id: true },
        });
        if (!existing) {
          throw new InventoryError(
            `Batch "${line.batchNo}" does not exist for ${item.name}. Receive it on a purchase first.`
          );
        }
        batchId = existing.id;
      }

      const valuePaise = Math.round(ratePaise * quantity);

      await tx.stockAdjustmentItem.create({
        data: {
          adjustmentId: adjustment.id,
          itemId: line.itemId,
          quantity,
          direction,
          ratePaise,
          valuePaise,
          notes: line.notes ?? null,
          batchId,
        },
      });

      await recordStockMovement(tx, {
        companyId: input.companyId,
        itemId: line.itemId,
        direction,
        quantity,
        date,
        reference: number,
        notes: `${reason}: ${input.notes ?? number}`,
        sourceType: input.physicalCountId ? "COUNT" : "ADJUSTMENT",
        sourceId: adjustment.id,
        godownId: input.godownId ?? null,
        batchId,
        valuePaise: direction === "IN" ? valuePaise : undefined,
        ratePaise,
      });
    }

    return tx.stockAdjustment.findUnique({
      where: { id: adjustment.id },
      include: { items: { include: { item: { select: { name: true, unit: true } } } } },
    });
  });
}

/* -------------------------------------------------------- physical count */

/**
 * Open a count sheet.
 *
 * The system quantity is snapshotted onto every line now. That snapshot is the
 * point of the document: comparing a count taken this morning against a book
 * figure recomputed this evening would silently absorb the day's trading into
 * the variance.
 */
export async function createPhysicalCount(input: {
  companyId: string;
  date?: Date;
  notes?: string;
  godownId?: string;
  countedBy?: string;
  /** Omit to snapshot every item in the company (or godown). */
  itemIds?: string[];
}) {
  const date = input.date ?? new Date();

  return db.$transaction(async (tx) => {
    const company = await tx.company.findUnique({
      where: { id: input.companyId },
      select: { stockCountPrefix: true },
    });

    const where: Prisma.ItemWhereInput = { companyId: input.companyId };
    if (input.itemIds?.length) where.id = { in: input.itemIds };
    if (input.godownId) where.godownId = input.godownId;

    const items = await tx.item.findMany({
      where,
      select: { id: true, currentStock: true, purchasePricePaise: true, openingRatePaise: true },
      orderBy: { name: "asc" },
    });
    if (!items.length) throw new InventoryError("No items to count");

    const { number } = await allocateDocumentNumber(tx, {
      companyId: input.companyId,
      documentType: "STOCK_COUNT",
      prefix: company?.stockCountPrefix || "PC",
      date,
    });

    const count = await tx.physicalCount.create({
      data: {
        companyId: input.companyId,
        number,
        date,
        notes: input.notes ?? null,
        godownId: input.godownId ?? null,
        countedBy: input.countedBy ?? null,
        items: {
          create: items.map((it) => ({
            itemId: it.id,
            systemQuantity: it.currentStock,
            // Pre-filled with the system figure so an untouched line posts no
            // variance. A sheet defaulting to zero would write off the entire
            // warehouse the moment somebody posted it half-finished.
            countedQuantity: it.currentStock,
            variance: 0,
            ratePaise: it.openingRatePaise || it.purchasePricePaise,
          })),
        },
      },
      include: { items: true },
    });

    return count;
  });
}

/** Record counted quantities on a draft sheet. */
export async function updatePhysicalCount(
  companyId: string,
  countId: string,
  lines: { itemId: string; countedQuantity: number; notes?: string }[]
) {
  return db.$transaction(async (tx) => {
    const count = await tx.physicalCount.findFirst({
      where: { id: countId, companyId },
      include: { items: true },
    });
    if (!count) throw new InventoryError("Count not found");
    if (count.status !== "DRAFT") {
      throw new InventoryError(
        `Count ${count.number} is ${count.status.toLowerCase()} and can no longer be edited.`
      );
    }

    for (const line of lines) {
      const existing = count.items.find((i) => i.itemId === line.itemId);
      if (!existing) throw new InventoryError(`Item ${line.itemId} is not on this count sheet`);
      const counted = Number(line.countedQuantity);
      if (!Number.isFinite(counted) || counted < 0) {
        throw new InventoryError("Counted quantity must be zero or more");
      }
      await tx.physicalCountItem.update({
        where: { id: existing.id },
        data: {
          countedQuantity: counted,
          variance: countVariance(existing.systemQuantity, counted),
          notes: line.notes ?? existing.notes,
        },
      });
    }

    return tx.physicalCount.findUnique({
      where: { id: countId },
      include: { items: { include: { item: { select: { name: true, unit: true } } } } },
    });
  });
}

/**
 * Post a count: turn its variances into one stock adjustment.
 *
 * Variances reach stock only through an adjustment, so there is a single audited
 * path for "stock changed without a document" no matter whether the trigger was
 * a count or a manual write-off.
 */
export async function postPhysicalCount(companyId: string, countId: string) {
  const count = await db.physicalCount.findFirst({
    where: { id: countId, companyId },
    include: { items: true },
  });
  if (!count) throw new InventoryError("Count not found");
  if (count.status === "POSTED") throw new InventoryError(`Count ${count.number} is already posted`);
  if (count.status === "CANCELLED") throw new InventoryError(`Count ${count.number} was cancelled`);

  const varianceLines = count.items.filter((i) => varianceReason(i.variance) !== null);

  if (varianceLines.length === 0) {
    // A count that agrees is still evidence: mark it posted, create nothing.
    await db.physicalCount.update({
      where: { id: countId },
      data: { status: "POSTED", postedAt: new Date() },
    });
    return { count: { ...count, status: "POSTED" }, adjustment: null, varianceCount: 0 };
  }

  const lineDirections: Record<string, "IN" | "OUT"> = {};
  for (const line of varianceLines) {
    lineDirections[line.itemId] = line.variance > 0 ? "IN" : "OUT";
  }

  const adjustment = await createAdjustment({
    companyId,
    // The document reason is the net picture; each line carries its own
    // direction because one sheet can find both shortages and excesses.
    reason: "SHORTAGE",
    date: count.date,
    notes: `Physical count ${count.number}`,
    godownId: count.godownId ?? undefined,
    physicalCountId: count.id,
    lineDirections,
    lines: varianceLines.map((line) => ({
      itemId: line.itemId,
      quantity: Math.abs(line.variance),
      ratePaise: line.ratePaise || undefined,
      notes: line.notes ?? undefined,
    })),
  });

  const posted = await db.physicalCount.update({
    where: { id: countId },
    data: { status: "POSTED", postedAt: new Date() },
    include: { items: { include: { item: { select: { name: true, unit: true } } } } },
  });

  return { count: posted, adjustment, varianceCount: varianceLines.length };
}

/**
 * Record an opening-stock movement so the movement ledger is the complete
 * history of an item and `sum(IN) - sum(OUT)` equals `currentStock`.
 *
 * Called on item creation. Without it, opening stock exists only as a number on
 * the item and valuation has to guess at it (see `buildEntries`).
 */
export async function recordOpeningStock(
  tx: Client,
  input: {
    companyId: string;
    itemId: string;
    quantity: number;
    ratePaise: Paise;
    date?: Date;
    godownId?: string | null;
  }
) {
  if (!input.quantity) return null;
  // recordStockMovement also increments currentStock, which item creation has
  // already set from openingStock, so the movement is written directly here.
  const quantity = Math.abs(input.quantity);
  return tx.stockMovement.create({
    data: {
      companyId: input.companyId,
      itemId: input.itemId,
      type: input.quantity > 0 ? "IN" : "OUT",
      quantity,
      date: input.date ?? new Date(),
      reference: "Opening",
      notes: "Opening stock",
      sourceType: "OPENING",
      godownId: input.godownId ?? null,
      ratePaise: Math.trunc(input.ratePaise),
      valuePaise: Math.round(input.ratePaise * quantity),
    },
  });
}
