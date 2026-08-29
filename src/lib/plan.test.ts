import { describe, expect, it } from "vitest";
import { toPaise } from "./money";
import {
  FEATURE_LABELS,
  PLANS,
  getPlan,
  hasFeature,
  invoiceLimitFor,
  planActive,
  type Feature,
  type PlanId,
} from "./plan";

/**
 * These tests exist because of a real mispricing bug.
 *
 * `PlanConfig.price` was declared "monthly in INR" and set to `299`, while
 * `getEffectivePlans()` overwrote the same field with
 * `PlanSetting.priceMonthlyPaise` from the database. Every consumer rendered it
 * with `formatPaise()`. The result: correct once a PlanSetting row existed, and
 * wrong on a fresh install, which fell back to the defaults and advertised the
 * Basic plan at Rs 2.99.
 *
 * The field is now `priceMonthlyPaise`, named for its unit. The assertions below
 * pin the actual rupee amounts so a future edit cannot quietly reintroduce a
 * hundred-fold error.
 */

const IDS: PlanId[] = ["FREE", "BASIC", "PREMIUM"];

describe("plan pricing units", () => {
  it("states every price in integer paise", () => {
    for (const id of IDS) {
      const plan = PLANS[id];
      expect(Number.isSafeInteger(plan.priceMonthlyPaise), `${id} monthly`).toBe(true);
      expect(Number.isSafeInteger(plan.priceAnnualPaise), `${id} annual`).toBe(true);
      expect(plan.priceMonthlyPaise).toBeGreaterThanOrEqual(0);
    }
  });

  it("prices the plans at the advertised rupee amounts", () => {
    expect(PLANS.FREE.priceMonthlyPaise).toBe(0);
    expect(PLANS.BASIC.priceMonthlyPaise).toBe(toPaise(299));
    expect(PLANS.PREMIUM.priceMonthlyPaise).toBe(toPaise(999));
    // Rs 299, not Rs 2.99 and not Rs 29,900.
    expect(PLANS.BASIC.priceMonthlyPaise).toBe(29_900);
    expect(PLANS.PREMIUM.priceMonthlyPaise).toBe(99_900);
  });

  it("discounts the annual price against twelve months", () => {
    for (const id of ["BASIC", "PREMIUM"] as const) {
      const plan = PLANS[id];
      const twelveMonths = plan.priceMonthlyPaise * 12;
      expect(plan.priceAnnualPaise, `${id} annual should be cheaper than 12x monthly`)
        .toBeLessThan(twelveMonths);
      expect(plan.priceAnnualPaise).toBeGreaterThan(0);
    }
    expect(PLANS.FREE.priceAnnualPaise).toBe(0);
  });

  it("keeps the free plan free", () => {
    expect(PLANS.FREE.priceMonthlyPaise).toBe(0);
    expect(PLANS.FREE.priceAnnualPaise).toBe(0);
  });
});

describe("plan resolution", () => {
  it("falls back to FREE for unknown or missing ids", () => {
    expect(getPlan(null).id).toBe("FREE");
    expect(getPlan(undefined).id).toBe("FREE");
    expect(getPlan("ENTERPRISE").id).toBe("FREE");
  });

  it("downgrades an expired paid plan to FREE", () => {
    const yesterday = new Date(Date.now() - 86_400_000);
    expect(planActive("PREMIUM", yesterday)).toBe("FREE");
    expect(planActive("BASIC", yesterday)).toBe("FREE");
  });

  it("keeps an unexpired paid plan active", () => {
    const nextMonth = new Date(Date.now() + 30 * 86_400_000);
    expect(planActive("PREMIUM", nextMonth)).toBe("PREMIUM");
  });

  it("treats a paid plan with no expiry as active", () => {
    // A lifetime or manually granted plan must not silently downgrade.
    expect(planActive("BASIC", null)).toBe("BASIC");
  });

  it("never expires the free plan", () => {
    expect(planActive("FREE", new Date(0))).toBe("FREE");
  });
});

describe("plan entitlements", () => {
  it("gates paid features away from the free plan", () => {
    expect(hasFeature("FREE", "godowns")).toBe(false);
    expect(hasFeature("FREE", "audit_trail")).toBe(false);
    expect(hasFeature("FREE", "e_invoice")).toBe(false);
  });

  it("grows monotonically: every Basic feature is in Premium", () => {
    // A plan that costs more must never offer less.
    for (const feature of PLANS.BASIC.features) {
      expect(PLANS.PREMIUM.features, `Premium is missing ${feature}`).toContain(feature);
    }
    for (const feature of PLANS.FREE.features) {
      expect(PLANS.BASIC.features, `Basic is missing ${feature}`).toContain(feature);
    }
  });

  it("prices higher plans above lower ones", () => {
    expect(PLANS.BASIC.priceMonthlyPaise).toBeGreaterThan(PLANS.FREE.priceMonthlyPaise);
    expect(PLANS.PREMIUM.priceMonthlyPaise).toBeGreaterThan(PLANS.BASIC.priceMonthlyPaise);
  });

  it("labels every feature it sells", () => {
    const all = new Set<Feature>();
    for (const id of IDS) for (const f of PLANS[id].features) all.add(f);
    for (const f of all) {
      expect(FEATURE_LABELS[f], `no label for ${f}`).toBeTruthy();
    }
  });

  it("caps free invoices and uncaps paid ones", () => {
    expect(invoiceLimitFor("FREE")).toBe(20);
    expect(invoiceLimitFor("BASIC")).toBe(Infinity);
    expect(invoiceLimitFor("PREMIUM")).toBe(Infinity);
  });

  it("raises the user limit with the plan", () => {
    expect(PLANS.FREE.userLimit).toBeLessThan(PLANS.BASIC.userLimit);
    expect(PLANS.BASIC.userLimit).toBeLessThan(PLANS.PREMIUM.userLimit);
  });
});
