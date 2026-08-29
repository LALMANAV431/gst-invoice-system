import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Format a RUPEE amount.
 *
 * Nearly everything in this codebase now stores integer paise — use
 * `formatPaise()` for those. This remains only for the few values that are
 * genuinely rupees (user-typed form inputs before conversion).
 */
export function formatINR(amount: number): string {
  if (isNaN(amount)) return "₹0.00";
  return new Intl.NumberFormat("en-IN", {
    style: "currency",
    currency: "INR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(amount);
}

export function formatNumber(n: number, digits = 2): string {
  if (isNaN(n)) return "0";
  return new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  }).format(n);
}

export function formatDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toLocaleDateString("en-IN", { day: "2-digit", month: "short", year: "numeric" });
}

export function inputDate(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  return date.toISOString().slice(0, 10);
}

export function numberToWords(num: number): string {
  // Indian number system word converter
  if (num === 0) return "Zero Rupees Only";
  const a = [
    "",
    "One",
    "Two",
    "Three",
    "Four",
    "Five",
    "Six",
    "Seven",
    "Eight",
    "Nine",
    "Ten",
    "Eleven",
    "Twelve",
    "Thirteen",
    "Fourteen",
    "Fifteen",
    "Sixteen",
    "Seventeen",
    "Eighteen",
    "Nineteen",
  ];
  const b = ["", "", "Twenty", "Thirty", "Forty", "Fifty", "Sixty", "Seventy", "Eighty", "Ninety"];

  function inWords(n: number): string {
    if (n < 20) return a[n];
    if (n < 100) return b[Math.floor(n / 10)] + (n % 10 ? " " + a[n % 10] : "");
    if (n < 1000)
      return a[Math.floor(n / 100)] + " Hundred" + (n % 100 ? " " + inWords(n % 100) : "");
    if (n < 100000)
      return inWords(Math.floor(n / 1000)) + " Thousand" + (n % 1000 ? " " + inWords(n % 1000) : "");
    if (n < 10000000)
      return inWords(Math.floor(n / 100000)) + " Lakh" + (n % 100000 ? " " + inWords(n % 100000) : "");
    return (
      inWords(Math.floor(n / 10000000)) +
      " Crore" +
      (n % 10000000 ? " " + inWords(n % 10000000) : "")
    );
  }

  const rupees = Math.floor(num);
  const paise = Math.round((num - rupees) * 100);
  let str = inWords(rupees) + " Rupees";
  if (paise > 0) str += " and " + inWords(paise) + " Paise";
  return str + " Only";
}

// ---------------------------------------------------------------------------
// GST helpers
//
// `calcLineGST` used to live here. It has been REMOVED, not deprecated, because
// leaving it available would let new code reintroduce the defects it carried:
//
//   - floating-point arithmetic, which lost money on accumulation
//   - no compensation cess support (28%+cess items undercharged silently)
//   - no exempt / nil-rated / non-GST / zero-rated distinction
//   - callers subtracted the invoice discount AFTER tax, overcharging GST
//
// Use `computeGstInvoice()` from src/lib/gst.ts instead. It works in integer
// paise, applies discounts before tax, and is covered by tests.
// ---------------------------------------------------------------------------

export { formatPaise, toPaise, toRupees } from "./money";
