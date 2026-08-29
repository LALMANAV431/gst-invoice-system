/**
 * GST computation engine (India).
 *
 * This module replaces `calcLineGST` in `src/lib/utils.ts`, which had four
 * correctness defects, each reproducible against the current code:
 *
 *  1. Bill-level discount was subtracted AFTER tax:
 *       grandTotal = subTotal + taxTotal - invDiscount + roundOff - tds
 *     On Rs 10,000 @ 18% with a Rs 1,000 invoice discount this charged Rs 1,800
 *     of GST where Rs 1,620 is correct — a Rs 180 overcharge per invoice. Under
 *     CGST Act s.15(3), a discount recorded on the face of the invoice reduces
 *     the taxable value, so it must be applied BEFORE tax.
 *
 *  2. No `cess` support. A 28% + cess item (tobacco, aerated drinks, motor
 *     vehicles) silently undercharged tax.
 *
 *  3. No distinction between taxable / exempt / nil-rated / non-GST /
 *     zero-rated supplies. These are reported in different GSTR-1 tables and
 *     must not be collapsed into "0% taxable".
 *
 *  4. TDS was netted into `grandTotal`, understating the invoice's face value
 *     and therefore the GST-bearing receivable. TDS is deducted by the customer
 *     on payment; it does not reduce the invoice value.
 *
 * Everything here works in integer paise (see `./money`). No floats.
 *
 * DISCLAIMER: This encodes a good-faith reading of common GST rules to make the
 * arithmetic deterministic and auditable. It is not tax advice. Rates, cess
 * schedules and place-of-supply rules change; have a practising CA review the
 * configuration before you rely on it for filing. See
 * docs/GST_COMPLIANCE_NOTES.md.
 */

import {
  addPaise,
  clampNonNegative,
  mulPaise,
  Paise,
  percentOf,
  roundOffToRupee,
  splitPaise,
  subPaise,
  toPaise,
} from "./money";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/**
 * Nature of the supply. This drives both tax computation and which GSTR-1
 * table the line lands in, so it cannot be inferred from the rate alone:
 * an exempt supply and a 0% taxable supply both have zero tax but are
 * reported differently.
 */
export type SupplyType =
  /** Standard taxable supply at a positive or zero rate. */
  | "TAXABLE"
  /** Exempted by notification (GSTR-1 table 8). No ITC to the supplier. */
  | "EXEMPT"
  /** Rate of nil in the tariff (GSTR-1 table 8). */
  | "NIL_RATED"
  /** Outside GST altogether, e.g. alcohol for human consumption. */
  | "NON_GST"
  /** Export / SEZ supply taxed at 0% with ITC preserved (GSTR-1 table 6). */
  | "ZERO_RATED";

/** How the `rate` on a line should be interpreted. */
export type PricingMode =
  /** `rate` excludes GST. GST is added on top. (Default.) */
  | "EXCLUSIVE"
  /** `rate` already includes GST. GST is extracted from it (MRP billing, POS). */
  | "INCLUSIVE";

export type GstLineInput = {
  /** Free-text description shown on the invoice. */
  description?: string;
  hsn?: string | null;
  /** May be fractional, e.g. 2.5 kg. */
  quantity: number;
  /** Unit price in RUPEES (number or string). Converted to paise internally. */
  rate: number | string;
  /** Per-line trade discount in RUPEES. Always reduces taxable value. */
  discount?: number | string;
  /** GST rate as a percentage: 0, 0.25, 3, 5, 12, 18, 28. */
  gstRate: number;
  /** Compensation cess as a percentage of taxable value. */
  cessRate?: number;
  /** Cess charged as a flat amount per unit, in RUPEES (e.g. tobacco). */
  cessPerUnit?: number | string;
  supplyType?: SupplyType;
  pricingMode?: PricingMode;
};

export type GstLineResult = {
  description?: string;
  hsn?: string | null;
  quantity: number;
  /** Unit price in paise, GST-exclusive (back-computed for INCLUSIVE lines). */
  ratePaise: Paise;
  /** Gross before any discount, in paise. */
  grossPaise: Paise;
  /** Line-level discount actually applied, in paise. */
  discountPaise: Paise;
  /** Share of the invoice-level discount apportioned to this line, in paise. */
  apportionedDiscountPaise: Paise;
  /** Value GST is charged on, after all discounts. */
  taxablePaise: Paise;
  gstRate: number;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  cessPaise: Paise;
  /** cgst + sgst + igst + cess */
  taxPaise: Paise;
  /** taxable + tax */
  totalPaise: Paise;
  supplyType: SupplyType;
};

export type GstInvoiceInput = {
  /** Supplier's 2-digit state code, from their GSTIN. */
  supplierStateCode?: string | null;
  /**
   * Place of supply as a 2-digit state code. For goods this is normally the
   * recipient's state. Passing it explicitly matters because services have
   * their own place-of-supply rules that the recipient's address does not
   * always determine.
   */
  placeOfSupplyStateCode?: string | null;
  lines: GstLineInput[];
  /**
   * Invoice-level discount in RUPEES. Apportioned across taxable lines
   * pro-rata to their taxable value and applied BEFORE tax.
   */
  invoiceDiscount?: number | string;
  /** Freight, packing, insurance etc. in RUPEES. Part of taxable value. */
  additionalCharges?: number | string;
  /** GST rate to apply to `additionalCharges`. Defaults to the highest line rate. */
  additionalChargesGstRate?: number;
  /** When true the recipient pays the tax; supplier charges none. */
  reverseCharge?: boolean;
  /** Round the grand total to the nearest rupee. Defaults to true. */
  roundToNearestRupee?: boolean;
  /**
   * TDS rate the customer will withhold, as a percentage of taxable value.
   * Reported separately; it does NOT reduce `grandTotalPaise`.
   */
  tdsRate?: number;
};

export type GstInvoiceResult = {
  lines: GstLineResult[];
  isInterState: boolean;
  reverseCharge: boolean;
  /** Sum of line taxable values (after all discounts) plus additional charges. */
  taxablePaise: Paise;
  /** Total line-level discounts. */
  lineDiscountPaise: Paise;
  /** Invoice-level discount actually applied. */
  invoiceDiscountPaise: Paise;
  additionalChargesPaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  cessPaise: Paise;
  taxPaise: Paise;
  /** taxable + tax, before rounding. */
  netPaise: Paise;
  roundOffPaise: Paise;
  /** What the customer owes on the face of the invoice. */
  grandTotalPaise: Paise;
  /** Informational: TDS the customer is expected to withhold. */
  tdsPaise: Paise;
  /** grandTotal - tds. What you actually expect to collect. */
  expectedReceiptPaise: Paise;
  /** Per-rate breakdown, for the invoice tax table and HSN summary. */
  rateSummary: GstRateSummary[];
};

export type GstRateSummary = {
  gstRate: number;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  cessPaise: Paise;
};

// ---------------------------------------------------------------------------
// Supply-type helpers
// ---------------------------------------------------------------------------

/** Supply types that never attract GST regardless of the rate supplied. */
const UNTAXED_SUPPLY_TYPES: ReadonlySet<SupplyType> = new Set<SupplyType>([
  "EXEMPT",
  "NIL_RATED",
  "NON_GST",
  "ZERO_RATED",
]);

export function isTaxableSupply(supplyType: SupplyType): boolean {
  return !UNTAXED_SUPPLY_TYPES.has(supplyType);
}

// ---------------------------------------------------------------------------
// Place of supply
// ---------------------------------------------------------------------------

/**
 * Decide whether a supply is inter-state.
 *
 * Returns false when either state code is missing: charging IGST on incomplete
 * data is the more damaging error, and an intra-state CGST+SGST split is the
 * safer default for a same-state walk-in sale (the common case when a B2C
 * customer has no recorded address).
 */
export function isInterStateSupply(
  supplierStateCode?: string | null,
  placeOfSupplyStateCode?: string | null
): boolean {
  const supplier = normaliseStateCode(supplierStateCode);
  const pos = normaliseStateCode(placeOfSupplyStateCode);
  if (!supplier || !pos) return false;
  return supplier !== pos;
}

/** Normalise a state code to two digits, e.g. "9" -> "09". */
export function normaliseStateCode(code?: string | null): string | null {
  if (code === null || code === undefined) return null;
  const digits = String(code).trim();
  if (!/^\d{1,2}$/.test(digits)) return null;
  return digits.padStart(2, "0");
}

// ---------------------------------------------------------------------------
// Line computation
// ---------------------------------------------------------------------------

/**
 * Compute one line's taxable value, before any invoice-level discount.
 * Kept separate from tax so the invoice-level discount can be apportioned
 * across lines before any tax is calculated.
 */
function computeLineBase(line: GstLineInput) {
  const supplyType = line.supplyType ?? "TAXABLE";
  const pricingMode = line.pricingMode ?? "EXCLUSIVE";
  const gstRate = isTaxableSupply(supplyType) ? line.gstRate : 0;
  const cessRate = isTaxableSupply(supplyType) ? line.cessRate ?? 0 : 0;

  if (!Number.isFinite(line.quantity)) {
    throw new TypeError(`GST line "${line.description ?? ""}": quantity must be a finite number`);
  }
  if (!Number.isFinite(gstRate) || gstRate < 0) {
    throw new TypeError(`GST line "${line.description ?? ""}": gstRate must be >= 0`);
  }

  let ratePaise = toPaise(line.rate);

  // For MRP/POS-style inclusive pricing, strip the tax out of the unit price so
  // the taxable value is exact. Dividing by (1 + rate/100 + cess/100) recovers
  // the pre-tax price.
  if (pricingMode === "INCLUSIVE" && gstRate + cessRate > 0) {
    const divisor = 1 + (gstRate + cessRate) / 100;
    ratePaise = mulPaise(ratePaise, 1 / divisor);
  }

  const grossPaise = mulPaise(ratePaise, line.quantity);
  const discountPaise = clampNonNegative(toPaise(line.discount ?? 0));
  const taxableBeforeApportionment = clampNonNegative(subPaise(grossPaise, discountPaise));

  return {
    supplyType,
    gstRate,
    cessRate,
    ratePaise,
    grossPaise,
    discountPaise,
    taxableBeforeApportionment,
  };
}

// ---------------------------------------------------------------------------
// Invoice computation
// ---------------------------------------------------------------------------

/**
 * Compute a complete GST invoice.
 *
 * Order of operations, which is the part the original code got wrong:
 *   1. Line gross = rate x qty
 *   2. Subtract line discount
 *   3. Apportion the invoice-level discount pro-rata and subtract it
 *   4. THEN compute CGST/SGST or IGST and cess on the resulting taxable value
 *   5. Add additional charges (themselves taxable)
 *   6. Round the grand total to the nearest rupee
 *   7. Report TDS separately, never netted into the invoice value
 */
export function computeGstInvoice(input: GstInvoiceInput): GstInvoiceResult {
  const reverseCharge = input.reverseCharge ?? false;
  const roundToNearestRupee = input.roundToNearestRupee ?? true;
  const isInterState = isInterStateSupply(
    input.supplierStateCode,
    input.placeOfSupplyStateCode
  );

  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new TypeError("computeGstInvoice: at least one line is required");
  }

  const bases = input.lines.map(computeLineBase);

  // ---- Step 3: apportion the invoice-level discount ----------------------
  // Pro-rata against taxable value so the discount lands on the lines whose
  // tax it should reduce. Capped at the total taxable value so a data-entry
  // error cannot push the invoice negative.
  const totalTaxableBefore = addPaise(...bases.map((b) => b.taxableBeforeApportionment));
  const requestedInvoiceDiscount = clampNonNegative(toPaise(input.invoiceDiscount ?? 0));
  const invoiceDiscountPaise = Math.min(requestedInvoiceDiscount, totalTaxableBefore);

  const apportioned = apportionByWeight(
    invoiceDiscountPaise,
    bases.map((b) => b.taxableBeforeApportionment)
  );

  // ---- Step 4: tax each line on its post-discount taxable value ----------
  const lines: GstLineResult[] = bases.map((base, i) => {
    const apportionedDiscountPaise = apportioned[i];
    const taxablePaise = clampNonNegative(
      subPaise(base.taxableBeforeApportionment, apportionedDiscountPaise)
    );

    const line = input.lines[i];
    const perUnitCess = clampNonNegative(toPaise(line.cessPerUnit ?? 0));
    const cessFromRate = isTaxableSupply(base.supplyType)
      ? percentOf(taxablePaise, base.cessRate)
      : 0;
    const cessFromUnits = isTaxableSupply(base.supplyType)
      ? mulPaise(perUnitCess, line.quantity)
      : 0;

    // Under reverse charge the recipient pays the tax, so the supplier's
    // invoice shows the taxable value with no tax collected.
    const cessPaise = reverseCharge ? 0 : addPaise(cessFromRate, cessFromUnits);
    const gstPaise = reverseCharge ? 0 : percentOf(taxablePaise, base.gstRate);

    let cgstPaise = 0;
    let sgstPaise = 0;
    let igstPaise = 0;
    if (isInterState) {
      igstPaise = gstPaise;
    } else {
      // splitPaise guarantees the halves sum back to gstPaise exactly, so an
      // odd-paise total reconciles instead of silently drifting.
      [cgstPaise, sgstPaise] = splitPaise(gstPaise, 2);
    }

    const taxPaise = addPaise(cgstPaise, sgstPaise, igstPaise, cessPaise);

    return {
      description: line.description,
      hsn: line.hsn ?? null,
      quantity: line.quantity,
      ratePaise: base.ratePaise,
      grossPaise: base.grossPaise,
      discountPaise: base.discountPaise,
      apportionedDiscountPaise,
      taxablePaise,
      gstRate: base.gstRate,
      cgstPaise,
      sgstPaise,
      igstPaise,
      cessPaise,
      taxPaise,
      totalPaise: addPaise(taxablePaise, taxPaise),
      supplyType: base.supplyType,
    };
  });

  // ---- Step 5: additional charges ---------------------------------------
  const additionalChargesPaise = clampNonNegative(toPaise(input.additionalCharges ?? 0));
  const highestLineRate = lines.reduce((max, l) => Math.max(max, l.gstRate), 0);
  const chargesGstRate = input.additionalChargesGstRate ?? highestLineRate;

  let chargesCgst = 0;
  let chargesSgst = 0;
  let chargesIgst = 0;
  if (additionalChargesPaise > 0 && !reverseCharge && chargesGstRate > 0) {
    const chargesGst = percentOf(additionalChargesPaise, chargesGstRate);
    if (isInterState) {
      chargesIgst = chargesGst;
    } else {
      [chargesCgst, chargesSgst] = splitPaise(chargesGst, 2);
    }
  }

  // ---- Totals -----------------------------------------------------------
  const lineTaxable = addPaise(...lines.map((l) => l.taxablePaise));
  const taxablePaise = addPaise(lineTaxable, additionalChargesPaise);
  const cgstPaise = addPaise(...lines.map((l) => l.cgstPaise), chargesCgst);
  const sgstPaise = addPaise(...lines.map((l) => l.sgstPaise), chargesSgst);
  const igstPaise = addPaise(...lines.map((l) => l.igstPaise), chargesIgst);
  const cessPaise = addPaise(...lines.map((l) => l.cessPaise));
  const taxPaise = addPaise(cgstPaise, sgstPaise, igstPaise, cessPaise);
  const netPaise = addPaise(taxablePaise, taxPaise);

  // ---- Step 6: round off ------------------------------------------------
  const { total: roundedTotal, adjustment } = roundToNearestRupee
    ? roundOffToRupee(netPaise)
    : { total: netPaise, adjustment: 0 };

  // ---- Step 7: TDS reported separately ----------------------------------
  const tdsRate = input.tdsRate ?? 0;
  const tdsPaise = tdsRate > 0 ? percentOf(taxablePaise, tdsRate) : 0;

  return {
    lines,
    isInterState,
    reverseCharge,
    taxablePaise,
    lineDiscountPaise: addPaise(...lines.map((l) => l.discountPaise)),
    invoiceDiscountPaise,
    additionalChargesPaise,
    cgstPaise,
    sgstPaise,
    igstPaise,
    cessPaise,
    taxPaise,
    netPaise,
    roundOffPaise: adjustment,
    grandTotalPaise: roundedTotal,
    tdsPaise,
    expectedReceiptPaise: subPaise(roundedTotal, tdsPaise),
    rateSummary: buildRateSummary(lines),
  };
}

/**
 * Distribute `total` across buckets in proportion to `weights`, guaranteeing
 * the parts sum exactly to `total`. Remainder paise go to the largest buckets
 * first, which keeps the distribution stable and avoids favouring line order.
 */
export function apportionByWeight(total: Paise, weights: Paise[]): Paise[] {
  const result = new Array<Paise>(weights.length).fill(0);
  if (total === 0 || weights.length === 0) return result;

  const weightSum = weights.reduce((a, b) => a + b, 0);
  if (weightSum <= 0) return result;

  let allocated = 0;
  const remainders: { index: number; remainder: number }[] = [];

  for (let i = 0; i < weights.length; i++) {
    const exact = (total * weights[i]) / weightSum;
    const floored = Math.floor(exact);
    result[i] = floored;
    allocated += floored;
    remainders.push({ index: i, remainder: exact - floored });
  }

  let leftover = total - allocated;
  remainders.sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  for (let i = 0; i < remainders.length && leftover > 0; i++) {
    result[remainders[i].index] += 1;
    leftover -= 1;
  }

  return result;
}

/** Group lines by GST rate for the invoice tax table and HSN summary. */
export function buildRateSummary(lines: GstLineResult[]): GstRateSummary[] {
  const byRate = new Map<number, GstRateSummary>();
  for (const l of lines) {
    const existing = byRate.get(l.gstRate) ?? {
      gstRate: l.gstRate,
      taxablePaise: 0,
      cgstPaise: 0,
      sgstPaise: 0,
      igstPaise: 0,
      cessPaise: 0,
    };
    existing.taxablePaise += l.taxablePaise;
    existing.cgstPaise += l.cgstPaise;
    existing.sgstPaise += l.sgstPaise;
    existing.igstPaise += l.igstPaise;
    existing.cessPaise += l.cessPaise;
    byRate.set(l.gstRate, existing);
  }
  return [...byRate.values()].sort((a, b) => a.gstRate - b.gstRate);
}

// ---------------------------------------------------------------------------
// GSTIN
// ---------------------------------------------------------------------------

/**
 * Structural GSTIN pattern: 2-digit state code, 10-character PAN,
 * 1 entity digit, 1 alphabet, 1 checksum character.
 */
export const GSTIN_REGEX = /^[0-9]{2}[A-Z]{5}[0-9]{4}[A-Z]{1}[1-9A-Z]{1}[Z]{1}[0-9A-Z]{1}$/;

const GSTIN_CHECKSUM_ALPHABET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ";

/**
 * Validate a GSTIN's structure AND its check digit.
 *
 * The check digit uses the standard weighted modulus-36 scheme: each of the
 * first 14 characters is converted to its position in [0-9A-Z], multiplied by
 * an alternating weight of 1 or 2, the products are reduced by
 * floor(p/36) + p%36, summed, and the 15th character must make the total a
 * multiple of 36. Validating this rejects transposed and mistyped GSTINs that
 * a regex alone accepts.
 */
export function isValidGstin(gstin: string): boolean {
  if (typeof gstin !== "string") return false;
  const value = gstin.trim().toUpperCase();
  if (!GSTIN_REGEX.test(value)) return false;

  let sum = 0;
  for (let i = 0; i < 14; i++) {
    const position = GSTIN_CHECKSUM_ALPHABET.indexOf(value[i]);
    if (position < 0) return false;
    const weight = i % 2 === 0 ? 1 : 2;
    const product = position * weight;
    sum += Math.floor(product / 36) + (product % 36);
  }

  const expected = (36 - (sum % 36)) % 36;
  return GSTIN_CHECKSUM_ALPHABET[expected] === value[14];
}

/** Extract the PAN embedded in a GSTIN (characters 3-12). */
export function panFromGstin(gstin: string): string | null {
  const value = String(gstin ?? "").trim().toUpperCase();
  if (!GSTIN_REGEX.test(value)) return null;
  return value.slice(2, 12);
}

/** Extract the 2-digit state code from a GSTIN. */
export function stateCodeFromGstin(gstin: string): string | null {
  const value = String(gstin ?? "").trim().toUpperCase();
  if (!/^[0-9]{2}/.test(value)) return null;
  return value.slice(0, 2);
}

/** GST state / UT codes, used for place-of-supply selection and GSTR-1. */
export const GST_STATE_CODES: Record<string, string> = {
  "01": "Jammu and Kashmir",
  "02": "Himachal Pradesh",
  "03": "Punjab",
  "04": "Chandigarh",
  "05": "Uttarakhand",
  "06": "Haryana",
  "07": "Delhi",
  "08": "Rajasthan",
  "09": "Uttar Pradesh",
  "10": "Bihar",
  "11": "Sikkim",
  "12": "Arunachal Pradesh",
  "13": "Nagaland",
  "14": "Manipur",
  "15": "Mizoram",
  "16": "Tripura",
  "17": "Meghalaya",
  "18": "Assam",
  "19": "West Bengal",
  "20": "Jharkhand",
  "21": "Odisha",
  "22": "Chhattisgarh",
  "23": "Madhya Pradesh",
  "24": "Gujarat",
  "26": "Dadra and Nagar Haveli and Daman and Diu",
  "27": "Maharashtra",
  "29": "Karnataka",
  "30": "Goa",
  "31": "Lakshadweep",
  "32": "Kerala",
  "33": "Tamil Nadu",
  "34": "Puducherry",
  "35": "Andaman and Nicobar Islands",
  "36": "Telangana",
  "37": "Andhra Pradesh",
  "38": "Ladakh",
  "97": "Other Territory",
  "99": "Centre Jurisdiction",
};

export function stateNameFromCode(code?: string | null): string | null {
  const normalised = normaliseStateCode(code);
  return normalised ? GST_STATE_CODES[normalised] ?? null : null;
}

/** Standard GST slabs, for rate pickers and validation. */
export const GST_RATES = [0, 0.25, 3, 5, 12, 18, 28] as const;
