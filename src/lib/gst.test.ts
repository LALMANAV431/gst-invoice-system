import { describe, expect, it } from "vitest";
import { addPaise, toPaise, toRupees } from "./money";
import {
  apportionByWeight,
  computeGstInvoice,
  isInterStateSupply,
  isValidGstin,
  normaliseStateCode,
  panFromGstin,
  stateCodeFromGstin,
  stateNameFromCode,
} from "./gst";

// Karnataka (29) supplier used throughout.
const KA = "29";
const MH = "27";

describe("place of supply", () => {
  it("treats same state as intra-state", () => {
    expect(isInterStateSupply(KA, KA)).toBe(false);
  });

  it("treats different states as inter-state", () => {
    expect(isInterStateSupply(KA, MH)).toBe(true);
  });

  it("falls back to intra-state when data is missing", () => {
    // Charging IGST on incomplete data is the more damaging error.
    expect(isInterStateSupply(KA, null)).toBe(false);
    expect(isInterStateSupply(null, MH)).toBe(false);
  });

  it("normalises single-digit codes", () => {
    expect(normaliseStateCode("9")).toBe("09");
    expect(normaliseStateCode("29")).toBe("29");
    expect(normaliseStateCode("abc")).toBeNull();
    expect(isInterStateSupply("9", "09")).toBe(false);
  });
});

describe("intra-state supply: CGST + SGST", () => {
  it("splits GST into equal halves", () => {
    const r = computeGstInvoice({
      supplierStateCode: KA,
      placeOfSupplyStateCode: KA,
      lines: [{ quantity: 1, rate: 1000, gstRate: 18 }],
    });
    expect(r.isInterState).toBe(false);
    expect(r.taxablePaise).toBe(100000);
    expect(r.cgstPaise).toBe(9000);
    expect(r.sgstPaise).toBe(9000);
    expect(r.igstPaise).toBe(0);
    expect(r.grandTotalPaise).toBe(118000);
    expect(toRupees(r.grandTotalPaise)).toBe(1180);
  });

  it("keeps an odd-paise split reconciling exactly (regression)", () => {
    // Rs 105.05 @ 5% = Rs 5.2525 -> 525 paise, which cannot halve evenly.
    const r = computeGstInvoice({
      supplierStateCode: KA,
      placeOfSupplyStateCode: KA,
      lines: [{ quantity: 1, rate: 105.05, gstRate: 5 }],
      roundToNearestRupee: false,
    });
    expect(r.cgstPaise).toBe(263);
    expect(r.sgstPaise).toBe(262);
    // The critical property: halves reconcile to the total tax.
    expect(addPaise(r.cgstPaise, r.sgstPaise)).toBe(r.taxPaise);
    expect(r.netPaise).toBe(addPaise(r.taxablePaise, r.taxPaise));
  });
});

describe("inter-state supply: IGST", () => {
  it("charges IGST only", () => {
    const r = computeGstInvoice({
      supplierStateCode: KA,
      placeOfSupplyStateCode: MH,
      lines: [{ quantity: 1, rate: 1000, gstRate: 18 }],
    });
    expect(r.isInterState).toBe(true);
    expect(r.igstPaise).toBe(18000);
    expect(r.cgstPaise).toBe(0);
    expect(r.sgstPaise).toBe(0);
    expect(r.grandTotalPaise).toBe(118000);
  });
});

describe("invoice-level discount is applied BEFORE tax (regression)", () => {
  it("does not overcharge GST on a discounted invoice", () => {
    // The original code computed grandTotal = subTotal + taxTotal - discount,
    // charging Rs 1800 of GST instead of Rs 1620 - a Rs 180 overcharge.
    const r = computeGstInvoice({
      supplierStateCode: KA,
      placeOfSupplyStateCode: KA,
      lines: [{ quantity: 1, rate: 10000, gstRate: 18 }],
      invoiceDiscount: 1000,
    });
    expect(r.invoiceDiscountPaise).toBe(100000);
    expect(r.taxablePaise).toBe(900000); // Rs 9,000
    expect(r.taxPaise).toBe(162000); // Rs 1,620, NOT Rs 1,800
    expect(r.grandTotalPaise).toBe(1062000); // Rs 10,620
  });

  it("apportions the discount pro-rata across lines at different rates", () => {
    const r = computeGstInvoice({
      supplierStateCode: KA,
      placeOfSupplyStateCode: KA,
      lines: [
        { quantity: 1, rate: 1000, gstRate: 5 },
        { quantity: 1, rate: 3000, gstRate: 18 },
      ],
      invoiceDiscount: 400, // 1:3 split -> Rs 100 and Rs 300
    });
    expect(r.lines[0].apportionedDiscountPaise).toBe(10000);
    expect(r.lines[1].apportionedDiscountPaise).toBe(30000);
    expect(r.lines[0].taxablePaise).toBe(90000); // Rs 900
    expect(r.lines[1].taxablePaise).toBe(270000); // Rs 2,700
    expect(r.lines[0].taxPaise).toBe(4500); // 5% of 900
    expect(r.lines[1].taxPaise).toBe(48600); // 18% of 2700
    // Apportioned parts must sum to the discount exactly.
    expect(
      addPaise(r.lines[0].apportionedDiscountPaise, r.lines[1].apportionedDiscountPaise)
    ).toBe(r.invoiceDiscountPaise);
  });

  it("caps the discount at the taxable value so totals never go negative", () => {
    const r = computeGstInvoice({
      supplierStateCode: KA,
      placeOfSupplyStateCode: KA,
      lines: [{ quantity: 1, rate: 100, gstRate: 18 }],
      invoiceDiscount: 5000,
    });
    expect(r.taxablePaise).toBe(0);
    expect(r.taxPaise).toBe(0);
    expect(r.grandTotalPaise).toBe(0);
  });
});

describe("line-level discount", () => {
  it("reduces taxable value before tax", () => {
    const r = computeGstInvoice({
      supplierStateCode: KA,
      placeOfSupplyStateCode: KA,
      lines: [{ quantity: 10, rate: 100, discount: 200, gstRate: 18 }],
    });
    expect(r.taxablePaise).toBe(80000); // 1000 - 200
    expect(r.taxPaise).toBe(14400); // 18% of 800
  });
});

describe("GST-inclusive (MRP / POS) pricing", () => {
  it("extracts tax from an inclusive price", () => {
    // Rs 118 inclusive @ 18% -> Rs 100 taxable + Rs 18 tax
    const r = computeGstInvoice({
      supplierStateCode: KA,
      placeOfSupplyStateCode: KA,
      lines: [{ quantity: 1, rate: 118, gstRate: 18, pricingMode: "INCLUSIVE" }],
    });
    expect(r.taxablePaise).toBe(10000);
    expect(r.taxPaise).toBe(1800);
    expect(r.grandTotalPaise).toBe(11800);
  });

  it("round-trips an inclusive price back to the shelf price", () => {
    const r = computeGstInvoice({
      supplierStateCode: KA,
      placeOfSupplyStateCode: KA,
      lines: [{ quantity: 3, rate: 249, gstRate: 12, pricingMode: "INCLUSIVE" }],
      roundToNearestRupee: false,
    });
    expect(r.netPaise).toBe(toPaise(747)); // 3 x 249
  });
});

describe("compensation cess", () => {
  it("adds percentage cess on top of GST", () => {
    const r = computeGstInvoice({
      supplierStateCode: KA,
      placeOfSupplyStateCode: KA,
      lines: [{ quantity: 1, rate: 1000, gstRate: 28, cessRate: 12 }],
    });
    expect(r.cgstPaise).toBe(14000);
    expect(r.sgstPaise).toBe(14000);
    expect(r.cessPaise).toBe(12000);
    expect(r.taxPaise).toBe(40000);
    expect(r.grandTotalPaise).toBe(140000); // Rs 1,400
  });

  it("supports flat per-unit cess", () => {
    const r = computeGstInvoice({
      supplierStateCode: KA,
      placeOfSupplyStateCode: KA,
      lines: [{ quantity: 10, rate: 50, gstRate: 28, cessPerUnit: 5 }],
    });
    expect(r.cessPaise).toBe(5000); // 10 units x Rs 5
  });
});

describe("supply types", () => {
  it("charges no tax on exempt, nil-rated, non-GST or zero-rated lines", () => {
    for (const supplyType of ["EXEMPT", "NIL_RATED", "NON_GST", "ZERO_RATED"] as const) {
      const r = computeGstInvoice({
        supplierStateCode: KA,
        placeOfSupplyStateCode: KA,
        lines: [{ quantity: 1, rate: 1000, gstRate: 18, supplyType }],
      });
      expect(r.taxPaise, supplyType).toBe(0);
      expect(r.taxablePaise, supplyType).toBe(100000);
      expect(r.grandTotalPaise, supplyType).toBe(100000);
      expect(r.lines[0].supplyType).toBe(supplyType);
    }
  });

  it("preserves the supply type so GSTR-1 can report it in the right table", () => {
    const r = computeGstInvoice({
      supplierStateCode: KA,
      placeOfSupplyStateCode: MH,
      lines: [
        { quantity: 1, rate: 1000, gstRate: 0, supplyType: "ZERO_RATED" },
        { quantity: 1, rate: 500, gstRate: 0, supplyType: "EXEMPT" },
      ],
    });
    expect(r.lines.map((l) => l.supplyType)).toEqual(["ZERO_RATED", "EXEMPT"]);
  });

  it("mixes taxable and exempt lines on one invoice", () => {
    const r = computeGstInvoice({
      supplierStateCode: KA,
      placeOfSupplyStateCode: KA,
      lines: [
        { quantity: 1, rate: 1000, gstRate: 18 },
        { quantity: 1, rate: 1000, gstRate: 18, supplyType: "EXEMPT" },
      ],
    });
    expect(r.taxablePaise).toBe(200000);
    expect(r.taxPaise).toBe(18000); // only the taxable line
  });
});

describe("reverse charge", () => {
  it("collects no tax from the recipient", () => {
    const r = computeGstInvoice({
      supplierStateCode: KA,
      placeOfSupplyStateCode: KA,
      lines: [{ quantity: 1, rate: 1000, gstRate: 18 }],
      reverseCharge: true,
    });
    expect(r.reverseCharge).toBe(true);
    expect(r.taxPaise).toBe(0);
    expect(r.taxablePaise).toBe(100000);
    expect(r.grandTotalPaise).toBe(100000);
  });
});

describe("additional charges", () => {
  it("taxes freight at the highest line rate by default", () => {
    const r = computeGstInvoice({
      supplierStateCode: KA,
      placeOfSupplyStateCode: KA,
      lines: [
        { quantity: 1, rate: 1000, gstRate: 5 },
        { quantity: 1, rate: 1000, gstRate: 18 },
      ],
      additionalCharges: 100,
    });
    expect(r.additionalChargesPaise).toBe(10000);
    // 5% of 1000 + 18% of 1000 + 18% of 100 = 50 + 180 + 18 = Rs 248
    expect(r.taxPaise).toBe(24800);
    expect(r.taxablePaise).toBe(210000);
  });

  it("honours an explicit charge rate", () => {
    const r = computeGstInvoice({
      supplierStateCode: KA,
      placeOfSupplyStateCode: KA,
      lines: [{ quantity: 1, rate: 1000, gstRate: 18 }],
      additionalCharges: 100,
      additionalChargesGstRate: 5,
    });
    expect(r.taxPaise).toBe(18000 + 500);
  });
});

describe("round off", () => {
  it("rounds the grand total and reports the adjustment", () => {
    const r = computeGstInvoice({
      supplierStateCode: KA,
      placeOfSupplyStateCode: KA,
      lines: [{ quantity: 1, rate: 105.05, gstRate: 5 }],
    });
    expect(r.netPaise).toBe(11030); // Rs 110.30
    expect(r.grandTotalPaise).toBe(11000); // Rs 110
    expect(r.roundOffPaise).toBe(-30);
    // The invoice must always reconcile.
    expect(r.netPaise + r.roundOffPaise).toBe(r.grandTotalPaise);
  });

  it("can be disabled", () => {
    const r = computeGstInvoice({
      supplierStateCode: KA,
      placeOfSupplyStateCode: KA,
      lines: [{ quantity: 1, rate: 105.05, gstRate: 5 }],
      roundToNearestRupee: false,
    });
    expect(r.grandTotalPaise).toBe(11030);
    expect(r.roundOffPaise).toBe(0);
  });
});

describe("TDS is reported separately, not netted into the invoice (regression)", () => {
  it("keeps the invoice face value intact", () => {
    // The original code did grandTotal = ... - tdsAmount, understating the
    // invoice value and the GST-bearing receivable.
    const r = computeGstInvoice({
      supplierStateCode: KA,
      placeOfSupplyStateCode: KA,
      lines: [{ quantity: 1, rate: 10000, gstRate: 18 }],
      tdsRate: 10,
    });
    expect(r.grandTotalPaise).toBe(1180000); // Rs 11,800 stays the invoice value
    expect(r.tdsPaise).toBe(100000); // Rs 1,000 withheld by the customer
    expect(r.expectedReceiptPaise).toBe(1080000); // Rs 10,800 expected in bank
  });
});

describe("rate summary", () => {
  it("groups lines by rate for the invoice tax table", () => {
    const r = computeGstInvoice({
      supplierStateCode: KA,
      placeOfSupplyStateCode: KA,
      lines: [
        { quantity: 1, rate: 1000, gstRate: 18 },
        { quantity: 1, rate: 500, gstRate: 18 },
        { quantity: 1, rate: 200, gstRate: 5 },
      ],
    });
    expect(r.rateSummary).toHaveLength(2);
    const [five, eighteen] = r.rateSummary;
    expect(five.gstRate).toBe(5);
    expect(five.taxablePaise).toBe(20000);
    expect(eighteen.gstRate).toBe(18);
    expect(eighteen.taxablePaise).toBe(150000);
    expect(addPaise(eighteen.cgstPaise, eighteen.sgstPaise)).toBe(27000);
  });
});

describe("invoice-wide reconciliation invariants", () => {
  it("always satisfies taxable + tax + roundOff = grandTotal", () => {
    const scenarios = [
      { lines: [{ quantity: 3, rate: 33.33, gstRate: 18 }] },
      { lines: [{ quantity: 7, rate: 105.05, gstRate: 5 }], invoiceDiscount: 13.37 },
      {
        lines: [
          { quantity: 2.5, rate: 449.99, gstRate: 12 },
          { quantity: 1, rate: 99.5, gstRate: 28, cessRate: 12 },
        ],
        additionalCharges: 75.25,
      },
      {
        lines: [{ quantity: 1, rate: 9999.99, gstRate: 28, cessRate: 22 }],
        invoiceDiscount: 1234.56,
      },
    ];

    for (const [i, scenario] of scenarios.entries()) {
      for (const pos of [KA, MH]) {
        const r = computeGstInvoice({
          supplierStateCode: KA,
          placeOfSupplyStateCode: pos,
          ...scenario,
        });
        expect(
          addPaise(r.taxablePaise, r.taxPaise, r.roundOffPaise),
          `scenario ${i} pos ${pos}`
        ).toBe(r.grandTotalPaise);
        expect(addPaise(r.cgstPaise, r.sgstPaise, r.igstPaise, r.cessPaise)).toBe(r.taxPaise);
        // Every amount must remain an exact integer number of paise.
        expect(Number.isSafeInteger(r.grandTotalPaise)).toBe(true);
        expect(Number.isSafeInteger(r.taxPaise)).toBe(true);
      }
    }
  });

  it("line totals sum to the invoice net", () => {
    const r = computeGstInvoice({
      supplierStateCode: KA,
      placeOfSupplyStateCode: KA,
      lines: [
        { quantity: 3, rate: 33.33, gstRate: 18 },
        { quantity: 1, rate: 105.05, gstRate: 5 },
        { quantity: 2, rate: 500, gstRate: 12 },
      ],
      roundToNearestRupee: false,
    });
    const lineSum = addPaise(...r.lines.map((l) => l.totalPaise));
    expect(lineSum).toBe(r.netPaise);
  });

  it("rejects an invoice with no lines", () => {
    expect(() =>
      computeGstInvoice({ supplierStateCode: KA, placeOfSupplyStateCode: KA, lines: [] })
    ).toThrow(TypeError);
  });
});

describe("apportionByWeight", () => {
  it("distributes without losing a paisa", () => {
    expect(apportionByWeight(100, [1, 1, 1])).toEqual([34, 33, 33]);
    expect(addPaise(...apportionByWeight(100, [1, 1, 1]))).toBe(100);
  });

  it("returns zeros when weights are all zero", () => {
    expect(apportionByWeight(100, [0, 0])).toEqual([0, 0]);
  });

  it("handles a zero total", () => {
    expect(apportionByWeight(0, [5, 5])).toEqual([0, 0]);
  });
});

describe("GSTIN validation", () => {
  it("accepts GSTINs with a valid checksum", () => {
    // These two are independently published valid GSTINs; they anchor the
    // checksum algorithm so these tests verify behaviour rather than just
    // mirroring the implementation.
    expect(isValidGstin("27AAPFU0939F1ZV")).toBe(true);
    expect(isValidGstin("24AAACC1206D1ZM")).toBe(true);
    expect(isValidGstin("29AAACR9876H1ZP")).toBe(true);
  });

  it("rejects a wrong check digit that a regex alone would accept", () => {
    // prisma/seed.ts ships "29AAACR9876H1Z2"; the correct check char is "P".
    expect(isValidGstin("29AAACR9876H1Z2")).toBe(false);
    expect(isValidGstin("27AAPFU0939F1ZX")).toBe(false);
  });

  it("rejects structurally invalid input", () => {
    expect(isValidGstin("")).toBe(false);
    expect(isValidGstin("29AAACR9876H1Z")).toBe(false); // too short
    expect(isValidGstin("XXAAACR9876H1ZP")).toBe(false); // non-numeric state
    expect(isValidGstin("29AAACR9876H1AP")).toBe(false); // 14th char must be Z
    // @ts-expect-error guarding against non-string input at runtime
    expect(isValidGstin(null)).toBe(false);
  });

  it("is case-insensitive and trims whitespace", () => {
    expect(isValidGstin("  29aaacr9876h1zp  ")).toBe(true);
  });

  it("extracts PAN and state code", () => {
    expect(panFromGstin("29AAACR9876H1ZP")).toBe("AAACR9876H");
    expect(stateCodeFromGstin("29AAACR9876H1ZP")).toBe("29");
    expect(stateNameFromCode("29")).toBe("Karnataka");
    expect(stateNameFromCode("27")).toBe("Maharashtra");
    expect(stateNameFromCode("99")).toBe("Centre Jurisdiction");
  });
});
