import { describe, expect, it } from "vitest";
import {
  addPaise,
  formatPaise,
  mulPaise,
  percentOf,
  roundHalfUp,
  roundOffToRupee,
  splitPaise,
  subPaise,
  toPaise,
  toRupees,
} from "./money";

describe("toPaise", () => {
  it("converts whole rupees", () => {
    expect(toPaise(100)).toBe(10000);
    expect(toPaise(0)).toBe(0);
  });

  it("converts rupees with paise", () => {
    expect(toPaise(1234.56)).toBe(123456);
    expect(toPaise(33.33)).toBe(3333);
  });

  it("parses strings exactly, without parseFloat drift", () => {
    // parseFloat("0.145") * 100 === 14.499999999999998, which would truncate to 14.
    expect(toPaise("0.145")).toBe(15);
    expect(toPaise("1234.56")).toBe(123456);
    expect(toPaise("0.1")).toBe(10);
    expect(toPaise(".5")).toBe(50);
    expect(toPaise("")).toBe(0);
  });

  it("handles negatives for credit notes", () => {
    expect(toPaise(-99.99)).toBe(-9999);
    expect(toPaise("-99.99")).toBe(-9999);
  });

  it("rejects non-finite input", () => {
    expect(() => toPaise(Number.NaN)).toThrow(TypeError);
    expect(() => toPaise(Number.POSITIVE_INFINITY)).toThrow(TypeError);
  });
});

describe("roundHalfUp", () => {
  it("rounds .5 away from zero symmetrically", () => {
    expect(roundHalfUp(2.5)).toBe(3);
    // Math.round(-2.5) is -2, which breaks credit-note symmetry.
    expect(roundHalfUp(-2.5)).toBe(-3);
    expect(roundHalfUp(2.4)).toBe(2);
    expect(roundHalfUp(-2.4)).toBe(-2);
  });
});

describe("float drift is eliminated", () => {
  it("sums 100 identical lines exactly (the original bug)", () => {
    // The original float accumulator produced 9998.999999999984 here.
    const linePaise = mulPaise(toPaise(33.33), 3); // 9999 paise = Rs 99.99
    let total = 0;
    for (let i = 0; i < 100; i++) {
      total = addPaise(total, linePaise);
    }
    expect(total).toBe(999900);
    expect(toRupees(total)).toBe(9999);
  });

  it("0.1 + 0.2 style errors cannot occur", () => {
    expect(addPaise(toPaise(0.1), toPaise(0.2))).toBe(30);
    expect(toRupees(addPaise(toPaise(0.1), toPaise(0.2)))).toBe(0.3);
  });
});

describe("splitPaise", () => {
  it("splits evenly when possible", () => {
    expect(splitPaise(1000, 2)).toEqual([500, 500]);
  });

  it("splits an odd amount so the parts still reconcile exactly", () => {
    const parts = splitPaise(525, 2);
    expect(parts).toEqual([263, 262]);
    expect(addPaise(...parts)).toBe(525);
  });

  it("always reconciles for any amount and part count", () => {
    for (const amount of [1, 7, 99, 525, 100001]) {
      for (const parts of [2, 3, 7]) {
        expect(addPaise(...splitPaise(amount, parts))).toBe(amount);
      }
    }
  });

  it("handles negatives without losing a paisa", () => {
    const parts = splitPaise(-525, 2);
    expect(addPaise(...parts)).toBe(-525);
  });

  it("rejects invalid part counts", () => {
    expect(() => splitPaise(100, 0)).toThrow(TypeError);
  });
});

describe("percentOf", () => {
  it("computes GST rates exactly", () => {
    expect(percentOf(100000, 18)).toBe(18000); // Rs 1000 @ 18% = Rs 180
    expect(percentOf(10505, 5)).toBe(525); // Rs 105.05 @ 5% = Rs 5.25
    expect(percentOf(100000, 0.25)).toBe(250);
  });
});

describe("roundOffToRupee", () => {
  it("rounds up and reports the adjustment", () => {
    const { total, adjustment } = roundOffToRupee(10056);
    expect(total).toBe(10100);
    expect(adjustment).toBe(44);
  });

  it("rounds down and reports a negative adjustment", () => {
    const { total, adjustment } = roundOffToRupee(10044);
    expect(total).toBe(10000);
    expect(adjustment).toBe(-44);
  });

  it("leaves exact rupee amounts untouched", () => {
    expect(roundOffToRupee(10000)).toEqual({ total: 10000, adjustment: 0 });
  });

  it("total always equals input plus adjustment", () => {
    for (const amount of [1, 49, 50, 51, 12345, 99999]) {
      const { total, adjustment } = roundOffToRupee(amount);
      expect(subPaise(total, adjustment)).toBe(amount);
    }
  });
});

describe("guards against float leakage", () => {
  it("rejects fractional paise in arithmetic helpers", () => {
    expect(() => addPaise(10.5)).toThrow(TypeError);
    expect(() => subPaise(10.5, 1)).toThrow(TypeError);
    expect(() => toRupees(10.5)).toThrow(TypeError);
  });
});

describe("formatPaise", () => {
  it("formats in the Indian numbering system", () => {
    // Non-breaking space and grouping come from Intl; assert on the digits.
    expect(formatPaise(123456)).toContain("1,234.56");
    expect(formatPaise(10000000)).toContain("1,00,000.00");
  });
});
