/**
 * Shared GST document computation.
 *
 * Invoices, purchases, quotations and credit notes all carry the same tax
 * structure, so they must compute it the same way. Previously each route
 * re-implemented the arithmetic inline with `calcLineGST`, and they had drifted:
 * some applied the invoice discount after tax, none handled cess, and none
 * distinguished exempt from zero-rated.
 *
 * This module is the single conversion point between a request payload and the
 * paise-denominated rows the database expects.
 */

import {
  computeGstInvoice,
  GstInvoiceResult,
  GstLineInput,
  normaliseStateCode,
  PricingMode,
  SupplyType,
} from "@/lib/gst";
import { toPaise } from "@/lib/money";

/** Line as it arrives from a form or API client, with rupee amounts. */
export type RawLineInput = {
  itemId?: string | null;
  itemName?: string;
  hsn?: string | null;
  quantity?: number | string;
  unit?: string;
  rate?: number | string;
  discount?: number | string;
  gstRate?: number | string;
  cessRate?: number | string;
  cessPerUnit?: number | string;
  supplyType?: string;
  pricingMode?: string;
};

export type DocumentTotalsInput = {
  supplierStateCode?: string | null;
  partyStateCode?: string | null;
  placeOfSupply?: string | null;
  lines: RawLineInput[];
  invoiceDiscount?: number | string;
  additionalCharges?: number | string;
  additionalChargesGstRate?: number | string;
  reverseCharge?: boolean;
  tdsRate?: number | string;
  roundToNearestRupee?: boolean;
  /** Composition dealers cannot collect GST, so all rates are forced to zero. */
  isComposition?: boolean;
};

/** Header columns, ready to spread into a Prisma create. */
export type DocumentHeaderTotals = {
  subTotalPaise: number;
  cgstTotalPaise: number;
  sgstTotalPaise: number;
  igstTotalPaise: number;
  cessTotalPaise: number;
  taxTotalPaise: number;
  discountPaise: number;
  additionalChargesPaise: number;
  roundOffPaise: number;
  grandTotalPaise: number;
  isInterState: boolean;
  reverseCharge: boolean;
  placeOfSupply: string | null;
};

/** Line columns, ready for a nested `items: { create: [...] }`. */
export type DocumentLineRow = {
  itemId: string | null;
  itemName: string;
  hsn: string | null;
  quantity: number;
  unit: string;
  ratePaise: number;
  discountPaise: number;
  apportionedDiscountPaise: number;
  taxablePaise: number;
  gstRate: number;
  cessRate: number;
  cessPerUnitPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  cessPaise: number;
  totalPaise: number;
  supplyType: string;
  pricingMode: string;
};

const VALID_SUPPLY_TYPES = new Set([
  "TAXABLE",
  "EXEMPT",
  "NIL_RATED",
  "NON_GST",
  "ZERO_RATED",
]);

function coerceSupplyType(value?: string): SupplyType {
  return value && VALID_SUPPLY_TYPES.has(value) ? (value as SupplyType) : "TAXABLE";
}

function coercePricingMode(value?: string): PricingMode {
  return value === "INCLUSIVE" ? "INCLUSIVE" : "EXCLUSIVE";
}

function num(value: unknown, fallback = 0): number {
  const n = typeof value === "number" ? value : parseFloat(String(value ?? ""));
  return Number.isFinite(n) ? n : fallback;
}

/**
 * Compute a document's tax, returning header totals, line rows and the raw
 * engine result (needed for ledger posting, which splits by supply type).
 */
export function computeDocument(input: DocumentTotalsInput): {
  header: DocumentHeaderTotals;
  lines: DocumentLineRow[];
  gst: GstInvoiceResult;
} {
  if (!Array.isArray(input.lines) || input.lines.length === 0) {
    throw new Error("At least one line item is required");
  }

  const placeOfSupply =
    normaliseStateCode(input.placeOfSupply) ?? normaliseStateCode(input.partyStateCode);
  const isComposition = input.isComposition ?? false;

  const gstLines: GstLineInput[] = input.lines.map((l) => ({
    description: l.itemName ?? "",
    hsn: l.hsn ?? null,
    quantity: num(l.quantity),
    rate: l.rate ?? 0,
    discount: l.discount ?? 0,
    gstRate: isComposition ? 0 : num(l.gstRate),
    cessRate: isComposition ? 0 : num(l.cessRate),
    cessPerUnit: isComposition ? 0 : l.cessPerUnit ?? 0,
    supplyType: coerceSupplyType(l.supplyType),
    pricingMode: coercePricingMode(l.pricingMode),
  }));

  const gst = computeGstInvoice({
    supplierStateCode: input.supplierStateCode,
    placeOfSupplyStateCode: placeOfSupply,
    lines: gstLines,
    invoiceDiscount: input.invoiceDiscount ?? 0,
    additionalCharges: input.additionalCharges ?? 0,
    additionalChargesGstRate:
      input.additionalChargesGstRate === undefined
        ? undefined
        : num(input.additionalChargesGstRate),
    reverseCharge: input.reverseCharge ?? false,
    tdsRate: num(input.tdsRate),
    roundToNearestRupee: input.roundToNearestRupee ?? true,
  });

  const lines: DocumentLineRow[] = gst.lines.map((line, i) => {
    const src = input.lines[i];
    return {
      itemId: src.itemId || null,
      itemName: src.itemName || line.description || "Item",
      hsn: line.hsn ?? null,
      quantity: line.quantity,
      unit: src.unit || "NOS",
      ratePaise: line.ratePaise,
      discountPaise: line.discountPaise,
      apportionedDiscountPaise: line.apportionedDiscountPaise,
      taxablePaise: line.taxablePaise,
      gstRate: line.gstRate,
      cessRate: isComposition ? 0 : num(src.cessRate),
      cessPerUnitPaise: isComposition ? 0 : toPaise(src.cessPerUnit ?? 0),
      cgstPaise: line.cgstPaise,
      sgstPaise: line.sgstPaise,
      igstPaise: line.igstPaise,
      cessPaise: line.cessPaise,
      totalPaise: line.totalPaise,
      supplyType: line.supplyType,
      pricingMode: coercePricingMode(src.pricingMode),
    };
  });

  const header: DocumentHeaderTotals = {
    // subTotal is the taxable value of the lines only; charges are separate so
    // the invoice can show them on their own row.
    subTotalPaise: gst.taxablePaise - gst.additionalChargesPaise,
    cgstTotalPaise: gst.cgstPaise,
    sgstTotalPaise: gst.sgstPaise,
    igstTotalPaise: gst.igstPaise,
    cessTotalPaise: gst.cessPaise,
    taxTotalPaise: gst.taxPaise,
    discountPaise: gst.invoiceDiscountPaise,
    additionalChargesPaise: gst.additionalChargesPaise,
    roundOffPaise: gst.roundOffPaise,
    grandTotalPaise: gst.grandTotalPaise,
    isInterState: gst.isInterState,
    reverseCharge: gst.reverseCharge,
    placeOfSupply: placeOfSupply ?? null,
  };

  return { header, lines, gst };
}
