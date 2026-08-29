/**
 * Money handling for accounting-grade arithmetic.
 *
 * WHY THIS EXISTS
 * ---------------
 * The original implementation stored every monetary amount as a JavaScript
 * `number` (IEEE-754 double) and relied on `+x.toFixed(2)` at each step. That
 * approach loses money. Reproducible example from the current code:
 *
 *   100 lines of (qty 3 x rate 33.33) accumulated as floats
 *     => 9998.999999999984   (expected 9999)
 *
 * The fix is to represent every amount as an INTEGER NUMBER OF PAISE and only
 * convert to rupees at the presentation boundary. Integers are exact, and
 * Number.MAX_SAFE_INTEGER (9,007,199,254,740,991 paise ~= Rs 90,071 crore) is
 * far beyond any realistic invoice value, so plain `number` is safe as long as
 * we never introduce a fractional part.
 *
 * RULES
 * -----
 * 1. All amounts crossing a module boundary are `Paise` (integer).
 * 2. Never use `+` / `*` on rupee floats. Use these helpers.
 * 3. Round exactly once, at the point tax is computed, using half-up
 *    (commercial rounding) which is what Indian invoicing expects.
 * 4. Persist paise as an integer column. Never persist a float.
 */

/** An integer number of paise. 100 paise = Rs 1. */
export type Paise = number;

const PAISE_PER_RUPEE = 100;

/** True when the value is a safe integer suitable for use as Paise. */
export function isPaise(value: unknown): value is Paise {
  return typeof value === "number" && Number.isSafeInteger(value);
}

function assertPaise(value: number, label: string): Paise {
  if (!Number.isFinite(value)) {
    throw new TypeError(`${label}: expected a finite number, received ${value}`);
  }
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(
      `${label}: expected an integer paise value, received ${value}. ` +
        `Convert rupees with toPaise() before doing arithmetic.`
    );
  }
  return value;
}

/**
 * Half-up rounding away from zero, which is what Indian commercial invoicing
 * expects. `Math.round` rounds -0.5 to -0 (toward +Infinity), which would make
 * credit notes disagree with the invoices they reverse, so we handle sign
 * explicitly.
 */
export function roundHalfUp(value: number): number {
  if (!Number.isFinite(value)) {
    throw new TypeError(`roundHalfUp: expected a finite number, received ${value}`);
  }
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

/**
 * Convert a rupee amount (number or a string such as "1234.56") to paise.
 *
 * Strings are parsed digit-wise rather than via `parseFloat` so that values
 * arriving from JSON request bodies or `<input>` elements are exact. This
 * matters: `parseFloat("0.145") * 100` is 14.499999999999998.
 */
export function toPaise(rupees: number | string): Paise {
  if (typeof rupees === "number") {
    if (!Number.isFinite(rupees)) {
      throw new TypeError(`toPaise: expected a finite number, received ${rupees}`);
    }
    // Scale then round: the multiplication may be inexact, the rounding fixes it.
    return roundHalfUp(rupees * PAISE_PER_RUPEE);
  }

  const raw = rupees.trim();
  if (raw === "") return 0;

  const match = /^([+-]?)(\d*)(?:\.(\d*))?$/.exec(raw);
  if (!match) {
    // Fall back for exponential notation and similar valid-but-unusual input.
    const parsed = Number(raw);
    if (!Number.isFinite(parsed)) {
      throw new TypeError(`toPaise: cannot parse "${rupees}" as an amount`);
    }
    return roundHalfUp(parsed * PAISE_PER_RUPEE);
  }

  const [, sign, whole, fraction = ""] = match;
  const wholePaise = (whole === "" ? 0 : Number(whole)) * PAISE_PER_RUPEE;
  // Take the first two fractional digits exactly, then round on the third.
  const fractionPadded = (fraction + "000").slice(0, 3);
  const twoDigits = Number(fractionPadded.slice(0, 2));
  const thirdDigit = Number(fractionPadded[2]);
  const paise = wholePaise + twoDigits + (thirdDigit >= 5 ? 1 : 0);
  return sign === "-" ? -paise : paise;
}

/** Convert paise back to a rupee number. Use only for display/serialisation. */
export function toRupees(paise: Paise): number {
  assertPaise(paise, "toRupees");
  return paise / PAISE_PER_RUPEE;
}

/** Exact sum. Replaces `a + b` on rupee floats. */
export function addPaise(...values: Paise[]): Paise {
  let total = 0;
  for (const v of values) total += assertPaise(v, "addPaise");
  return total;
}

/** Exact difference. */
export function subPaise(a: Paise, b: Paise): Paise {
  return assertPaise(a, "subPaise") - assertPaise(b, "subPaise");
}

/**
 * Multiply a paise amount by a plain quantity (which may be fractional, e.g.
 * 2.5 kg) and round once to the nearest paise.
 */
export function mulPaise(paise: Paise, multiplier: number): Paise {
  assertPaise(paise, "mulPaise");
  if (!Number.isFinite(multiplier)) {
    throw new TypeError(`mulPaise: expected a finite multiplier, received ${multiplier}`);
  }
  return roundHalfUp(paise * multiplier);
}

/**
 * Apply a percentage (e.g. a GST rate of 18) to a paise amount, rounding once.
 */
export function percentOf(paise: Paise, percent: number): Paise {
  assertPaise(paise, "percentOf");
  if (!Number.isFinite(percent)) {
    throw new TypeError(`percentOf: expected a finite percent, received ${percent}`);
  }
  return roundHalfUp((paise * percent) / 100);
}

/**
 * Split a paise amount into `parts` pieces that sum EXACTLY back to the input.
 *
 * This is what makes an odd-paise CGST/SGST split defensible. The original code
 * computed `cgst = tax/2` and `sgst = tax - cgst` inline, which silently
 * produced asymmetric halves (Rs 2.63 vs Rs 2.62 on a Rs 105.05 line at 5%).
 * That asymmetry is unavoidable arithmetic, but it must be explicit and it must
 * always reconcile. Remainder paise are distributed to the earliest parts.
 */
export function splitPaise(paise: Paise, parts: number): Paise[] {
  assertPaise(paise, "splitPaise");
  if (!Number.isInteger(parts) || parts < 1) {
    throw new TypeError(`splitPaise: parts must be a positive integer, received ${parts}`);
  }
  const sign = paise < 0 ? -1 : 1;
  const magnitude = Math.abs(paise);
  const base = Math.floor(magnitude / parts);
  const remainder = magnitude - base * parts;
  return Array.from({ length: parts }, (_, i) => sign * (base + (i < remainder ? 1 : 0)));
}

/**
 * Round a total to the nearest rupee and return both the rounded total and the
 * round-off adjustment, so the adjustment can be shown on the invoice and
 * posted to a Round Off ledger.
 */
export function roundOffToRupee(paise: Paise): { total: Paise; adjustment: Paise } {
  assertPaise(paise, "roundOffToRupee");
  const total = roundHalfUp(paise / PAISE_PER_RUPEE) * PAISE_PER_RUPEE;
  return { total, adjustment: total - paise };
}

/** Format paise as an INR string for display, e.g. 123456 -> "₹1,234.56". */
export function formatPaise(paise: Paise): string {
  assertPaise(paise, "formatPaise");
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(toRupees(paise));
}

/** Clamp a paise amount to be non-negative. */
export function clampNonNegative(paise: Paise): Paise {
  return Math.max(0, assertPaise(paise, "clampNonNegative"));
}
