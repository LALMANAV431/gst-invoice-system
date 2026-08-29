import { describe, expect, it } from "vitest";
import { toPaise } from "./money";
import {
  AGEING_BUCKETS,
  ADJUSTMENT_REASONS,
  StockEntry,
  adjustmentDirection,
  assessDeadStock,
  countVariance,
  daysBetween,
  expiryStatus,
  isAdjustmentReason,
  isValuationMethod,
  stockAgeing,
  valuate,
  valuateFifo,
  valuateWeightedAverage,
  valuationConserves,
  varianceReason,
} from "./inventory";

const DAY = 24 * 60 * 60 * 1000;
const base = new Date("2026-01-01T00:00:00.000Z");
const day = (n: number) => new Date(base.getTime() + n * DAY);

function inEntry(n: number, quantity: number, rupeesPerUnit: number, id?: string): StockEntry {
  return {
    id: id ?? `in-${n}-${quantity}`,
    date: day(n),
    direction: "IN",
    quantity,
    valuePaise: toPaise(rupeesPerUnit * quantity),
    ratePaise: toPaise(rupeesPerUnit),
  };
}

function outEntry(n: number, quantity: number, id?: string): StockEntry {
  return { id: id ?? `out-${n}-${quantity}`, date: day(n), direction: "OUT", quantity };
}

describe("FIFO valuation", () => {
  it("values an untouched receipt at its own cost", () => {
    const r = valuateFifo([inEntry(1, 10, 100)]);
    expect(r.closingQuantity).toBe(10);
    expect(r.closingValuePaise).toBe(toPaise(1000));
    expect(r.cogsPaise).toBe(0);
    expect(valuationConserves(r)).toBe(true);
  });

  it("issues the oldest cost first", () => {
    // 10 @ 100 then 10 @ 150; issue 10 -> cost must be the 100s.
    const r = valuateFifo([inEntry(1, 10, 100), inEntry(2, 10, 150)]);
    const withIssue = valuateFifo([inEntry(1, 10, 100), inEntry(2, 10, 150), outEntry(3, 10)]);
    expect(r.closingValuePaise).toBe(toPaise(2500));
    expect(withIssue.cogsPaise).toBe(toPaise(1000));
    expect(withIssue.closingValuePaise).toBe(toPaise(1500));
    expect(withIssue.closingRatePaise).toBe(toPaise(150));
  });

  it("spans layers when an issue is larger than the oldest lot", () => {
    const r = valuateFifo([inEntry(1, 10, 100), inEntry(2, 10, 150), outEntry(3, 15)]);
    // 10 @ 100 + 5 @ 150 = 1000 + 750
    expect(r.cogsPaise).toBe(toPaise(1750));
    expect(r.closingQuantity).toBe(5);
    expect(r.closingValuePaise).toBe(toPaise(750));
  });

  it("differs from weighted average on the same movements", () => {
    const entries = [inEntry(1, 10, 100), inEntry(2, 10, 150), outEntry(3, 10)];
    const fifo = valuateFifo(entries);
    const wa = valuateWeightedAverage(entries);
    expect(fifo.cogsPaise).toBe(toPaise(1000));
    expect(wa.cogsPaise).toBe(toPaise(1250));
    // Same goods, same money in, different split between cost and stock.
    expect(fifo.cogsPaise + fifo.closingValuePaise).toBe(wa.cogsPaise + wa.closingValuePaise);
  });

  it("carries an opening balance without re-replaying history", () => {
    const r = valuateFifo([outEntry(5, 4)], {
      openingQuantity: 10,
      openingValuePaise: toPaise(1000),
    });
    expect(r.cogsPaise).toBe(toPaise(400));
    expect(r.closingQuantity).toBe(6);
    expect(r.closingValuePaise).toBe(toPaise(600));
    expect(valuationConserves(r)).toBe(true);
  });

  it("orders a same-day receipt before a same-day issue", () => {
    // Buy and sell on the same day: must NOT report negative stock.
    const r = valuateFifo([outEntry(1, 5), inEntry(1, 5, 200)]);
    expect(r.negativeStockQuantity).toBe(0);
    expect(r.cogsPaise).toBe(toPaise(1000));
    expect(r.closingQuantity).toBe(0);
  });

  it("clears float dust to an exact zero", () => {
    const r = valuateFifo([inEntry(1, 0.3, 100), inEntry(2, 0.6, 100), outEntry(3, 0.9)]);
    expect(r.closingQuantity).toBe(0);
    expect(r.closingValuePaise).toBe(0);
  });

  it("assigns the whole remaining value when a layer is exhausted", () => {
    // 3 units costing 100 paise total does not divide evenly.
    const r = valuateFifo([
      { id: "a", date: day(1), direction: "IN", quantity: 3, valuePaise: 100 },
      outEntry(2, 1),
      outEntry(3, 1),
      outEntry(4, 1),
    ]);
    expect(r.cogsPaise).toBe(100);
    expect(r.closingValuePaise).toBe(0);
    expect(valuationConserves(r)).toBe(true);
  });

  it("keeps every paise of a 1/3 split", () => {
    const r = valuateFifo([
      { id: "a", date: day(1), direction: "IN", quantity: 3, valuePaise: 1000 },
      outEntry(2, 2),
    ]);
    // 2/3 of 1000 = 666.67 -> 667 rounded once, leaving 333 in stock.
    expect(r.cogsPaise).toBe(667);
    expect(r.closingValuePaise).toBe(333);
    expect(valuationConserves(r)).toBe(true);
  });
});

describe("FIFO negative stock", () => {
  it("costs an issue with no stock at the fallback rate", () => {
    const r = valuateFifo([outEntry(1, 5)], { fallbackRatePaise: toPaise(80) });
    expect(r.negativeStockQuantity).toBe(5);
    expect(r.cogsPaise).toBe(toPaise(400));
    expect(r.closingQuantity).toBe(-5);
    expect(r.closingValuePaise).toBe(toPaise(-400));
    expect(valuationConserves(r)).toBe(true);
  });

  it("does not silently cost a negative issue at zero", () => {
    // No fallback and no prior receipt: the rate is genuinely unknown, but the
    // quantity must still be disclosed.
    const r = valuateFifo([outEntry(1, 5)]);
    expect(r.negativeStockQuantity).toBe(5);
    expect(r.closingQuantity).toBe(-5);
  });

  it("uses the last known receipt rate when no fallback is given", () => {
    const r = valuateFifo([inEntry(1, 2, 500), outEntry(2, 5)]);
    // 2 @ 500 from stock, 3 more at the last known 500.
    expect(r.cogsPaise).toBe(toPaise(2500));
    expect(r.negativeStockQuantity).toBe(3);
  });

  it("squares a negative position off the next receipt", () => {
    const r = valuateFifo([outEntry(1, 5), inEntry(2, 5, 100)], { fallbackRatePaise: toPaise(100) });
    expect(r.closingQuantity).toBe(0);
    expect(r.closingValuePaise).toBe(0);
    expect(r.cogsPaise).toBe(toPaise(500));
    expect(r.costVariancePaise).toBe(0);
    expect(valuationConserves(r)).toBe(true);
  });

  it("recognises a cost variance when the fill rate differs from the guess", () => {
    // Guessed 100/unit, actually cost 120/unit: 5 x 20 = 100 rupees understated.
    const r = valuateFifo([outEntry(1, 5), inEntry(2, 5, 120)], { fallbackRatePaise: toPaise(100) });
    expect(r.costVariancePaise).toBe(toPaise(100));
    expect(r.cogsPaise).toBe(toPaise(600));
    expect(r.closingQuantity).toBe(0);
    expect(r.closingValuePaise).toBe(0);
    expect(valuationConserves(r)).toBe(true);
  });

  it("credits COGS when the fill was cheaper than the guess", () => {
    const r = valuateFifo([outEntry(1, 5), inEntry(2, 5, 60)], { fallbackRatePaise: toPaise(100) });
    expect(r.costVariancePaise).toBe(toPaise(-200));
    expect(r.cogsPaise).toBe(toPaise(300));
    expect(valuationConserves(r)).toBe(true);
  });

  it("leaves a partially filled negative position negative", () => {
    const r = valuateFifo([outEntry(1, 10), inEntry(2, 4, 100)], { fallbackRatePaise: toPaise(100) });
    expect(r.closingQuantity).toBe(-6);
    expect(r.closingValuePaise).toBe(toPaise(-600));
    expect(valuationConserves(r)).toBe(true);
  });

  it("puts a receipt beyond the deficit back into stock", () => {
    const r = valuateFifo([outEntry(1, 4), inEntry(2, 10, 100)], { fallbackRatePaise: toPaise(100) });
    expect(r.closingQuantity).toBe(6);
    expect(r.closingValuePaise).toBe(toPaise(600));
    expect(valuationConserves(r)).toBe(true);
  });

  it("accepts a negative opening position", () => {
    const r = valuateFifo([inEntry(1, 5, 100)], {
      openingQuantity: -3,
      openingValuePaise: toPaise(-300),
    });
    expect(r.closingQuantity).toBe(2);
    expect(r.closingValuePaise).toBe(toPaise(200));
    expect(valuationConserves(r)).toBe(true);
  });
});

describe("weighted average valuation", () => {
  it("re-averages on every receipt", () => {
    // 10 @ 100 + 10 @ 150 -> 20 @ 125
    const r = valuateWeightedAverage([inEntry(1, 10, 100), inEntry(2, 10, 150)]);
    expect(r.closingRatePaise).toBe(toPaise(125));
    expect(r.closingValuePaise).toBe(toPaise(2500));
  });

  it("issues at the average current at that moment, not the final one", () => {
    // Issue 10 at 100 BEFORE the 150 receipt: cost is 1000, not 1250.
    const r = valuateWeightedAverage([inEntry(1, 10, 100), outEntry(2, 10), inEntry(3, 10, 150)]);
    expect(r.cogsPaise).toBe(toPaise(1000));
    expect(r.closingValuePaise).toBe(toPaise(1500));
  });

  it("takes the entire remaining value when the holding is cleared", () => {
    const r = valuateWeightedAverage([
      { id: "a", date: day(1), direction: "IN", quantity: 3, valuePaise: 100 },
      outEntry(2, 3),
    ]);
    expect(r.cogsPaise).toBe(100);
    expect(r.closingValuePaise).toBe(0);
    expect(valuationConserves(r)).toBe(true);
  });

  it("costs an over-issue at the fallback rate and goes negative", () => {
    const r = valuateWeightedAverage([inEntry(1, 5, 100), outEntry(2, 8)], {
      fallbackRatePaise: toPaise(100),
    });
    expect(r.closingQuantity).toBe(-3);
    expect(r.negativeStockQuantity).toBe(3);
    expect(r.cogsPaise).toBe(toPaise(800));
    expect(valuationConserves(r)).toBe(true);
  });

  it("costs an issue against nothing at the fallback rate", () => {
    const r = valuateWeightedAverage([outEntry(1, 4)], { fallbackRatePaise: toPaise(250) });
    expect(r.cogsPaise).toBe(toPaise(1000));
    expect(r.closingValuePaise).toBe(toPaise(-1000));
    expect(valuationConserves(r)).toBe(true);
  });

  it("carries an opening balance", () => {
    const r = valuateWeightedAverage([outEntry(1, 5)], {
      openingQuantity: 20,
      openingValuePaise: toPaise(2000),
    });
    expect(r.cogsPaise).toBe(toPaise(500));
    expect(r.closingQuantity).toBe(15);
  });

  it("has no layers, so ageing cannot come from it", () => {
    const r = valuateWeightedAverage([inEntry(1, 10, 100)]);
    expect(r.layers).toEqual([]);
  });
});

describe("valuation dispatch", () => {
  it("routes to the requested method", () => {
    const entries = [inEntry(1, 10, 100), inEntry(2, 10, 200), outEntry(3, 10)];
    expect(valuate(entries, "FIFO").cogsPaise).toBe(toPaise(1000));
    expect(valuate(entries, "WEIGHTED_AVERAGE").cogsPaise).toBe(toPaise(1500));
  });

  it("recognises valid method names only", () => {
    expect(isValuationMethod("FIFO")).toBe(true);
    expect(isValuationMethod("WEIGHTED_AVERAGE")).toBe(true);
    expect(isValuationMethod("LIFO")).toBe(false);
    expect(isValuationMethod(null)).toBe(false);
  });

  it("ignores zero-quantity movements", () => {
    const r = valuateFifo([inEntry(1, 10, 100), outEntry(2, 0)]);
    expect(r.outQuantity).toBe(0);
    expect(r.rows).toEqual([]);
  });

  it("treats a movement with a rate but no total as rate x quantity", () => {
    const r = valuateFifo([{ id: "a", date: day(1), direction: "IN", quantity: 4, ratePaise: 2550 }]);
    expect(r.closingValuePaise).toBe(10200);
  });

  it("values a receipt with neither rate nor total at zero rather than NaN", () => {
    const r = valuateFifo([{ id: "a", date: day(1), direction: "IN", quantity: 4 }]);
    expect(r.closingValuePaise).toBe(0);
    expect(Number.isNaN(r.closingValuePaise)).toBe(false);
  });
});

describe("stock ledger rows", () => {
  it("are omitted unless asked for", () => {
    expect(valuateFifo([inEntry(1, 5, 100)]).rows).toEqual([]);
  });

  it("show the running balance after each movement", () => {
    const r = valuateFifo([inEntry(1, 10, 100), inEntry(2, 10, 150), outEntry(3, 15)], {
      includeRows: true,
    });
    expect(r.rows).toHaveLength(3);
    expect(r.rows[0].balanceQuantity).toBe(10);
    expect(r.rows[1].balanceQuantity).toBe(20);
    expect(r.rows[1].balanceValuePaise).toBe(toPaise(2500));
    expect(r.rows[2].direction).toBe("OUT");
    expect(r.rows[2].valuePaise).toBe(toPaise(1750));
    expect(r.rows[2].ratePaise).toBe(toPaise(1750 / 15));
    expect(r.rows[2].balanceQuantity).toBe(5);
  });

  it("show the moving average as the balance rate under weighted average", () => {
    const r = valuateWeightedAverage([inEntry(1, 10, 100), inEntry(2, 10, 150)], {
      includeRows: true,
    });
    expect(r.rows[1].balanceValuePaise).toBe(toPaise(2500));
  });

  it("are emitted in value-movement order regardless of input order", () => {
    const r = valuateFifo([outEntry(3, 5), inEntry(1, 10, 100)], { includeRows: true });
    expect(r.rows.map((row) => row.direction)).toEqual(["IN", "OUT"]);
  });
});

describe("conservation invariant", () => {
  it("holds for a randomised movement stream under both methods", () => {
    // A deterministic pseudo-random walk: awkward quantities and rates, plenty
    // of over-issues, so both the rounding and the negative paths are hit.
    let seed = 987654321;
    const next = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };

    for (let trial = 0; trial < 200; trial++) {
      const entries: StockEntry[] = [];
      for (let i = 0; i < 25; i++) {
        const quantity = Math.round(next() * 900) / 100 + 0.01;
        if (next() < 0.5) {
          entries.push({
            id: `e${i}`,
            date: day(i),
            direction: "IN",
            quantity,
            valuePaise: Math.round(next() * 100000) + 1,
          });
        } else {
          entries.push({ id: `e${i}`, date: day(i), direction: "OUT", quantity });
        }
      }
      const options = { fallbackRatePaise: 3333, openingQuantity: 2.5, openingValuePaise: 7777 };
      const fifo = valuateFifo(entries, options);
      const wa = valuateWeightedAverage(entries, options);
      expect(valuationConserves(fifo), `FIFO trial ${trial}`).toBe(true);
      expect(valuationConserves(wa), `WA trial ${trial}`).toBe(true);
      // Both methods must agree on quantity even when they disagree on value.
      expect(fifo.closingQuantity).toBeCloseTo(wa.closingQuantity, 6);
    }
  });

  it("keeps closing value integral in paise", () => {
    const r = valuateFifo([
      { id: "a", date: day(1), direction: "IN", quantity: 7, valuePaise: 1000 },
      outEntry(2, 3),
    ]);
    expect(Number.isInteger(r.closingValuePaise)).toBe(true);
    expect(Number.isInteger(r.cogsPaise)).toBe(true);
  });
});

describe("stock ageing", () => {
  const asOf = day(200);

  it("buckets layers by receipt age", () => {
    const r = valuateFifo([inEntry(190, 5, 100), inEntry(120, 3, 100), inEntry(1, 2, 100)]);
    const buckets = stockAgeing(r.layers, asOf);
    const byLabel = Object.fromEntries(buckets.map((b) => [b.label, b.quantity]));
    expect(byLabel["0-30 days"]).toBe(5); // 10 days old
    expect(byLabel["61-90 days"]).toBe(3); // 80 days old
    expect(byLabel["Over 180 days"]).toBe(2); // 199 days old
  });

  it("totals back to the closing position", () => {
    const r = valuateFifo([inEntry(10, 5, 100), inEntry(100, 5, 250)]);
    const buckets = stockAgeing(r.layers, asOf);
    const qty = buckets.reduce((s, b) => s + b.quantity, 0);
    const value = buckets.reduce((s, b) => s + b.valuePaise, 0);
    expect(qty).toBe(r.closingQuantity);
    expect(value).toBe(r.closingValuePaise);
  });

  it("treats a future-dated receipt as age zero rather than negative", () => {
    const buckets = stockAgeing([{ date: day(250), quantity: 4, valuePaise: 400 }], asOf);
    expect(buckets[0].label).toBe("0-30 days");
    expect(buckets[0].quantity).toBe(4);
  });

  it("returns every bucket even when empty", () => {
    expect(stockAgeing([], asOf)).toHaveLength(AGEING_BUCKETS.length);
  });

  it("puts a boundary age in the lower bucket", () => {
    const buckets = stockAgeing([{ date: day(170), quantity: 1, valuePaise: 100 }], asOf);
    const hit = buckets.find((b) => b.quantity === 1);
    expect(hit?.label).toBe("0-30 days"); // exactly 30 days
  });

  it("counts whole days between dates", () => {
    expect(daysBetween(day(0), day(45))).toBe(45);
    expect(daysBetween(day(45), day(0))).toBe(-45);
  });
});

describe("batch expiry", () => {
  const asOf = new Date("2026-06-15T14:30:00.000Z");

  it("reports a batch with no expiry date as such", () => {
    expect(expiryStatus(null, asOf)).toBe("NO_EXPIRY");
    expect(expiryStatus(undefined, asOf)).toBe("NO_EXPIRY");
  });

  it("does not treat a batch expiring today as already expired", () => {
    expect(expiryStatus(new Date("2026-06-15T00:00:00.000Z"), asOf)).toBe("EXPIRING_30");
  });

  it("reports yesterday as expired", () => {
    expect(expiryStatus(new Date("2026-06-14T23:00:00.000Z"), asOf)).toBe("EXPIRED");
  });

  it("bands the near-expiry window", () => {
    expect(expiryStatus(new Date("2026-07-10T00:00:00.000Z"), asOf)).toBe("EXPIRING_30");
    expect(expiryStatus(new Date("2026-08-20T00:00:00.000Z"), asOf)).toBe("EXPIRING_90");
    expect(expiryStatus(new Date("2027-01-01T00:00:00.000Z"), asOf)).toBe("OK");
  });
});

describe("dead stock", () => {
  const asOf = day(200);

  it("flags stock that has not moved for the threshold", () => {
    const r = assessDeadStock(
      {
        quantity: 10,
        valuePaise: 1000,
        lastOutDate: day(50),
        stockSinceDate: day(1),
        createdAt: day(1),
      },
      asOf,
      90
    );
    expect(r.isDead).toBe(true);
    expect(r.idleDays).toBe(150);
    expect(r.neverSold).toBe(false);
  });

  it("does not flag stock that moved recently", () => {
    const r = assessDeadStock(
      {
        quantity: 10,
        valuePaise: 1000,
        lastOutDate: day(180),
        stockSinceDate: day(1),
        createdAt: day(1),
      },
      asOf,
      90
    );
    expect(r.isDead).toBe(false);
  });

  it("does not flag an item holding nothing", () => {
    const r = assessDeadStock(
      {
        quantity: 0,
        valuePaise: 0,
        lastOutDate: day(1),
        stockSinceDate: day(1),
        createdAt: day(1),
      },
      asOf,
      90
    );
    expect(r.isDead).toBe(false);
  });

  it("measures a never-sold item from when its stock arrived", () => {
    const r = assessDeadStock(
      {
        quantity: 5,
        valuePaise: 500,
        lastOutDate: null,
        stockSinceDate: day(199),
        createdAt: day(199),
      },
      asOf,
      90
    );
    expect(r.neverSold).toBe(true);
    expect(r.idleDays).toBe(1);
    expect(r.isDead).toBe(false);
  });

  it("flags a never-sold item once its stock is old enough", () => {
    const r = assessDeadStock(
      {
        quantity: 5,
        valuePaise: 500,
        lastOutDate: null,
        stockSinceDate: day(10),
        createdAt: day(10),
      },
      asOf,
      90
    );
    expect(r.isDead).toBe(true);
    expect(r.neverSold).toBe(true);
  });

  it("ignores the row creation date when the stock is older than the row", () => {
    // The defect this replaces: an item imported from a spreadsheet TODAY, whose
    // stock actually arrived six months ago, reported as 0 days idle because
    // `createdAt` was used instead of the age of the goods.
    const r = assessDeadStock(
      {
        quantity: 18,
        valuePaise: 6120,
        lastOutDate: null,
        stockSinceDate: day(20),
        createdAt: day(200), // row written today
      },
      asOf,
      90
    );
    expect(r.idleDays).toBe(180);
    expect(r.isDead).toBe(true);
  });

  it("falls back to the row date for an item with no stock history", () => {
    const r = assessDeadStock(
      {
        quantity: 5,
        valuePaise: 500,
        lastOutDate: null,
        stockSinceDate: null,
        createdAt: day(10),
      },
      asOf,
      90
    );
    expect(r.idleDays).toBe(190);
    expect(r.isDead).toBe(true);
  });
});

describe("adjustment reasons", () => {
  it("fixes the direction so a loss cannot increase stock", () => {
    expect(adjustmentDirection("DAMAGE")).toBe("OUT");
    expect(adjustmentDirection("THEFT")).toBe("OUT");
    expect(adjustmentDirection("EXCESS")).toBe("IN");
    expect(adjustmentDirection("PRODUCTION")).toBe("IN");
  });

  it("validates reason codes", () => {
    expect(isAdjustmentReason("DAMAGE")).toBe(true);
    expect(isAdjustmentReason("MYSTERY")).toBe(false);
    expect(isAdjustmentReason(undefined)).toBe(false);
  });

  it("gives every reason a human label", () => {
    for (const [code, meta] of Object.entries(ADJUSTMENT_REASONS)) {
      expect(meta.label.length, code).toBeGreaterThan(3);
    }
  });
});

describe("physical count variance", () => {
  it("is positive when the shelf holds more than the books", () => {
    expect(countVariance(10, 12)).toBe(2);
    expect(varianceReason(2)).toBe("EXCESS");
  });

  it("is negative when stock is missing", () => {
    expect(countVariance(10, 7)).toBe(-3);
    expect(varianceReason(-3)).toBe("SHORTAGE");
  });

  it("needs no adjustment when the count agrees", () => {
    expect(countVariance(10, 10)).toBe(0);
    expect(varianceReason(0)).toBe(null);
  });

  it("treats float dust as agreement", () => {
    expect(countVariance(0.1 + 0.2, 0.3)).toBe(0);
    expect(varianceReason(countVariance(0.1 + 0.2, 0.3))).toBe(null);
  });
});
