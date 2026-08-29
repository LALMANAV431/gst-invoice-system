import { NextResponse } from "next/server";
import { z } from "zod";
import { getCurrentUserAndCompany } from "@/lib/auth";
import { writeGuard } from "@/lib/guard";
import { ask, parseJsonResponse } from "@/server/ai/service";
import { AiBudgetExceededError, AiUnavailableError } from "@/server/ai/types";
import { validateUpload } from "@/lib/upload";
import { isValidGstin, panFromGstin, stateCodeFromGstin } from "@/lib/gst";
import { toPaise } from "@/lib/money";

/**
 * Extract fields from a photo of a supplier bill.
 *
 * This is the highest-value AI feature for the target user: typing purchase bills
 * is the most tedious part of keeping books, and a shopkeeper already has the
 * bill in their hand and a camera in their pocket.
 *
 * CRITICAL: this endpoint returns a DRAFT. It never creates a purchase, never
 * touches stock and never posts to the ledger. Extraction is probabilistic; a
 * wrong figure written straight into the books would be worse than no feature at
 * all. The client shows the values for confirmation.
 */

const schema = z.object({
  /** Base64 image, optionally as a data URL. */
  image: z.string().min(32, "Attach an image of the bill"),
  mimeType: z.string().optional(),
});

/** What the model is asked to return, and what the client can rely on. */
export type OcrDraft = {
  supplierName: string | null;
  supplierGstin: string | null;
  gstinValid: boolean;
  supplierPan: string | null;
  supplierStateCode: string | null;
  invoiceNumber: string | null;
  invoiceDate: string | null;
  taxablePaise: number | null;
  taxPaise: number | null;
  totalPaise: number | null;
  gstRate: number | null;
  confidence: number;
  /** Arithmetic checks the server performed on the extracted numbers. */
  warnings: string[];
};

export async function POST(req: Request) {
  const ctx = await getCurrentUserAndCompany();
  if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  // Creating a draft is a precursor to a write, so read-only roles are excluded.
  const blocked = writeGuard(ctx);
  if (blocked) return blocked;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Invalid request" },
      { status: 400 }
    );
  }

  // Strip any data-URL prefix, then validate the real bytes rather than trusting
  // the declared type.
  const base64 = parsed.data.image.replace(/^data:[^;]+;base64,/, "");
  let bytes: Uint8Array;
  try {
    bytes = Uint8Array.from(Buffer.from(base64, "base64"));
  } catch {
    return NextResponse.json({ error: "Could not decode the image." }, { status: 400 });
  }

  const validation = validateUpload(bytes, "image");
  if (!validation.ok) {
    return NextResponse.json({ error: validation.error }, { status: 400 });
  }

  try {
    const result = await ask({
      companyId: ctx.company.id,
      userId: ctx.user.id,
      feature: "OCR",
      system:
        "You extract fields from Indian GST purchase invoices. " +
        "Return ONLY JSON with these keys: supplierName, supplierGstin, invoiceNumber, " +
        "invoiceDate (YYYY-MM-DD), taxableAmount, taxAmount, totalAmount, gstRate, confidence. " +
        "Amounts are RUPEES as plain numbers with no symbols or separators. " +
        "Use null for anything you cannot read. confidence is 0 to 1. " +
        "Never guess a GSTIN — return null if it is not clearly legible.",
      prompt: "Extract the invoice fields from this bill image.",
      imageBase64: base64,
      imageMimeType: validation.mimeType,
      // Every photo is different, so caching would return a previous bill's data.
      noCache: true,
    });

    const raw = parseJsonResponse<{
      supplierName?: string | null;
      supplierGstin?: string | null;
      invoiceNumber?: string | null;
      invoiceDate?: string | null;
      taxableAmount?: number | string | null;
      taxAmount?: number | string | null;
      totalAmount?: number | string | null;
      gstRate?: number | string | null;
      confidence?: number | null;
    }>(result.text);

    if (!raw) {
      return NextResponse.json(
        { error: "Could not read that bill. Try a clearer, well-lit photo." },
        { status: 422 }
      );
    }

    const draft = buildDraft(raw);

    return NextResponse.json({
      draft,
      provider: result.provider,
      mock: result.mock,
      // Stated explicitly so the client cannot treat this as a finished record.
      requiresReview: true,
    });
  } catch (e) {
    if (e instanceof AiUnavailableError) {
      return NextResponse.json({ error: e.message, available: false }, { status: 503 });
    }
    if (e instanceof AiBudgetExceededError) {
      return NextResponse.json(
        { error: e.message, code: "AI_BUDGET", upgrade: true },
        { status: 402 }
      );
    }
    console.error("[ai/ocr] failed:", e);
    return NextResponse.json({ error: "Could not read that bill" }, { status: 500 });
  }
}

function toNum(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const n = typeof value === "number" ? value : parseFloat(String(value).replace(/[,\s₹]/g, ""));
  return Number.isFinite(n) ? n : null;
}

/**
 * Convert the model's output into a validated draft.
 *
 * The server re-checks everything it can: the GSTIN checksum, and whether
 * taxable + tax actually equals the stated total. A model that misreads a digit
 * usually produces numbers that do not reconcile, so arithmetic is a good
 * detector of a bad extraction.
 */
function buildDraft(raw: {
  supplierName?: string | null;
  supplierGstin?: string | null;
  invoiceNumber?: string | null;
  invoiceDate?: string | null;
  taxableAmount?: number | string | null;
  taxAmount?: number | string | null;
  totalAmount?: number | string | null;
  gstRate?: number | string | null;
  confidence?: number | null;
}): OcrDraft {
  const warnings: string[] = [];

  const gstin = raw.supplierGstin?.trim().toUpperCase() || null;
  const gstinValid = gstin ? isValidGstin(gstin) : false;
  if (gstin && !gstinValid) {
    warnings.push("The GSTIN read from the bill fails its checksum — please re-check it.");
  }

  const taxable = toNum(raw.taxableAmount);
  const tax = toNum(raw.taxAmount);
  const total = toNum(raw.totalAmount);
  const gstRate = toNum(raw.gstRate);

  if (taxable !== null && tax !== null && total !== null) {
    // Allow a rupee of slack for the bill's own rounding.
    if (Math.abs(taxable + tax - total) > 1) {
      warnings.push(
        `Taxable (${taxable}) + tax (${tax}) does not equal the total (${total}). Check the figures.`
      );
    }
  }

  if (taxable !== null && tax !== null && gstRate !== null && gstRate > 0) {
    const expected = (taxable * gstRate) / 100;
    if (Math.abs(expected - tax) > Math.max(1, expected * 0.02)) {
      warnings.push(
        `Tax of ${tax} does not match ${gstRate}% of ${taxable}. The rate may have been misread.`
      );
    }
  }

  if (raw.invoiceDate && !/^\d{4}-\d{2}-\d{2}$/.test(raw.invoiceDate)) {
    warnings.push("The invoice date could not be read as a valid date.");
  }

  return {
    supplierName: raw.supplierName?.trim() || null,
    supplierGstin: gstin,
    gstinValid,
    supplierPan: gstinValid && gstin ? panFromGstin(gstin) : null,
    supplierStateCode: gstinValid && gstin ? stateCodeFromGstin(gstin) : null,
    invoiceNumber: raw.invoiceNumber?.trim() || null,
    invoiceDate: raw.invoiceDate ?? null,
    taxablePaise: taxable === null ? null : toPaise(taxable),
    taxPaise: tax === null ? null : toPaise(tax),
    totalPaise: total === null ? null : toPaise(total),
    gstRate,
    confidence: Math.min(1, Math.max(0, raw.confidence ?? 0.5)),
    warnings,
  };
}
