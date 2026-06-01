import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

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

// GST helpers
export function calcLineGST(opts: {
  quantity: number;
  rate: number;
  discount?: number;
  gstRate: number;
  isInterState: boolean;
}) {
  const { quantity, rate, discount = 0, gstRate, isInterState } = opts;
  const gross = quantity * rate;
  const taxableAmount = Math.max(0, gross - discount);
  const taxAmount = +(taxableAmount * (gstRate / 100)).toFixed(2);
  const cgst = isInterState ? 0 : +(taxAmount / 2).toFixed(2);
  const sgst = isInterState ? 0 : +(taxAmount - cgst).toFixed(2);
  const igst = isInterState ? taxAmount : 0;
  const total = +(taxableAmount + taxAmount).toFixed(2);
  return { taxableAmount: +taxableAmount.toFixed(2), cgst, sgst, igst, total };
}
