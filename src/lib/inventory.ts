/**
 * Inventory valuation.
 *
 * WHY THIS EXISTS
 * ---------------
 * Before this module the application valued closing stock as
 *
 *   currentStock x purchasePricePaise        (src/app/(app)/reports/page.tsx)
 *
 * which is the item's CURRENT purchase price, not its cost. That is not a
 * recognised valuation method. AS 2 / Ind AS 2 require cost to be assigned by
 * FIFO or weighted average. The practical consequence of the old formula: raise
 * the purchase price of an item you already hold and the reported value of
 * yesterday's stock changes, silently moving profit between periods.
 *
 * This module replays the stock movement ledger and assigns cost properly. It
 * is deliberately pure - no Prisma, no dates from `now()` unless passed in - so
 * every branch below is reachable from a test.
 *
 * THE INVARIANT
 * -------------
 * For both methods, and including every negative-stock and rounding path:
 *
 *   openingValue + inValue === cogsPaise + closingValuePaise
 *
 * Not "approximately". Exactly, in integer paise. `valuationConserves()` asserts
 * it and the test suite checks it against randomised movement sequences. Every
 * rounding decision below exists to protect that equality: whenever a layer is
 * fully consumed we take its ENTIRE remaining value rather than recomputing
 * `qty x rate`, because recomputing is what lets fractions escape.
 */

import { Paise, roundHalfUp } from "./money";

/**
 * Quantities are floats because real units are fractional (2.5 kg, 0.75 m).
 * Comparisons therefore need a tolerance. 1e-9 is far below any meaningful
 * trade quantity and far above double-precision noise on values of this size.
 */
const QTY_EPSILON = 1e-9;

export type StockDirection = "IN" | "OUT";

/** One row of the stock movement ledger, as fed to the valuation engine. */
export interface StockEntry {
  /** Stable id, used only to label output rows. */
  id?: string;
  date: Date;
  direction: StockDirection;
  /** Always positive. Direction carries the sign. */
  quantity: number;
  /**
   * Total value of an inbound movement, in paise. Authoritative for IN, because
   * `qty x rate` may be fractional and we must not re-derive it. Ignored for
   * OUT - the whole point of the engine is to work out what an issue cost.
   */
  valuePaise?: Paise;
  /** Per-unit rate, used only when `valuePaise` is absent. */
  ratePaise?: Paise;
  /** Free-text label for the ledger report, e.g. "Purchase PUR/26-27/0003". */
  reference?: string | null;
  sourceType?: string | null;
}

export interface FifoLayer {
  /** Date the units were received. Drives stock ageing. */
  date: Date;
  quantity: number;
  valuePaise: Paise;
}

/** One line of the item stock ledger: the running position after a movement. */
export interface StockLedgerRow {
  id?: string;
  date: Date;
  direction: StockDirection;
  reference?: string | null;
  sourceType?: string | null;
  quantity: number;
  /** Value added (IN) or the assigned cost of goods issued (OUT). */
  valuePaise: Paise;
  /** Effective per-unit cost of this movement, rounded for display only. */
  ratePaise: Paise;
  balanceQuantity: number;
  balanceValuePaise: Paise;
}

export interface ValuationResult {
  method: ValuationMethod;
  openingQuantity: number;
  openingValuePaise: Paise;
  inQuantity: number;
  inValuePaise: Paise;
  outQuantity: number;
  /** Cost of goods sold/issued over the replayed period. */
  cogsPaise: Paise;
  closingQuantity: number;
  closingValuePaise: Paise;
  /** Weighted average unit cost of the closing position, 0 when qty is 0. */
  closingRatePaise: Paise;
  /**
   * Remaining FIFO layers. Populated for FIFO only; weighted average has no
   * layers by construction, so ageing for a WA company is computed from a
   * parallel FIFO pass (see `valuate`).
   */
  layers: FifoLayer[];
  /**
   * Total quantity issued while the item had no stock to issue. Non-zero means
   * somebody sold before recording the purchase; the value is a guess until the
   * receipt arrives, so reports must disclose it rather than hide it.
   */
  negativeStockQuantity: number;
  /**
   * Cost correction recognised when a negative position was later filled at a
   * rate different from the one we had guessed. Included in `cogsPaise`.
   */
  costVariancePaise: Paise;
  rows: StockLedgerRow[];
}

export type ValuationMethod = "FIFO" | "WEIGHTED_AVERAGE";

export const VALUATION_METHODS: ValuationMethod[] = ["FIFO", "WEIGHTED_AVERAGE"];

export function isValuationMethod(value: unknown): value is ValuationMethod {
  return typeof value === "string" && (VALUATION_METHODS as string[]).includes(value);
}

export interface ValuationOptions {
  /**
   * Quantity held before the first entry, and its total value. Supplied
   * separately from the entries so that a period report (e.g. "this quarter")
   * can carry a brought-forward balance without re-replaying all of history.
   */
  openingQuantity?: number;
  openingValuePaise?: Paise;
  /**
   * Unit cost used when an issue has no stock behind it. Normally the item's
   * purchase price. Without it a negative issue would be costed at zero, which
   * understates COGS and overstates profit.
   */
  fallbackRatePaise?: Paise;
  /** Emit `rows`. Off by default; a 20k-movement item does not need them. */
  includeRows?: boolean;
}

/** Value of an inbound entry, preferring the exact stored total. */
function entryValue(entry: StockEntry): Paise {
  if (typeof entry.valuePaise === "number" && Number.isFinite(entry.valuePaise)) {
    return Math.trunc(entry.valuePaise);
  }
  if (typeof entry.ratePaise === "number" && Number.isFinite(entry.ratePaise)) {
    return roundHalfUp(entry.ratePaise * entry.quantity);
  }
  return 0;
}

/**
 * Sort into the order value actually moved. Same-day movements are ordered
 * IN before OUT: a same-day purchase and sale of the same goods is the normal
 * case for a trader, and costing the sale before the receipt exists would
 * manufacture a phantom negative position on nearly every busy day.
 */
function sortEntries(entries: StockEntry[]): StockEntry[] {
  return [...entries].sort((a, b) => {
    const byDate = a.date.getTime() - b.date.getTime();
    if (byDate !== 0) return byDate;
    if (a.direction !== b.direction) return a.direction === "IN" ? -1 : 1;
    return (a.id ?? "").localeCompare(b.id ?? "");
  });
}

function displayRate(valuePaise: Paise, quantity: number): Paise {
  if (Math.abs(quantity) <= QTY_EPSILON) return 0;
  return roundHalfUp(valuePaise / quantity);
}

/**
 * First-in-first-out valuation.
 *
 * Layers are held in receipt order. An issue eats the oldest layer first. When a
 * layer is exhausted its entire remaining value becomes cost - never
 * `qty x rate` - so no paise can be created or lost by rounding.
 *
 * Negative stock is represented as a single trailing layer with negative
 * quantity and negative value. The next receipt cancels it first, and any
 * difference between the guessed cost and the real one is recognised as a cost
 * variance in COGS, which is where a cost correction on already-sold goods
 * belongs.
 */
export function valuateFifo(entries: StockEntry[], options: ValuationOptions = {}): ValuationResult {
  const openingQuantity = options.openingQuantity ?? 0;
  const openingValuePaise = Math.trunc(options.openingValuePaise ?? 0);
  const includeRows = options.includeRows ?? false;

  const layers: FifoLayer[] = [];
  /** Negative position, kept outside `layers` so issue logic stays simple. */
  let deficitQuantity = 0;
  let deficitValuePaise = 0;

  if (Math.abs(openingQuantity) > QTY_EPSILON || openingValuePaise !== 0) {
    if (openingQuantity > 0) {
      layers.push({ date: new Date(0), quantity: openingQuantity, valuePaise: openingValuePaise });
    } else {
      deficitQuantity = openingQuantity;
      deficitValuePaise = openingValuePaise;
    }
  }

  let inQuantity = 0;
  let inValuePaise = 0;
  let outQuantity = 0;
  let cogsPaise = 0;
  let negativeStockQuantity = 0;
  let costVariancePaise = 0;
  let lastInRatePaise = displayRate(openingValuePaise, openingQuantity);
  const rows: StockLedgerRow[] = [];

  const sorted = sortEntries(entries);

  for (const entry of sorted) {
    const quantity = Math.abs(entry.quantity);
    if (quantity <= QTY_EPSILON) continue;

    if (entry.direction === "IN") {
      const value = entryValue(entry);
      inQuantity += quantity;
      inValuePaise += value;
      lastInRatePaise = displayRate(value, quantity) || lastInRatePaise;

      let remainingQty = quantity;
      let remainingValue = value;

      // A receipt against a negative position settles that first: those units
      // were already issued and expensed at a guessed rate.
      if (deficitQuantity < -QTY_EPSILON) {
        const cancelQty = Math.min(remainingQty, -deficitQuantity);
        const fullCancel = cancelQty >= remainingQty - QTY_EPSILON;
        const cancelValue = fullCancel ? remainingValue : roundHalfUp((remainingValue * cancelQty) / remainingQty);

        deficitQuantity += cancelQty;
        deficitValuePaise += cancelValue;
        remainingQty -= cancelQty;
        remainingValue -= cancelValue;

        if (deficitQuantity >= -QTY_EPSILON) {
          // Position is square again. Whatever value is left in the deficit is
          // the difference between the guess and the truth: a cost correction
          // on goods already gone, so it belongs in COGS.
          cogsPaise += deficitValuePaise;
          costVariancePaise += deficitValuePaise;
          deficitQuantity = 0;
          deficitValuePaise = 0;
        }
      }

      if (remainingQty > QTY_EPSILON) {
        layers.push({ date: entry.date, quantity: remainingQty, valuePaise: remainingValue });
      } else if (remainingValue !== 0) {
        // Fully absorbed by the deficit but value left over: keep the paise in
        // COGS rather than dropping them.
        cogsPaise += remainingValue;
        costVariancePaise += remainingValue;
      }

      if (includeRows) {
        rows.push({
          id: entry.id,
          date: entry.date,
          direction: "IN",
          reference: entry.reference,
          sourceType: entry.sourceType,
          quantity,
          valuePaise: value,
          ratePaise: displayRate(value, quantity),
          balanceQuantity: layerQuantity(layers) + deficitQuantity,
          balanceValuePaise: layerValue(layers) + deficitValuePaise,
        });
      }
      continue;
    }

    // OUT
    let remainingQty = quantity;
    let costPaise = 0;
    outQuantity += quantity;

    while (remainingQty > QTY_EPSILON && layers.length > 0) {
      const layer = layers[0];
      if (layer.quantity <= remainingQty + QTY_EPSILON) {
        // Whole layer goes. Take its exact remaining value.
        costPaise += layer.valuePaise;
        remainingQty -= layer.quantity;
        layers.shift();
      } else {
        const part = roundHalfUp((layer.valuePaise * remainingQty) / layer.quantity);
        costPaise += part;
        layer.valuePaise -= part;
        layer.quantity -= remainingQty;
        remainingQty = 0;
      }
    }

    if (remainingQty > QTY_EPSILON) {
      // Issuing stock we do not have. Cost it at the best rate we know so COGS
      // is not understated, and record the position so reports can disclose it.
      const rate = options.fallbackRatePaise ?? lastInRatePaise;
      const shortfallValue = roundHalfUp(rate * remainingQty);
      costPaise += shortfallValue;
      deficitQuantity -= remainingQty;
      deficitValuePaise -= shortfallValue;
      negativeStockQuantity += remainingQty;
    }

    cogsPaise += costPaise;

    if (includeRows) {
      rows.push({
        id: entry.id,
        date: entry.date,
        direction: "OUT",
        reference: entry.reference,
        sourceType: entry.sourceType,
        quantity,
        valuePaise: costPaise,
        ratePaise: displayRate(costPaise, quantity),
        balanceQuantity: layerQuantity(layers) + deficitQuantity,
        balanceValuePaise: layerValue(layers) + deficitValuePaise,
      });
    }
  }

  const closingQuantity = snapQuantity(layerQuantity(layers) + deficitQuantity);
  const closingValuePaise = layerValue(layers) + deficitValuePaise;

  return {
    method: "FIFO",
    openingQuantity,
    openingValuePaise,
    inQuantity: snapQuantity(inQuantity),
    inValuePaise,
    outQuantity: snapQuantity(outQuantity),
    cogsPaise,
    closingQuantity,
    closingValuePaise,
    closingRatePaise: displayRate(closingValuePaise, closingQuantity),
    layers,
    negativeStockQuantity: snapQuantity(negativeStockQuantity),
    costVariancePaise,
    rows,
  };
}

/**
 * Moving (perpetual) weighted average.
 *
 * Every receipt re-averages the whole holding; every issue leaves at the
 * average current at that moment. This is the variant AS 2 permits alongside
 * FIFO and the one Tally calls "Avg. Cost". It is NOT the periodic weighted
 * average (total purchases / total units for the whole period), which would
 * give a different and generally later-weighted number.
 */
export function valuateWeightedAverage(
  entries: StockEntry[],
  options: ValuationOptions = {}
): ValuationResult {
  const openingQuantity = options.openingQuantity ?? 0;
  const openingValuePaise = Math.trunc(options.openingValuePaise ?? 0);
  const includeRows = options.includeRows ?? false;

  let quantity = openingQuantity;
  let valuePaise = openingValuePaise;
  let inQuantity = 0;
  let inValuePaise = 0;
  let outQuantity = 0;
  let cogsPaise = 0;
  let negativeStockQuantity = 0;
  let lastInRatePaise = displayRate(openingValuePaise, openingQuantity);
  const rows: StockLedgerRow[] = [];

  for (const entry of sortEntries(entries)) {
    const qty = Math.abs(entry.quantity);
    if (qty <= QTY_EPSILON) continue;

    if (entry.direction === "IN") {
      const value = entryValue(entry);
      quantity += qty;
      valuePaise += value;
      inQuantity += qty;
      inValuePaise += value;
      lastInRatePaise = displayRate(value, qty) || lastInRatePaise;

      if (includeRows) {
        rows.push({
          id: entry.id,
          date: entry.date,
          direction: "IN",
          reference: entry.reference,
          sourceType: entry.sourceType,
          quantity: qty,
          valuePaise: value,
          ratePaise: displayRate(value, qty),
          balanceQuantity: snapQuantity(quantity),
          balanceValuePaise: valuePaise,
        });
      }
      continue;
    }

    let costPaise: number;
    outQuantity += qty;

    if (quantity <= QTY_EPSILON) {
      // Nothing on hand, so there is no average to issue at.
      const rate = options.fallbackRatePaise ?? lastInRatePaise;
      costPaise = roundHalfUp(rate * qty);
      negativeStockQuantity += qty;
    } else if (qty >= quantity - QTY_EPSILON) {
      // Clearing the holding: take the entire remaining value, then cost any
      // excess at the fallback rate. Taking `value` whole is what keeps the
      // conservation invariant exact.
      const excess = Math.max(0, qty - quantity);
      const rate = options.fallbackRatePaise ?? lastInRatePaise;
      const excessValue = excess > QTY_EPSILON ? roundHalfUp(rate * excess) : 0;
      costPaise = valuePaise + excessValue;
      if (excess > QTY_EPSILON) negativeStockQuantity += excess;
    } else {
      costPaise = roundHalfUp((valuePaise * qty) / quantity);
    }

    quantity -= qty;
    valuePaise -= costPaise;
    cogsPaise += costPaise;

    if (includeRows) {
      rows.push({
        id: entry.id,
        date: entry.date,
        direction: "OUT",
        reference: entry.reference,
        sourceType: entry.sourceType,
        quantity: qty,
        valuePaise: costPaise,
        ratePaise: displayRate(costPaise, qty),
        balanceQuantity: snapQuantity(quantity),
        balanceValuePaise: valuePaise,
      });
    }
  }

  const closingQuantity = snapQuantity(quantity);
  return {
    method: "WEIGHTED_AVERAGE",
    openingQuantity,
    openingValuePaise,
    inQuantity: snapQuantity(inQuantity),
    inValuePaise,
    outQuantity: snapQuantity(outQuantity),
    cogsPaise,
    closingQuantity,
    closingValuePaise: valuePaise,
    closingRatePaise: displayRate(valuePaise, closingQuantity),
    layers: [],
    negativeStockQuantity: snapQuantity(negativeStockQuantity),
    costVariancePaise: 0,
    rows,
  };
}

/** Dispatch on method. */
export function valuate(
  entries: StockEntry[],
  method: ValuationMethod,
  options: ValuationOptions = {}
): ValuationResult {
  return method === "WEIGHTED_AVERAGE"
    ? valuateWeightedAverage(entries, options)
    : valuateFifo(entries, options);
}

/**
 * The invariant, as a function so callers can assert it too.
 * `openingValue + inValue === cogs + closingValue`.
 */
export function valuationConserves(result: ValuationResult): boolean {
  return result.openingValuePaise + result.inValuePaise === result.cogsPaise + result.closingValuePaise;
}

function layerQuantity(layers: FifoLayer[]): number {
  let total = 0;
  for (const l of layers) total += l.quantity;
  return total;
}

function layerValue(layers: FifoLayer[]): Paise {
  let total = 0;
  for (const l of layers) total += l.valuePaise;
  return total;
}

/** Remove accumulated float dust so a cleared item reads 0 and not 3e-16. */
function snapQuantity(quantity: number): number {
  if (Math.abs(quantity) <= QTY_EPSILON) return 0;
  return Math.round(quantity * 1e6) / 1e6;
}

/* ------------------------------------------------------------------ ageing */

export interface AgeingBucket {
  label: string;
  /** Inclusive lower bound in days. */
  fromDays: number;
  /** Inclusive upper bound in days, null for open-ended. */
  toDays: number | null;
  quantity: number;
  valuePaise: Paise;
}

export const AGEING_BUCKETS: { label: string; fromDays: number; toDays: number | null }[] = [
  { label: "0-30 days", fromDays: 0, toDays: 30 },
  { label: "31-60 days", fromDays: 31, toDays: 60 },
  { label: "61-90 days", fromDays: 61, toDays: 90 },
  { label: "91-180 days", fromDays: 91, toDays: 180 },
  { label: "Over 180 days", fromDays: 181, toDays: null },
];

const MS_PER_DAY = 24 * 60 * 60 * 1000;

export function daysBetween(from: Date, to: Date): number {
  return Math.floor((to.getTime() - from.getTime()) / MS_PER_DAY);
}

/**
 * Bucket the remaining FIFO layers by age.
 *
 * Ageing is only meaningful per receipt lot, so it always reads FIFO layers
 * even for a company valuing at weighted average - the ages are a fact about
 * the goods, independent of how their cost was assigned.
 */
export function stockAgeing(layers: FifoLayer[], asOf: Date): AgeingBucket[] {
  const buckets: AgeingBucket[] = AGEING_BUCKETS.map((b) => ({ ...b, quantity: 0, valuePaise: 0 }));
  for (const layer of layers) {
    const age = Math.max(0, daysBetween(layer.date, asOf));
    const bucket =
      buckets.find((b) => age >= b.fromDays && (b.toDays === null || age <= b.toDays)) ??
      buckets[buckets.length - 1];
    bucket.quantity = snapQuantity(bucket.quantity + layer.quantity);
    bucket.valuePaise += layer.valuePaise;
  }
  return buckets;
}

/* ------------------------------------------------------------------ expiry */

export type ExpiryStatus = "EXPIRED" | "EXPIRING_30" | "EXPIRING_90" | "OK" | "NO_EXPIRY";

/**
 * Classify a batch by expiry. Expiry is judged on the DATE, not the instant: a
 * batch expiring today is not expired until tomorrow, which is how a shelf-life
 * date printed on a pack is read.
 */
export function expiryStatus(expiryDate: Date | null | undefined, asOf: Date): ExpiryStatus {
  if (!expiryDate) return "NO_EXPIRY";
  const days = daysBetween(startOfDay(asOf), startOfDay(expiryDate));
  if (days < 0) return "EXPIRED";
  if (days <= 30) return "EXPIRING_30";
  if (days <= 90) return "EXPIRING_90";
  return "OK";
}

export function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

/* -------------------------------------------------------------- dead stock */

export interface DeadStockInput {
  quantity: number;
  valuePaise: Paise;
  /** Last issue date, null when the item has never moved out. */
  lastOutDate: Date | null;
  /**
   * When the stock currently held actually arrived - the date of the oldest
   * remaining FIFO layer. Used when the item has never sold.
   *
   * NOT the item's `createdAt`. That is when the database row was written, which
   * for an item imported from a spreadsheet or created during a migration is
   * today, so a warehouse full of six-month-old unsold goods would report as
   * brand new. This was a real defect caught by verification: the seeded
   * "never sold" item held stock dated 120 days earlier and the report showed it
   * as 0 days idle.
   */
  stockSinceDate: Date | null;
  /** Fallback for an item with no movements at all. */
  createdAt: Date;
}

export interface DeadStockAssessment {
  isDead: boolean;
  /**
   * Days since the last issue, or - for an item that has never sold - how long
   * the stock on hand has been sitting.
   */
  idleDays: number;
  neverSold: boolean;
}

/**
 * An item is dead stock when units are held and nothing has gone out for
 * `thresholdDays`.
 *
 * An item that has never sold is measured from when its stock arrived, so a
 * genuinely new item does not look dead on day one while old unsold stock does.
 */
export function assessDeadStock(
  input: DeadStockInput,
  asOf: Date,
  thresholdDays = 90
): DeadStockAssessment {
  const neverSold = input.lastOutDate === null;
  const since = input.lastOutDate ?? input.stockSinceDate ?? input.createdAt;
  const idleDays = Math.max(0, daysBetween(since, asOf));
  const holdsStock = input.quantity > QTY_EPSILON;
  return { isDead: holdsStock && idleDays >= thresholdDays, idleDays, neverSold };
}

/* ------------------------------------------------------- adjustment reasons */

/**
 * Reasons a stock adjustment can be raised. The direction is fixed per reason
 * so a user cannot file a "damage" that increases stock.
 */
export const ADJUSTMENT_REASONS = {
  DAMAGE: { label: "Damaged / broken", direction: "OUT" as StockDirection },
  EXPIRY: { label: "Expired", direction: "OUT" as StockDirection },
  THEFT: { label: "Theft / loss", direction: "OUT" as StockDirection },
  SAMPLE: { label: "Free sample / gift", direction: "OUT" as StockDirection },
  CONSUMPTION: { label: "Internal consumption", direction: "OUT" as StockDirection },
  SHORTAGE: { label: "Shortage found on count", direction: "OUT" as StockDirection },
  EXCESS: { label: "Excess found on count", direction: "IN" as StockDirection },
  PRODUCTION: { label: "Production / assembly output", direction: "IN" as StockDirection },
  RETURN_TO_STOCK: { label: "Returned to stock", direction: "IN" as StockDirection },
  OPENING: { label: "Opening stock", direction: "IN" as StockDirection },
} as const;

export type AdjustmentReason = keyof typeof ADJUSTMENT_REASONS;

export function isAdjustmentReason(value: unknown): value is AdjustmentReason {
  return typeof value === "string" && value in ADJUSTMENT_REASONS;
}

export function adjustmentDirection(reason: AdjustmentReason): StockDirection {
  return ADJUSTMENT_REASONS[reason].direction;
}

/**
 * Variance between a physical count and the system position.
 * Positive means more on the shelf than in the books.
 */
export function countVariance(systemQuantity: number, countedQuantity: number): number {
  return snapQuantity(countedQuantity - systemQuantity);
}

/** The reason implied by a count variance, or null when the count agrees. */
export function varianceReason(variance: number): AdjustmentReason | null {
  if (Math.abs(variance) <= QTY_EPSILON) return null;
  return variance > 0 ? "EXCESS" : "SHORTAGE";
}
