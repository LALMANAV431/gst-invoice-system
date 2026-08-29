/**
 * OpenAPI 3.1 description of the HTTP API.
 *
 * WHY THIS IS TYPESCRIPT AND NOT A YAML FILE
 * ------------------------------------------
 * A hand-maintained `openapi.yaml` drifts from the code within weeks, and a spec
 * that lies is worse than no spec. Written here instead:
 *
 * 1. `src/lib/openapi.test.ts` enumerates every `src/app/api/**\/route.ts` on
 *    disk, derives its path and exported HTTP methods, and fails if any is
 *    missing from this document - or if this document describes an endpoint that
 *    does not exist. Adding a route without documenting it breaks CI.
 * 2. Enumerated values are IMPORTED from the modules that define them
 *    (adjustment reasons, valuation methods, locales, plan ids), so the spec
 *    cannot disagree with the code about what is allowed.
 * 3. TypeScript catches structural typos that YAML would silently accept.
 *
 * Served at `GET /api/openapi`, and written to `docs/openapi.json` by
 * `npm run docs:openapi` for tooling that wants a file.
 */

import { ADJUSTMENT_REASONS, VALUATION_METHODS } from "./inventory";
import { LOCALES } from "./i18n";
import { PLANS } from "./plan";
import { DEFAULT_PAGE_SIZE, MAX_PAGE_SIZE } from "./pagination";

/** Deliberately minimal structural types - enough to catch typos, not a validator. */
type Schema = Record<string, unknown>;
type Operation = {
  tags: string[];
  summary: string;
  description?: string;
  operationId?: string;
  parameters?: Schema[];
  requestBody?: Schema;
  responses: Record<string, Schema>;
  security?: Schema[];
};
type PathItem = Partial<Record<"get" | "post" | "put" | "patch" | "delete", Operation>>;

export const HTTP_METHODS = ["get", "post", "put", "patch", "delete"] as const;
export type HttpMethod = (typeof HTTP_METHODS)[number];

const ADJUSTMENT_REASON_CODES = Object.keys(ADJUSTMENT_REASONS);
const PLAN_IDS = Object.keys(PLANS);

/* ------------------------------------------------------------------ helpers */

const ref = (name: string) => ({ $ref: `#/components/schemas/${name}` });

function json(schema: Schema) {
  return { content: { "application/json": { schema } } };
}

function body(schema: Schema, required = true) {
  return { required, ...json(schema) };
}

function ok(schema: Schema, description = "Success") {
  return { description, ...json(schema) };
}

/** The responses every authenticated endpoint can return. */
const AUTH_ERRORS: Record<string, Schema> = {
  "401": { description: "Not signed in, or the session was revoked", ...json(ref("Error")) },
  "429": { description: "Rate limited", ...json(ref("Error")) },
};

const WRITE_ERRORS: Record<string, Schema> = {
  ...AUTH_ERRORS,
  "400": { description: "Validation failed", ...json(ref("ValidationError")) },
  "403": {
    description: "Read-only role, or the company is suspended",
    ...json(ref("Error")),
  },
};

const NOT_FOUND: Schema = {
  description: "Not found, or belongs to another company",
  ...json(ref("Error")),
};

const PAGINATION_PARAMS: Schema[] = [
  {
    name: "page",
    in: "query",
    schema: { type: "integer", minimum: 1, default: 1 },
    description: "1-based page number.",
  },
  {
    name: "pageSize",
    in: "query",
    schema: {
      type: "integer",
      minimum: 1,
      maximum: MAX_PAGE_SIZE,
      default: DEFAULT_PAGE_SIZE,
    },
    description: `Rows per page. Clamped to ${MAX_PAGE_SIZE}.`,
  },
];

const ID_PARAM: Schema = {
  name: "id",
  in: "path",
  required: true,
  schema: { type: "string" },
  description: "Resource id. Always scoped to the caller's company.",
};

/** A paginated envelope around a row schema. */
function paginated(itemSchema: Schema): Schema {
  return {
    type: "object",
    required: ["data", "page", "pageSize", "total", "totalPages", "hasMore"],
    properties: {
      data: { type: "array", items: itemSchema },
      page: { type: "integer" },
      pageSize: { type: "integer" },
      total: { type: "integer" },
      totalPages: { type: "integer" },
      hasMore: { type: "boolean" },
    },
  };
}

/**
 * Endpoints that exist but are intentionally NOT part of the documented API,
 * each with the reason. The sync test requires every route to be either
 * documented or listed here, so this cannot be used to quietly hide something.
 */
export const UNDOCUMENTED_ROUTES: Record<string, string> = {
  "/api/admin/impersonate":
    "Platform support tool. Documenting it would advertise a cross-tenant capability with no legitimate third-party use.",
  "/api/admin/impersonate/stop": "Counterpart to the impersonation endpoint above.",
};

/* ------------------------------------------------------------------ schemas */

const schemas: Record<string, Schema> = {
  Error: {
    type: "object",
    required: ["error"],
    properties: {
      error: { type: "string", description: "Human-readable message, safe to show a user." },
      code: {
        type: "string",
        description:
          "Stable machine-readable code, present on errors a client is expected to handle " +
          "(PLAN_LIMIT, PERIOD_LOCKED, VALUATION_RESTATEMENT, RETENTION_WARNING, DUPLICATE, HAS_MOVEMENTS, ALREADY_POSTED).",
      },
    },
  },

  ValidationError: {
    allOf: [
      ref("Error"),
      {
        type: "object",
        properties: {
          issues: {
            type: "array",
            description: "Zod issues, when the failure was schema validation.",
            items: {
              type: "object",
              properties: {
                path: { type: "array", items: { type: "string" } },
                message: { type: "string" },
              },
            },
          },
        },
      },
    ],
  },

  Paise: {
    type: "integer",
    format: "int64",
    description:
      "An amount in integer PAISE (1/100 rupee). Every monetary field in this API is paise " +
      "and is named with a `Paise` suffix. Rupees are never sent over the wire: they cannot " +
      "represent 1/3 of a rupee exactly, and accumulating them loses money.",
    example: 118000,
  },

  Quantity: {
    type: "number",
    description:
      "A stock quantity. Fractional, because real units are (2.5 kg, 0.75 m). Not money - " +
      "quantities are the only numbers in this API that are not integers.",
    example: 2.5,
  },

  Party: {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      type: { type: "string", enum: ["CUSTOMER", "SUPPLIER", "BOTH"] },
      gstin: {
        type: "string",
        nullable: true,
        description: "15 characters. Rejected unless the check digit is valid.",
        example: "29AAGCB1286Q1ZP",
      },
      pan: { type: "string", nullable: true },
      email: { type: "string", nullable: true },
      phone: { type: "string", nullable: true },
      stateCode: {
        type: "string",
        nullable: true,
        description:
          "Two-digit GST state code. Decides CGST+SGST versus IGST, so it is required for a " +
          "GST-registered party.",
      },
      openingBalancePaise: ref("Paise"),
    },
  },

  Item: {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      sku: { type: "string", nullable: true },
      hsn: { type: "string", nullable: true },
      barcode: { type: "string", nullable: true },
      unit: { type: "string", example: "NOS" },
      salePricePaise: ref("Paise"),
      purchasePricePaise: ref("Paise"),
      gstRate: { type: "number", example: 18 },
      cessRate: { type: "number", example: 0 },
      cessPerUnitPaise: ref("Paise"),
      supplyType: {
        type: "string",
        enum: ["TAXABLE", "EXEMPT", "NIL_RATED", "NON_GST", "ZERO_RATED"],
        description:
          "These are four different things on a GST return even though three of them charge " +
          "0%. Do not collapse them.",
      },
      pricingMode: {
        type: "string",
        enum: ["EXCLUSIVE", "INCLUSIVE"],
        description: "INCLUSIVE means salePricePaise already contains GST (MRP goods).",
      },
      openingStock: ref("Quantity"),
      openingRatePaise: {
        allOf: [ref("Paise")],
        description:
          "Cost of the opening stock. Separate from purchasePricePaise so that re-pricing an " +
          "item does not retrospectively revalue stock already held.",
      },
      currentStock: ref("Quantity"),
      lowStockAlert: ref("Quantity"),
      trackBatches: { type: "boolean" },
    },
  },

  DocumentLine: {
    type: "object",
    required: ["itemName", "quantity", "rate"],
    properties: {
      itemId: {
        type: "string",
        nullable: true,
        description: "Link to an Item to move stock. Omit for a service line.",
      },
      itemName: { type: "string" },
      hsn: { type: "string", nullable: true },
      quantity: ref("Quantity"),
      rate: {
        oneOf: [{ type: "number" }, { type: "string" }],
        description:
          "Unit rate in RUPEES as typed by the user. Strings are parsed digit-wise so " +
          '"0.145" is exact. Converted to paise server-side; the response is paise.',
      },
      discount: {
        oneOf: [{ type: "number" }, { type: "string" }],
        description: "Line discount in rupees. Applied BEFORE tax, per section 15(3) of the CGST Act.",
      },
      gstRate: { type: "number" },
      cessRate: { type: "number" },
      unit: { type: "string" },
      supplyType: { type: "string", enum: ["TAXABLE", "EXEMPT", "NIL_RATED", "NON_GST", "ZERO_RATED"] },
      pricingMode: { type: "string", enum: ["EXCLUSIVE", "INCLUSIVE"] },
    },
  },

  TaxTotals: {
    type: "object",
    description: "Computed server-side. Values sent by a client are ignored.",
    properties: {
      subTotalPaise: ref("Paise"),
      discountPaise: ref("Paise"),
      cgstTotalPaise: ref("Paise"),
      sgstTotalPaise: ref("Paise"),
      igstTotalPaise: ref("Paise"),
      cessTotalPaise: ref("Paise"),
      taxTotalPaise: ref("Paise"),
      tdsPaise: {
        allOf: [ref("Paise")],
        description:
          "Shown separately and NOT deducted from grandTotalPaise. TDS is withheld by the " +
          "buyer from payment; the invoice is still for the full amount.",
      },
      roundOffPaise: ref("Paise"),
      grandTotalPaise: ref("Paise"),
      isInterState: {
        type: "boolean",
        description: "True means IGST; false means CGST + SGST. Never both.",
      },
      reverseCharge: { type: "boolean" },
      placeOfSupply: { type: "string", nullable: true },
    },
  },

  Invoice: {
    allOf: [
      {
        type: "object",
        properties: {
          id: { type: "string" },
          number: {
            type: "string",
            example: "INV/26-27/0042",
            description:
              "Allocated atomically inside the same transaction as the document, per financial " +
              "year. GST requires a gap-free consecutive series.",
          },
          date: { type: "string", format: "date-time" },
          dueDate: { type: "string", format: "date-time", nullable: true },
          status: { type: "string", enum: ["UNPAID", "PARTIAL", "PAID", "CANCELLED"] },
          partyId: { type: "string" },
          amountPaidPaise: ref("Paise"),
          notes: { type: "string", nullable: true },
          items: { type: "array", items: ref("InvoiceLine") },
        },
      },
      ref("TaxTotals"),
    ],
  },

  InvoiceLine: {
    type: "object",
    properties: {
      id: { type: "string" },
      itemId: { type: "string", nullable: true },
      itemName: { type: "string" },
      hsn: { type: "string", nullable: true },
      quantity: ref("Quantity"),
      unit: { type: "string" },
      ratePaise: ref("Paise"),
      discountPaise: ref("Paise"),
      apportionedDiscountPaise: {
        allOf: [ref("Paise")],
        description:
          "Share of an invoice-level discount allocated to this line by taxable value, so the " +
          "line taxable values still sum to the invoice taxable value exactly.",
      },
      taxablePaise: ref("Paise"),
      gstRate: { type: "number" },
      cgstPaise: ref("Paise"),
      sgstPaise: ref("Paise"),
      igstPaise: ref("Paise"),
      cessPaise: ref("Paise"),
      totalPaise: ref("Paise"),
    },
  },

  CreateInvoice: {
    type: "object",
    required: ["partyId", "lines"],
    properties: {
      partyId: { type: "string" },
      date: { type: "string", format: "date-time" },
      dueDate: { type: "string", format: "date-time" },
      lines: { type: "array", minItems: 1, items: ref("DocumentLine") },
      discount: {
        oneOf: [{ type: "number" }, { type: "string" }],
        description: "Invoice-level discount in rupees, apportioned across lines before tax.",
      },
      additionalCharges: { oneOf: [{ type: "number" }, { type: "string" }] },
      tdsRate: { type: "number" },
      reverseCharge: { type: "boolean" },
      placeOfSupply: { type: "string", description: "Two-digit state code. Defaults to the party's." },
      notes: { type: "string" },
    },
  },

  Purchase: {
    allOf: [
      {
        type: "object",
        properties: {
          id: { type: "string" },
          number: { type: "string", example: "PUR/26-27/0007" },
          vendorBillNo: { type: "string", nullable: true },
          date: { type: "string", format: "date-time" },
          status: { type: "string", enum: ["UNPAID", "PARTIAL", "PAID"] },
          partyId: { type: "string" },
          itcEligible: {
            type: "boolean",
            description: "Whether input tax credit may be claimed. Drives the GST summary.",
          },
        },
      },
      ref("TaxTotals"),
    ],
  },

  OrderDocument: {
    allOf: [
      {
        type: "object",
        properties: {
          id: { type: "string" },
          docType: {
            type: "string",
            enum: ["SALES_ORDER", "DELIVERY_CHALLAN", "PURCHASE_ORDER", "GRN"],
            description:
              "One table with a discriminator. Stock moves for DELIVERY_CHALLAN (out) and GRN " +
              "(in) only; orders are commitments and move nothing.",
          },
          number: { type: "string" },
          date: { type: "string", format: "date-time" },
          expectedDate: { type: "string", format: "date-time", nullable: true },
          status: { type: "string", enum: ["OPEN", "PARTIAL", "COMPLETED", "CANCELLED"] },
          externalRef: { type: "string", nullable: true },
          transporterName: { type: "string", nullable: true },
          vehicleNumber: { type: "string", nullable: true },
          movementReason: {
            type: "string",
            nullable: true,
            enum: ["JOB_WORK", "APPROVAL", "BRANCH_TRANSFER", "REPLACEMENT", "OTHER"],
            description: "Required on a delivery challan: why goods move without an invoice.",
          },
          sourceDocumentId: { type: "string", nullable: true },
          convertedToId: { type: "string", nullable: true },
        },
      },
      ref("TaxTotals"),
    ],
  },

  Payment: {
    type: "object",
    properties: {
      id: { type: "string" },
      number: { type: "string", example: "PMT/26-27/0012" },
      date: { type: "string", format: "date-time" },
      amountPaise: ref("Paise"),
      mode: { type: "string", enum: ["CASH", "BANK", "UPI", "CHEQUE", "CARD", "OTHER"] },
      direction: { type: "string", enum: ["IN", "OUT"] },
      reference: { type: "string", nullable: true },
      partyId: { type: "string", nullable: true },
      invoiceId: { type: "string", nullable: true },
      purchaseId: { type: "string", nullable: true },
    },
  },

  Ledger: {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      groupId: { type: "string" },
      openingBalancePaise: ref("Paise"),
      openingIsDebit: { type: "boolean" },
    },
  },

  JournalEntry: {
    type: "object",
    properties: {
      id: { type: "string" },
      voucherType: {
        type: "string",
        enum: ["JOURNAL", "CONTRA", "SALES", "PURCHASE", "RECEIPT", "PAYMENT", "CREDIT_NOTE", "DEBIT_NOTE", "EXPENSE", "CLOSING"],
      },
      voucherNo: { type: "string" },
      date: { type: "string", format: "date-time" },
      narration: { type: "string" },
      lines: {
        type: "array",
        items: {
          type: "object",
          properties: {
            ledgerId: { type: "string" },
            debitPaise: ref("Paise"),
            creditPaise: ref("Paise"),
            narration: { type: "string", nullable: true },
          },
        },
      },
    },
  },

  CreateJournalEntry: {
    type: "object",
    required: ["narration", "lines"],
    properties: {
      voucherType: { type: "string", enum: ["JOURNAL", "CONTRA"] },
      date: { type: "string", format: "date-time" },
      narration: { type: "string", maxLength: 500 },
      lines: {
        type: "array",
        minItems: 2,
        description:
          "Debits must equal credits. An unbalanced entry is rejected with the exact rupee " +
          "difference, and both sides of a CONTRA must be cash-equivalent ledgers.",
        items: {
          type: "object",
          required: ["ledgerId"],
          properties: {
            ledgerId: { type: "string" },
            debit: { oneOf: [{ type: "number" }, { type: "string" }], description: "Rupees." },
            credit: { oneOf: [{ type: "number" }, { type: "string" }], description: "Rupees." },
            narration: { type: "string", maxLength: 300 },
          },
        },
      },
    },
  },

  ItemValuation: {
    type: "object",
    properties: {
      itemId: { type: "string" },
      name: { type: "string" },
      unit: { type: "string" },
      quantity: ref("Quantity"),
      ratePaise: { allOf: [ref("Paise")], description: "Weighted average unit cost of the closing position." },
      valuePaise: { allOf: [ref("Paise")], description: "Closing stock at cost." },
      cogsPaise: { allOf: [ref("Paise")], description: "Cost of goods sold over the reporting period." },
      salePricePaise: ref("Paise"),
      realisableValuePaise: ref("Paise"),
      belowCost: {
        type: "boolean",
        description:
          "Cost exceeds net realisable value. AS 2 requires the lower of the two, so this needs " +
          "a write-down decision - it is flagged, never applied silently.",
      },
      negativeStockQuantity: {
        allOf: [ref("Quantity")],
        description: "Quantity issued while there was nothing to issue. Its cost is an estimate until the receipt arrives.",
      },
      ledgerDriftQuantity: {
        allOf: [ref("Quantity")],
        description:
          "Difference between the cached Item.currentStock and the balance the movement ledger " +
          "implies. Always 0 in a healthy system; non-zero means some code path moved stock " +
          "without recording a movement.",
      },
      isLowStock: { type: "boolean" },
      isDeadStock: { type: "boolean" },
      idleDays: { type: "integer" },
      neverSold: { type: "boolean" },
      lastInDate: { type: "string", format: "date-time", nullable: true },
      lastOutDate: { type: "string", format: "date-time", nullable: true },
    },
  },

  StockAdjustment: {
    type: "object",
    properties: {
      id: { type: "string" },
      number: { type: "string", example: "ADJ/26-27/0003" },
      date: { type: "string", format: "date-time" },
      reason: { type: "string", enum: ADJUSTMENT_REASON_CODES },
      notes: { type: "string", nullable: true },
      items: {
        type: "array",
        items: {
          type: "object",
          properties: {
            itemId: { type: "string" },
            quantity: ref("Quantity"),
            direction: {
              type: "string",
              enum: ["IN", "OUT"],
              description: "Derived from the reason, never from the request.",
            },
            ratePaise: ref("Paise"),
            valuePaise: ref("Paise"),
            batchId: { type: "string", nullable: true },
          },
        },
      },
    },
  },

  CreateStockAdjustment: {
    type: "object",
    required: ["reason", "lines"],
    properties: {
      reason: {
        type: "string",
        enum: ADJUSTMENT_REASON_CODES,
        description:
          "The reason fixes the direction of the movement, so a DAMAGE cannot be filed as a " +
          "stock increase.",
      },
      date: { type: "string", format: "date-time" },
      notes: { type: "string", maxLength: 500 },
      godownId: { type: "string" },
      lines: {
        type: "array",
        minItems: 1,
        items: {
          type: "object",
          required: ["itemId", "quantity"],
          properties: {
            itemId: { type: "string" },
            quantity: { type: "number", exclusiveMinimum: 0 },
            rate: {
              oneOf: [{ type: "number" }, { type: "string" }],
              description: "Cost per unit in rupees. Defaults to the item's estimated cost.",
            },
            batchNo: { type: "string", description: "Must already exist for the item." },
            notes: { type: "string", maxLength: 300 },
          },
        },
      },
    },
  },

  PhysicalCount: {
    type: "object",
    properties: {
      id: { type: "string" },
      number: { type: "string", example: "PC/26-27/0001" },
      date: { type: "string", format: "date-time" },
      status: { type: "string", enum: ["DRAFT", "POSTED", "CANCELLED"] },
      countedBy: { type: "string", nullable: true },
      postedAt: { type: "string", format: "date-time", nullable: true },
      items: { type: "array", items: ref("PhysicalCountLine") },
    },
  },

  PhysicalCountLine: {
    type: "object",
    properties: {
      itemId: { type: "string" },
      systemQuantity: {
        allOf: [ref("Quantity")],
        description:
          "The book position FROZEN when the sheet was created. Not recomputed at posting time, " +
          "or the day's trading would be absorbed into the variance.",
      },
      countedQuantity: {
        allOf: [ref("Quantity")],
        description: "Pre-filled with systemQuantity, so posting an untouched sheet changes nothing.",
      },
      variance: ref("Quantity"),
      ratePaise: ref("Paise"),
    },
  },

  Batch: {
    type: "object",
    properties: {
      id: { type: "string" },
      itemId: { type: "string" },
      batchNo: { type: "string" },
      mfgDate: { type: "string", format: "date", nullable: true },
      expiryDate: { type: "string", format: "date", nullable: true },
      quantity: {
        allOf: [ref("Quantity")],
        description: "Driven by stock movements. Never set directly.",
      },
      status: {
        type: "string",
        enum: ["EXPIRED", "EXPIRING_30", "EXPIRING_90", "OK", "NO_EXPIRY"],
        description: "Judged on the date, so a batch expiring today is not yet expired.",
      },
    },
  },

  Notification: {
    type: "object",
    properties: {
      id: { type: "string" },
      kind: {
        type: "string",
        enum: ["INVOICE_OVERDUE", "LOW_STOCK", "GST_DUE", "GRN_NOT_INVOICED", "BOOKS_UNBALANCED", "PAYMENT_RECEIVED"],
      },
      severity: { type: "string", enum: ["INFO", "WARNING", "CRITICAL"] },
      title: { type: "string" },
      body: { type: "string" },
      readAt: { type: "string", format: "date-time", nullable: true },
      createdAt: { type: "string", format: "date-time" },
    },
  },

  PaymentLink: {
    type: "object",
    properties: {
      id: { type: "string" },
      token: {
        type: "string",
        description:
          "Unguessable public token, NOT the row id. The pay page is reachable without a session, " +
          "so the identifier must not be enumerable.",
      },
      status: { type: "string", enum: ["PENDING", "PAID", "EXPIRED", "CANCELLED"] },
      amountPaise: ref("Paise"),
      paidPaise: { allOf: [ref("Paise")], description: "Partial settlement leaves the link PENDING." },
      expiresAt: { type: "string", format: "date-time", nullable: true },
    },
  },

  Company: {
    type: "object",
    properties: {
      id: { type: "string" },
      name: { type: "string" },
      gstin: { type: "string", nullable: true },
      stateCode: { type: "string", nullable: true },
      gstScheme: {
        type: "string",
        enum: ["REGULAR", "COMPOSITION"],
        description:
          "A composition dealer issues a bill of supply, cannot collect GST, and cannot claim " +
          "input credit - so purchase tax becomes part of inventory cost.",
      },
      roundInvoices: { type: "boolean" },
      stockValuationMethod: { type: "string", enum: [...VALUATION_METHODS] },
      deadStockDays: { type: "integer" },
      financialYear: { type: "string", example: "2026-27" },
      plan: { type: "string", enum: PLAN_IDS },
    },
  },

  HealthStatus: {
    type: "object",
    properties: {
      status: { type: "string", enum: ["ok", "degraded"] },
      database: { type: "string" },
      uptimeSeconds: { type: "number" },
      version: { type: "string" },
    },
  },
};

/* -------------------------------------------------------------------- paths */

const paths: Record<string, PathItem> = {
  /* ---- system ---- */
  "/api/health": {
    get: {
      tags: ["System"],
      summary: "Liveness and readiness probe",
      description: "Unauthenticated, for load balancers and container orchestrators.",
      security: [],
      responses: { "200": ok(ref("HealthStatus")) },
    },
  },
  "/api/openapi": {
    get: {
      tags: ["System"],
      summary: "This document",
      security: [],
      responses: { "200": ok({ type: "object" }) },
    },
  },

  /* ---- auth ---- */
  "/api/auth/register": {
    post: {
      tags: ["Auth"],
      summary: "Create an account and its first company",
      security: [],
      requestBody: body({
        type: "object",
        required: ["name", "email", "password", "companyName"],
        properties: {
          name: { type: "string" },
          email: { type: "string", format: "email" },
          password: { type: "string", minLength: 8 },
          companyName: { type: "string" },
        },
      }),
      responses: {
        "200": ok({ type: "object" }, "Signed in; a session cookie is set"),
        "400": { description: "Validation failed, or the email is taken", ...json(ref("ValidationError")) },
        "429": { description: "Rate limited", ...json(ref("Error")) },
      },
    },
  },
  "/api/auth/login": {
    post: {
      tags: ["Auth"],
      summary: "Sign in, optionally with a second factor",
      description:
        "When two-factor authentication is enabled, a password-only request returns " +
        "`{ twoFactorRequired: true }` and sets NO cookie. The password and the code are " +
        "verified in a single request, so there is never a half-authenticated session to steal. " +
        "`code` accepts either a TOTP code or a recovery code; recovery codes are consumed.",
      security: [],
      requestBody: body({
        type: "object",
        required: ["email", "password"],
        properties: {
          email: { type: "string", format: "email" },
          password: { type: "string" },
          code: { type: "string", description: "TOTP or recovery code." },
        },
      }),
      responses: {
        "200": ok(
          {
            oneOf: [
              { type: "object", properties: { ok: { type: "boolean" } } },
              { type: "object", properties: { twoFactorRequired: { type: "boolean" } } },
            ],
          },
          "Signed in, or a second factor is required"
        ),
        "401": { description: "Bad credentials or bad code", ...json(ref("Error")) },
        "429": { description: "Rate limited", ...json(ref("Error")) },
      },
    },
  },
  "/api/auth/logout": {
    post: {
      tags: ["Auth"],
      summary: "Sign out and revoke the session",
      description:
        "Idempotent and deliberately unauthenticated: signing out when already signed out is " +
        "success, not an error. Returning 401 here would leave a client unable to clear a " +
        "session it believes it has.",
      security: [],
      responses: { "200": ok({ type: "object" }) },
    },
  },

  /* ---- me ---- */
  "/api/me/locale": {
    put: {
      tags: ["Me"],
      summary: "Change UI language",
      description:
        "Stored on the user, not in a cookie, so the choice follows them across devices. Not " +
        "gated by the write guard: a read-only user still needs to read the app in their language.",
      requestBody: body({
        type: "object",
        required: ["locale"],
        properties: { locale: { type: "string", enum: [...LOCALES] } },
      }),
      responses: { "200": ok({ type: "object" }), ...AUTH_ERRORS },
    },
  },
  "/api/me/2fa": {
    get: {
      tags: ["Me"],
      summary: "Two-factor status",
      responses: { "200": ok({ type: "object" }), ...AUTH_ERRORS },
    },
    post: {
      tags: ["Me"],
      summary: "Begin enrolment: issue a secret and otpauth URI",
      description:
        "Does NOT enable two-factor authentication. A mis-scanned QR code must not be able to " +
        "lock somebody out of their own books permanently.",
      responses: { "200": ok({ type: "object" }), ...AUTH_ERRORS },
    },
    put: {
      tags: ["Me"],
      summary: "Confirm enrolment with a live code",
      description: "Returns eight recovery codes exactly once. Rate limited: six digits are brute-forceable.",
      requestBody: body({
        type: "object",
        required: ["code"],
        properties: { code: { type: "string", pattern: "^[0-9]{6}$" } },
      }),
      responses: { "200": ok({ type: "object" }), ...WRITE_ERRORS },
    },
    delete: {
      tags: ["Me"],
      summary: "Disable two-factor authentication",
      description:
        "Requires the current password and revokes every session. A hijacked session must not " +
        "be able to remove the factor that would have stopped it.",
      requestBody: body({
        type: "object",
        required: ["password"],
        properties: { password: { type: "string" } },
      }),
      responses: { "200": ok({ type: "object" }), ...WRITE_ERRORS },
    },
  },
  "/api/me/data": {
    get: {
      tags: ["Me"],
      summary: "Export all company data (DPDP access right)",
      description:
        "Admin only, 3 per hour. Excludes password hashes, TOTP secrets and recovery code " +
        "hashes. States its monetary unit explicitly as paise.",
      responses: { "200": ok({ type: "object" }), ...AUTH_ERRORS, "403": { description: "Admin only", ...json(ref("Error")) } },
    },
    delete: {
      tags: ["Me"],
      summary: "Erase all company data (DPDP erasure right)",
      description:
        "Requires the password AND the exact company name. Returns 409 RETENTION_WARNING when " +
        "records fall inside the 8-year GST retention window; resend with " +
        "`acknowledgeRetention: true` to proceed. GST retention and DPDP erasure genuinely " +
        "conflict, so the tenant makes an informed decision rather than the software choosing.",
      requestBody: body({
        type: "object",
        required: ["password", "companyName"],
        properties: {
          password: { type: "string" },
          companyName: { type: "string" },
          acknowledgeRetention: { type: "boolean" },
        },
      }),
      responses: {
        "200": ok({ type: "object" }),
        "409": { description: "Records are inside the retention window", ...json(ref("Error")) },
        ...WRITE_ERRORS,
      },
    },
  },

  /* ---- company & team ---- */
  "/api/company": {
    put: {
      tags: ["Company"],
      summary: "Update company profile and policies",
      description:
        "Changing `stockValuationMethod` returns 409 VALUATION_RESTATEMENT unless " +
        "`acknowledgeRestatement: true` is sent. Inventory value is derived from the movement " +
        "ledger, so switching method restates closing stock and COGS for every past period.",
      requestBody: body({
        allOf: [
          ref("Company"),
          { type: "object", properties: { acknowledgeRestatement: { type: "boolean" } } },
        ],
      }),
      responses: {
        "200": ok(ref("Company")),
        "409": { description: "Valuation method change needs acknowledgement", ...json(ref("Error")) },
        ...WRITE_ERRORS,
      },
    },
  },
  "/api/company/plan": {
    post: {
      tags: ["Company"],
      summary: "Change subscription plan",
      responses: { "200": ok({ type: "object" }), ...WRITE_ERRORS },
    },
  },
  "/api/team": {
    get: {
      tags: ["Team"],
      summary: "List team members",
      responses: { "200": ok({ type: "array", items: { type: "object" } }), ...AUTH_ERRORS },
    },
    post: {
      tags: ["Team"],
      summary: "Invite a team member",
      description:
        "VIEWER is read-only, enforced server-side by the write guard. ADMIN additionally gates " +
        "period locking, data export/erasure and webhook registration. ACCOUNTANT and OPERATOR " +
        "are currently equivalent - both can create every document and neither can perform an " +
        "admin action.",
      requestBody: body({
        type: "object",
        required: ["email", "role"],
        properties: {
          email: { type: "string", format: "email" },
          name: { type: "string" },
          role: { type: "string", enum: ["ADMIN", "ACCOUNTANT", "OPERATOR", "VIEWER"] },
        },
      }),
      responses: { "200": ok({ type: "object" }), "402": { description: "Plan user limit reached", ...json(ref("Error")) }, ...WRITE_ERRORS },
    },
  },
  "/api/team/{id}": {
    put: {
      tags: ["Team"],
      summary: "Change a member's role",
      parameters: [ID_PARAM],
      responses: { "200": ok({ type: "object" }), "404": NOT_FOUND, ...WRITE_ERRORS },
    },
    delete: {
      tags: ["Team"],
      summary: "Remove a member",
      parameters: [ID_PARAM],
      responses: { "200": ok({ type: "object" }), "404": NOT_FOUND, ...WRITE_ERRORS },
    },
  },

  /* ---- masters ---- */
  "/api/parties": {
    get: {
      tags: ["Parties"],
      summary: "List customers and suppliers",
      description: "Returns a plain array, not a paginated envelope.",
      parameters: [
        { name: "type", in: "query", schema: { type: "string", enum: ["CUSTOMER", "SUPPLIER", "BOTH"] } },
        { name: "q", in: "query", schema: { type: "string" }, description: "Name search." },
      ],
      responses: { "200": ok({ type: "array", items: ref("Party") }), ...AUTH_ERRORS },
    },
    post: {
      tags: ["Parties"],
      summary: "Create a party",
      description: "A GSTIN is rejected unless its check digit is valid.",
      requestBody: body(ref("Party")),
      responses: { "200": ok(ref("Party")), ...WRITE_ERRORS },
    },
  },
  "/api/parties/{id}": {
    get: {
      tags: ["Parties"],
      summary: "Get a party with its statement",
      parameters: [ID_PARAM],
      responses: { "200": ok(ref("Party")), "404": NOT_FOUND, ...AUTH_ERRORS },
    },
    put: {
      tags: ["Parties"],
      summary: "Update a party",
      parameters: [ID_PARAM],
      requestBody: body(ref("Party")),
      responses: { "200": ok(ref("Party")), "404": NOT_FOUND, ...WRITE_ERRORS },
    },
    delete: {
      tags: ["Parties"],
      summary: "Delete a party",
      description: "Refused when documents reference it.",
      parameters: [ID_PARAM],
      responses: { "200": ok({ type: "object" }), "404": NOT_FOUND, ...WRITE_ERRORS },
    },
  },
  "/api/parties/import": {
    post: {
      tags: ["Parties"],
      summary: "Bulk import parties from CSV rows",
      responses: { "200": ok({ type: "object" }), ...WRITE_ERRORS },
    },
  },
  "/api/items": {
    get: {
      tags: ["Items"],
      summary: "List stock and service items",
      description: "Returns a plain array, not a paginated envelope.",
      responses: { "200": ok({ type: "array", items: ref("Item") }), ...AUTH_ERRORS },
    },
    post: {
      tags: ["Items"],
      summary: "Create an item",
      description:
        "A non-zero `openingStock` also writes an OPENING stock movement, so the movement " +
        "ledger stays the complete history of the item.",
      requestBody: body(ref("Item")),
      responses: { "200": ok(ref("Item")), ...WRITE_ERRORS },
    },
  },
  "/api/items/{id}": {
    put: {
      tags: ["Items"],
      summary: "Update an item",
      description: "Changing `openingStock` records a stock movement for the difference.",
      parameters: [ID_PARAM],
      requestBody: body(ref("Item")),
      responses: { "200": ok(ref("Item")), "404": NOT_FOUND, ...WRITE_ERRORS },
    },
    delete: {
      tags: ["Items"],
      summary: "Delete an item",
      description:
        "Refused with HAS_MOVEMENTS when the item has stock history: movements cascade with the " +
        "item and deleting them would destroy the history behind past valuations.",
      parameters: [ID_PARAM],
      responses: { "200": ok({ type: "object" }), "400": { description: "Has stock history or is in use", ...json(ref("Error")) }, "404": NOT_FOUND, ...AUTH_ERRORS },
    },
  },
  "/api/items/import": {
    post: {
      tags: ["Items"],
      summary: "Bulk import items from CSV rows",
      responses: { "200": ok({ type: "object" }), ...WRITE_ERRORS },
    },
  },

  /* ---- sales ---- */
  "/api/invoices": {
    get: {
      tags: ["Sales"],
      summary: "List invoices",
      parameters: [
        ...PAGINATION_PARAMS,
        { name: "status", in: "query", schema: { type: "string", enum: ["UNPAID", "PARTIAL", "PAID", "CANCELLED"] } },
        { name: "partyId", in: "query", schema: { type: "string" } },
        { name: "from", in: "query", schema: { type: "string", format: "date" } },
        { name: "to", in: "query", schema: { type: "string", format: "date" } },
      ],
      responses: { "200": ok(paginated(ref("Invoice"))), ...AUTH_ERRORS },
    },
    post: {
      tags: ["Sales"],
      summary: "Raise a tax invoice",
      description:
        "Computes GST server-side, allocates the number atomically, moves stock, and posts the " +
        "double-entry journal - all in one transaction.",
      requestBody: body(ref("CreateInvoice")),
      responses: {
        "200": ok(ref("Invoice")),
        "402": { description: "Plan invoice limit reached", ...json(ref("Error")) },
        "409": { description: "The period is locked or the financial year is closed", ...json(ref("Error")) },
        ...WRITE_ERRORS,
      },
    },
  },
  "/api/invoices/{id}": {
    get: {
      tags: ["Sales"],
      summary: "Get an invoice",
      parameters: [ID_PARAM],
      responses: { "200": ok(ref("Invoice")), "404": NOT_FOUND, ...AUTH_ERRORS },
    },
    delete: {
      tags: ["Sales"],
      summary: "Delete an invoice",
      description:
        "Reverses stock and removes the ledger postings. Prefer cancelling an issued invoice: " +
        "GST requires the number series to have no gaps.",
      parameters: [ID_PARAM],
      responses: { "200": ok({ type: "object" }), "404": NOT_FOUND, ...WRITE_ERRORS },
    },
  },
  "/api/invoices/{id}/reminder": {
    post: {
      tags: ["Sales"],
      summary: "Send a payment reminder",
      description: "Rate limited per company and per IP: the outbound address is shared across tenants.",
      parameters: [ID_PARAM],
      responses: { "200": ok({ type: "object" }), "404": NOT_FOUND, ...WRITE_ERRORS },
    },
  },
  "/api/invoices/{id}/einvoice": {
    post: {
      tags: ["Sales"],
      summary: "Generate an e-invoice IRN",
      description: "Requires IRP credentials via a GSP. Returns 501 when not configured.",
      parameters: [ID_PARAM],
      responses: { "200": ok({ type: "object" }), "404": NOT_FOUND, "501": { description: "Not configured", ...json(ref("Error")) }, ...WRITE_ERRORS },
    },
  },
  "/api/invoices/{id}/eway-bill": {
    post: {
      tags: ["Sales"],
      summary: "Generate an e-way bill",
      parameters: [ID_PARAM],
      responses: { "200": ok({ type: "object" }), "404": NOT_FOUND, "501": { description: "Not configured", ...json(ref("Error")) }, ...WRITE_ERRORS },
    },
  },
  "/api/quotations": {
    get: {
      tags: ["Sales"],
      summary: "List quotations",
      parameters: PAGINATION_PARAMS,
      responses: { "200": ok(paginated({ type: "object" })), ...AUTH_ERRORS },
    },
    post: {
      tags: ["Sales"],
      summary: "Create a quotation",
      description: "No stock movement and no ledger posting: a quotation is not a transaction.",
      requestBody: body(ref("CreateInvoice")),
      responses: { "200": ok({ type: "object" }), ...WRITE_ERRORS },
    },
  },
  "/api/quotations/{id}": {
    get: { tags: ["Sales"], summary: "Get a quotation", parameters: [ID_PARAM], responses: { "200": ok({ type: "object" }), "404": NOT_FOUND, ...AUTH_ERRORS } },
    delete: { tags: ["Sales"], summary: "Delete a quotation", parameters: [ID_PARAM], responses: { "200": ok({ type: "object" }), "404": NOT_FOUND, ...WRITE_ERRORS } },
  },
  "/api/quotations/{id}/convert": {
    post: {
      tags: ["Sales"],
      summary: "Convert a quotation to an invoice",
      description: "Moves stock and posts the ledger at this point, not when the quotation was raised.",
      parameters: [ID_PARAM],
      responses: { "200": ok(ref("Invoice")), "404": NOT_FOUND, ...WRITE_ERRORS },
    },
  },
  "/api/orders": {
    get: {
      tags: ["Orders"],
      summary: "List sales orders, delivery challans, purchase orders and GRNs",
      parameters: [
        ...PAGINATION_PARAMS,
        { name: "docType", in: "query", schema: { type: "string", enum: ["SALES_ORDER", "DELIVERY_CHALLAN", "PURCHASE_ORDER", "GRN"] } },
        { name: "status", in: "query", schema: { type: "string", enum: ["OPEN", "PARTIAL", "COMPLETED", "CANCELLED"] } },
      ],
      responses: { "200": ok(paginated(ref("OrderDocument"))), ...AUTH_ERRORS },
    },
    post: {
      tags: ["Orders"],
      summary: "Create an order, challan, PO or GRN",
      description:
        "Stock moves for DELIVERY_CHALLAN (out) and GRN (in) only. None of the four posts to " +
        "the ledger; that happens on conversion.",
      requestBody: body({
        allOf: [
          ref("CreateInvoice"),
          {
            type: "object",
            required: ["docType"],
            properties: {
              docType: { type: "string", enum: ["SALES_ORDER", "DELIVERY_CHALLAN", "PURCHASE_ORDER", "GRN"] },
              expectedDate: { type: "string", format: "date-time" },
              sourceDocumentId: { type: "string" },
              transporterName: { type: "string" },
              vehicleNumber: { type: "string" },
              movementReason: { type: "string" },
            },
          },
        ],
      }),
      responses: { "200": ok(ref("OrderDocument")), ...WRITE_ERRORS },
    },
  },
  "/api/orders/{id}": {
    get: { tags: ["Orders"], summary: "Get an order document", parameters: [ID_PARAM], responses: { "200": ok(ref("OrderDocument")), "404": NOT_FOUND, ...AUTH_ERRORS } },
    delete: {
      tags: ["Orders"],
      summary: "Cancel an order document",
      description: "Reverses any stock it moved. The document is retained for audit.",
      parameters: [ID_PARAM],
      responses: { "200": ok({ type: "object" }), "404": NOT_FOUND, ...WRITE_ERRORS },
    },
  },
  "/api/orders/{id}/convert": {
    post: {
      tags: ["Orders"],
      summary: "Convert to an invoice or a purchase",
      description:
        "SALES_ORDER and DELIVERY_CHALLAN become an invoice; PURCHASE_ORDER and GRN become a " +
        "purchase. Stock is NOT moved again if the source document already moved it.",
      parameters: [ID_PARAM],
      responses: { "200": ok({ type: "object" }), "400": { description: "Already converted", ...json(ref("Error")) }, "404": NOT_FOUND, ...WRITE_ERRORS },
    },
  },
  "/api/credit-notes": {
    get: {
      tags: ["Sales"],
      summary: "List credit and debit notes",
      parameters: [...PAGINATION_PARAMS, { name: "kind", in: "query", schema: { type: "string", enum: ["CREDIT", "DEBIT"] } }],
      responses: { "200": ok(paginated({ type: "object" })), ...AUTH_ERRORS },
    },
    post: {
      tags: ["Sales"],
      summary: "Raise a credit or debit note",
      description:
        "CREDIT is a sales return: goods come back in, at COST rather than at the credited " +
        "price. DEBIT is a purchase return.",
      requestBody: body({
        allOf: [ref("CreateInvoice"), { type: "object", properties: { kind: { type: "string", enum: ["CREDIT", "DEBIT"] }, reason: { type: "string" }, originalRef: { type: "string" } } }],
      }),
      responses: { "200": ok({ type: "object" }), ...WRITE_ERRORS },
    },
  },
  "/api/credit-notes/{id}": {
    get: { tags: ["Sales"], summary: "Get a note", parameters: [ID_PARAM], responses: { "200": ok({ type: "object" }), "404": NOT_FOUND, ...AUTH_ERRORS } },
    delete: { tags: ["Sales"], summary: "Delete a note and reverse its effects", parameters: [ID_PARAM], responses: { "200": ok({ type: "object" }), "404": NOT_FOUND, ...WRITE_ERRORS } },
  },
  "/api/recurring-invoices": {
    get: { tags: ["Sales"], summary: "List recurring invoice templates", responses: { "200": ok({ type: "array", items: { type: "object" } }), ...AUTH_ERRORS } },
    post: { tags: ["Sales"], summary: "Create a recurring invoice template", responses: { "200": ok({ type: "object" }), ...WRITE_ERRORS } },
  },

  /* ---- purchases & expenses ---- */
  "/api/purchases": {
    get: {
      tags: ["Purchases"],
      summary: "List purchases",
      parameters: PAGINATION_PARAMS,
      responses: { "200": ok(paginated(ref("Purchase"))), ...AUTH_ERRORS },
    },
    post: {
      tags: ["Purchases"],
      summary: "Record a purchase bill",
      description:
        "Stock comes in carrying its COST: taxable value net of discount, excluding GST for a " +
        "regular dealer (recoverable as input credit) and including it for a composition dealer.",
      requestBody: body({
        allOf: [ref("CreateInvoice"), { type: "object", properties: { vendorBillNo: { type: "string" }, itcEligible: { type: "boolean" } } }],
      }),
      responses: { "200": ok(ref("Purchase")), "409": { description: "Period locked", ...json(ref("Error")) }, ...WRITE_ERRORS },
    },
  },
  "/api/purchases/{id}": {
    get: { tags: ["Purchases"], summary: "Get a purchase", parameters: [ID_PARAM], responses: { "200": ok(ref("Purchase")), "404": NOT_FOUND, ...AUTH_ERRORS } },
    delete: { tags: ["Purchases"], summary: "Delete a purchase and reverse its stock", parameters: [ID_PARAM], responses: { "200": ok({ type: "object" }), "404": NOT_FOUND, ...WRITE_ERRORS } },
  },
  "/api/expenses": {
    get: { tags: ["Purchases"], summary: "List expenses", parameters: PAGINATION_PARAMS, responses: { "200": ok(paginated({ type: "object" })), ...AUTH_ERRORS } },
    post: { tags: ["Purchases"], summary: "Record an expense", responses: { "200": ok({ type: "object" }), ...WRITE_ERRORS } },
  },
  "/api/expenses/{id}": {
    delete: { tags: ["Purchases"], summary: "Delete an expense", parameters: [ID_PARAM], responses: { "200": ok({ type: "object" }), "404": NOT_FOUND, ...WRITE_ERRORS } },
  },

  /* ---- payments ---- */
  "/api/payments": {
    get: { tags: ["Payments"], summary: "List receipts and payments", parameters: PAGINATION_PARAMS, responses: { "200": ok(paginated(ref("Payment"))), ...AUTH_ERRORS } },
    post: {
      tags: ["Payments"],
      summary: "Record a receipt or a payment",
      description: "Allocates against an invoice or purchase and posts the ledger entry.",
      requestBody: body({
        type: "object",
        required: ["amount", "mode", "direction"],
        properties: {
          amount: { oneOf: [{ type: "number" }, { type: "string" }], description: "Rupees." },
          mode: { type: "string", enum: ["CASH", "BANK", "UPI", "CHEQUE", "CARD", "OTHER"] },
          direction: { type: "string", enum: ["IN", "OUT"] },
          partyId: { type: "string" },
          invoiceId: { type: "string" },
          purchaseId: { type: "string" },
          date: { type: "string", format: "date-time" },
          reference: { type: "string" },
        },
      }),
      responses: { "200": ok(ref("Payment")), ...WRITE_ERRORS },
    },
  },
  "/api/payments/{id}": {
    delete: { tags: ["Payments"], summary: "Delete a payment and reverse its allocation", parameters: [ID_PARAM], responses: { "200": ok({ type: "object" }), "404": NOT_FOUND, ...WRITE_ERRORS } },
  },
  "/api/payments/webhook": {
    post: {
      tags: ["Payments"],
      summary: "Payment gateway webhook",
      description:
        "Unauthenticated by necessity; authenticity comes from an HMAC signature over the RAW " +
        "body. Idempotent: the event id is inserted inside the settlement transaction, so a " +
        "concurrent duplicate violates a unique constraint and rolls the whole thing back. " +
        "Returns 400 for a bad signature so the gateway stops retrying, 200 with " +
        "`{ duplicate: true }` for a replay, and 500 only for our own failures.",
      security: [],
      requestBody: body({ type: "object" }),
      responses: {
        "200": ok({ type: "object" }, "Processed, or a recognised duplicate"),
        "400": { description: "Signature missing, forged, or the body was altered after signing", ...json(ref("Error")) },
        "500": { description: "Our failure; the gateway should retry", ...json(ref("Error")) },
      },
    },
  },
  "/api/payment-links": {
    get: { tags: ["Payments"], summary: "List payment links", parameters: PAGINATION_PARAMS, responses: { "200": ok(paginated(ref("PaymentLink"))), ...AUTH_ERRORS } },
    post: {
      tags: ["Payments"],
      summary: "Create a payment link for an invoice",
      description: "Reuses an open link for the same amount, and caps the amount at the outstanding balance.",
      requestBody: body({ type: "object", required: ["invoiceId"], properties: { invoiceId: { type: "string" }, amount: { oneOf: [{ type: "number" }, { type: "string" }] } } }),
      responses: { "200": ok(ref("PaymentLink")), ...WRITE_ERRORS },
    },
  },
  "/api/coupons/validate": {
    post: {
      tags: ["Billing"],
      summary: "Validate a discount coupon",
      requestBody: body({ type: "object", required: ["code"], properties: { code: { type: "string" }, plan: { type: "string", enum: PLAN_IDS } } }),
      responses: { "200": ok({ type: "object" }), "404": { description: "Unknown or inactive coupon", ...json(ref("Error")) }, ...AUTH_ERRORS },
    },
  },

  /* ---- accounting ---- */
  "/api/ledgers": {
    get: {
      tags: ["Accounting"],
      summary: "Chart of accounts, grouped",
      description: "Creates the standard chart on first access for companies that predate it.",
      responses: { "200": ok({ type: "object" }), ...AUTH_ERRORS },
    },
    post: { tags: ["Accounting"], summary: "Create a ledger", requestBody: body(ref("Ledger")), responses: { "200": ok(ref("Ledger")), ...WRITE_ERRORS } },
  },
  "/api/journal-entries": {
    get: {
      tags: ["Accounting"],
      summary: "List journal and contra vouchers",
      parameters: [...PAGINATION_PARAMS, { name: "voucherType", in: "query", schema: { type: "string" } }],
      responses: { "200": ok(paginated(ref("JournalEntry"))), ...AUTH_ERRORS },
    },
    post: {
      tags: ["Accounting"],
      summary: "Post a manual journal or contra voucher",
      description:
        "Every ledger id is checked to belong to the caller's company - otherwise a crafted " +
        "request could post into another tenant's books. An unbalanced entry is rejected with " +
        "the exact rupee difference.",
      requestBody: body(ref("CreateJournalEntry")),
      responses: {
        "200": ok(ref("JournalEntry")),
        "409": { description: "Period locked", ...json(ref("Error")) },
        ...WRITE_ERRORS,
      },
    },
  },
  "/api/financial-years": {
    get: { tags: ["Accounting"], summary: "List financial years and their lock state", responses: { "200": ok({ type: "array", items: { type: "object" } }), ...AUTH_ERRORS } },
    post: { tags: ["Accounting"], summary: "Create a financial year", responses: { "200": ok({ type: "object" }), ...WRITE_ERRORS } },
    patch: {
      tags: ["Accounting"],
      summary: "Lock, unlock, close or reopen a year",
      description:
        "Admin only. CLOSE posts a closing voucher that moves every income and expense balance " +
        "to Retained Earnings. REOPEN also deletes that voucher, or income and expenses would " +
        "stay zeroed. Every UNLOCK is audit-logged.",
      requestBody: body({
        type: "object",
        required: ["id", "action"],
        properties: {
          id: { type: "string" },
          action: { type: "string", enum: ["LOCK", "UNLOCK", "CLOSE", "REOPEN"] },
          lockedTill: { type: "string", format: "date" },
        },
      }),
      responses: { "200": ok({ type: "object" }), "400": { description: "Already closed, or nothing to close", ...json(ref("Error")) }, ...WRITE_ERRORS },
    },
  },
  "/api/budgets": {
    get: { tags: ["Accounting"], summary: "List budgets", parameters: PAGINATION_PARAMS, responses: { "200": ok(paginated({ type: "object" })), ...AUTH_ERRORS } },
    post: { tags: ["Accounting"], summary: "Create a budget", responses: { "200": ok({ type: "object" }), ...WRITE_ERRORS } },
  },
  "/api/bank-reconciliation": {
    get: { tags: ["Accounting"], summary: "List imported bank transactions", responses: { "200": ok({ type: "object" }), ...AUTH_ERRORS } },
    post: { tags: ["Accounting"], summary: "Import a bank statement", responses: { "200": ok({ type: "object" }), ...WRITE_ERRORS } },
  },
  "/api/bank-reconciliation/match": {
    post: { tags: ["Accounting"], summary: "Match a bank line to a payment", responses: { "200": ok({ type: "object" }), ...WRITE_ERRORS } },
  },

  /* ---- inventory ---- */
  "/api/reports/inventory": {
    get: {
      tags: ["Inventory"],
      summary: "Stock valuation, ageing, dead stock, expiry, or an item's stock ledger",
      description:
        "Every figure is recomputed from the stock movement ledger on each request, so a report " +
        "can never disagree with the transactions behind it. See docs/INVENTORY_VALUATION.md.",
      parameters: [
        {
          name: "view",
          in: "query",
          schema: { type: "string", enum: ["valuation", "ageing", "dead", "expiry", "ledger"], default: "valuation" },
        },
        { name: "itemId", in: "query", schema: { type: "string" }, description: "Required for `view=ledger`." },
        { name: "asOf", in: "query", schema: { type: "string", format: "date" }, description: "Value the position as at this date." },
        { name: "from", in: "query", schema: { type: "string", format: "date" }, description: "Start of the COGS period. Defaults to the financial year start." },
        { name: "godownId", in: "query", schema: { type: "string" } },
        { name: "includeOk", in: "query", schema: { type: "boolean" }, description: "For `view=expiry`: include batches that are comfortably in date." },
      ],
      responses: {
        "200": ok({
          type: "object",
          properties: {
            view: { type: "string" },
            method: { type: "string", enum: [...VALUATION_METHODS] },
            totals: { type: "object" },
            flags: { type: "object" },
            ageing: { type: "array", items: { type: "object" } },
            items: { type: "array", items: ref("ItemValuation") },
          },
        }),
        "400": { description: "itemId missing for the ledger view", ...json(ref("Error")) },
        "404": NOT_FOUND,
        ...AUTH_ERRORS,
      },
    },
  },
  "/api/stock-adjustments": {
    get: {
      tags: ["Inventory"],
      summary: "List stock adjustments and the reason catalogue",
      parameters: [...PAGINATION_PARAMS, { name: "reason", in: "query", schema: { type: "string", enum: ADJUSTMENT_REASON_CODES } }],
      responses: {
        "200": ok({
          allOf: [
            paginated(ref("StockAdjustment")),
            { type: "object", properties: { reasons: { type: "array", items: { type: "object" } } } },
          ],
        }),
        ...AUTH_ERRORS,
      },
    },
    post: {
      tags: ["Inventory"],
      summary: "Record a stock adjustment",
      description:
        "Changes quantities only. It does NOT post to the ledger: purchases are already charged " +
        "to expenses on receipt (periodic inventory), so a second entry would double-count the loss.",
      requestBody: body(ref("CreateStockAdjustment")),
      responses: {
        "201": ok(ref("StockAdjustment"), "Created"),
        "409": { description: "Period locked", ...json(ref("Error")) },
        ...WRITE_ERRORS,
      },
    },
  },
  "/api/physical-counts": {
    get: {
      tags: ["Inventory"],
      summary: "List stock count sheets",
      parameters: [...PAGINATION_PARAMS, { name: "status", in: "query", schema: { type: "string", enum: ["DRAFT", "POSTED", "CANCELLED"] } }],
      responses: { "200": ok(paginated(ref("PhysicalCount"))), ...AUTH_ERRORS },
    },
    post: {
      tags: ["Inventory"],
      summary: "Open a count sheet",
      description:
        "Freezes the book quantity onto every line and pre-fills the counted quantity with it, " +
        "so posting an untouched sheet changes nothing.",
      requestBody: body(
        {
          type: "object",
          properties: {
            date: { type: "string", format: "date-time" },
            notes: { type: "string" },
            godownId: { type: "string" },
            countedBy: { type: "string" },
            itemIds: { type: "array", items: { type: "string" }, description: "Omit to count everything." },
          },
        },
        false
      ),
      responses: { "201": ok(ref("PhysicalCount"), "Created"), ...WRITE_ERRORS },
    },
  },
  "/api/physical-counts/{id}": {
    get: {
      tags: ["Inventory"],
      summary: "Get a count sheet with the effect of posting it",
      parameters: [ID_PARAM],
      responses: { "200": ok(ref("PhysicalCount")), "404": NOT_FOUND, ...AUTH_ERRORS },
    },
    patch: {
      tags: ["Inventory"],
      summary: "Record counted quantities",
      description: "Draft sheets only. A posted count is evidence and is immutable.",
      parameters: [ID_PARAM],
      requestBody: body({
        type: "object",
        required: ["lines"],
        properties: {
          lines: {
            type: "array",
            minItems: 1,
            items: {
              type: "object",
              required: ["itemId", "countedQuantity"],
              properties: { itemId: { type: "string" }, countedQuantity: { type: "number", minimum: 0 }, notes: { type: "string" } },
            },
          },
        },
      }),
      responses: { "200": ok(ref("PhysicalCount")), "400": { description: "Already posted", ...json(ref("Error")) }, "404": NOT_FOUND, ...WRITE_ERRORS },
    },
    delete: {
      tags: ["Inventory"],
      summary: "Cancel a draft count",
      description: "Refused with ALREADY_POSTED for a posted sheet; reverse its adjustment instead.",
      parameters: [ID_PARAM],
      responses: { "200": ok({ type: "object" }), "400": { description: "Already posted", ...json(ref("Error")) }, "404": NOT_FOUND, ...WRITE_ERRORS },
    },
  },
  "/api/physical-counts/{id}/post": {
    post: {
      tags: ["Inventory"],
      summary: "Post a count: turn its variances into one stock adjustment",
      description:
        "Separate from PATCH because posting moves stock, and a mistyped quantity saved during " +
        "data entry must not be able to trigger it. A count that agrees is still marked posted, " +
        "with no adjustment created.",
      parameters: [ID_PARAM],
      responses: {
        "200": ok({ type: "object", properties: { ok: { type: "boolean" }, adjustment: { type: "object", nullable: true }, varianceLines: { type: "integer" }, message: { type: "string" } } }),
        "400": { description: "Already posted or cancelled", ...json(ref("Error")) },
        "404": NOT_FOUND,
        "409": { description: "Period locked", ...json(ref("Error")) },
        ...WRITE_ERRORS,
      },
    },
  },
  "/api/batches": {
    get: {
      tags: ["Inventory"],
      summary: "List batches with their expiry status",
      parameters: [...PAGINATION_PARAMS, { name: "itemId", in: "query", schema: { type: "string" } }, { name: "inStock", in: "query", schema: { type: "boolean" } }],
      responses: { "200": ok(paginated(ref("Batch"))), ...AUTH_ERRORS },
    },
    post: {
      tags: ["Inventory"],
      summary: "Create a batch",
      description: "Created empty; quantity comes from the movements that name it.",
      requestBody: body({
        type: "object",
        required: ["itemId", "batchNo"],
        properties: { itemId: { type: "string" }, batchNo: { type: "string", maxLength: 60 }, mfgDate: { type: "string", format: "date" }, expiryDate: { type: "string", format: "date" }, notes: { type: "string" } },
      }),
      responses: {
        "201": ok(ref("Batch"), "Created"),
        "409": { description: "That batch number already exists for the item", ...json(ref("Error")) },
        "404": NOT_FOUND,
        ...WRITE_ERRORS,
      },
    },
  },
  "/api/godowns": {
    get: { tags: ["Inventory"], summary: "List godowns", responses: { "200": ok({ type: "array", items: { type: "object" } }), ...AUTH_ERRORS } },
    post: { tags: ["Inventory"], summary: "Create a godown", responses: { "200": ok({ type: "object" }), ...WRITE_ERRORS } },
  },
  "/api/stock-transfers": {
    get: { tags: ["Inventory"], summary: "List stock transfers", responses: { "200": ok({ type: "array", items: { type: "object" } }), ...AUTH_ERRORS } },
    post: {
      tags: ["Inventory"],
      summary: "Transfer stock between godowns",
      description:
        "Writes a matched out/in pair at the SAME cost: valuing the receipt independently would " +
        "create or destroy value by moving goods between your own shelves.",
      requestBody: body({
        type: "object",
        required: ["itemId", "fromGodownId", "toGodownId", "quantity"],
        properties: { itemId: { type: "string" }, fromGodownId: { type: "string" }, toGodownId: { type: "string" }, quantity: { type: "number" }, notes: { type: "string" }, date: { type: "string", format: "date-time" } },
      }),
      responses: { "200": ok({ type: "object" }), "402": { description: "Requires the Basic plan", ...json(ref("Error")) }, ...WRITE_ERRORS },
    },
  },

  /* ---- notifications & webhooks ---- */
  "/api/notifications": {
    get: {
      tags: ["Notifications"],
      summary: "Generate reminders, then list notifications",
      description:
        "Reminders are DERIVED from current state with a dedupe key, not scheduled, so this is " +
        "safe to call repeatedly and alerts clear themselves once the cause is gone. Pass " +
        "`generate=false` to list only.",
      parameters: [{ name: "generate", in: "query", schema: { type: "boolean", default: true } }],
      responses: { "200": ok({ type: "object", properties: { data: { type: "array", items: ref("Notification") }, unread: { type: "integer" } } }), ...AUTH_ERRORS },
    },
    patch: {
      tags: ["Notifications"],
      summary: "Mark read, mark all read, or dismiss",
      description: "Not gated by the write guard: a read-only user still needs to clear their own alerts.",
      requestBody: body({
        type: "object",
        required: ["action"],
        properties: { action: { type: "string", enum: ["READ", "READ_ALL", "DISMISS"] }, id: { type: "string" } },
      }),
      responses: { "200": ok({ type: "object" }), "404": NOT_FOUND, ...AUTH_ERRORS },
    },
  },
  "/api/webhooks": {
    get: {
      tags: ["Notifications"],
      summary: "List outbound webhook endpoints",
      description: "The signing secret is never returned; it is shown once at creation.",
      responses: { "200": ok({ type: "array", items: { type: "object" } }), ...AUTH_ERRORS },
    },
    post: {
      tags: ["Notifications"],
      summary: "Register an outbound webhook",
      description:
        "Admin only. HTTPS only, and requests to loopback, link-local and RFC1918 addresses are " +
        "refused - otherwise this endpoint is a server-side request forgery primitive. The " +
        "secret is returned exactly once.",
      requestBody: body({
        type: "object",
        required: ["url", "events"],
        properties: { url: { type: "string", format: "uri" }, events: { type: "array", items: { type: "string" } } },
      }),
      responses: { "200": ok({ type: "object" }), "400": { description: "Not HTTPS, or an internal address", ...json(ref("Error")) }, ...WRITE_ERRORS },
    },
  },
  "/api/support": {
    get: { tags: ["Support"], summary: "List this company's support tickets", responses: { "200": ok({ type: "array", items: { type: "object" } }), ...AUTH_ERRORS } },
    post: { tags: ["Support"], summary: "Raise a support ticket", responses: { "200": ok({ type: "object" }), ...WRITE_ERRORS } },
  },

  /* ---- AI ---- */
  "/api/ai/status": {
    get: {
      tags: ["AI"],
      summary: "Whether AI features are available",
      description:
        "Always 200, never an error, so the UI can render an explanation instead of a broken " +
        "input when AI is switched off.",
      responses: { "200": ok({ type: "object", properties: { available: { type: "boolean" }, provider: { type: "string" } } }), ...AUTH_ERRORS },
    },
  },
  "/api/ai/assistant": {
    post: {
      tags: ["AI"],
      summary: "Ask a question about your books",
      description:
        "Real figures are gathered server-side from the ledger and given to the model, which " +
        "only phrases them. The model never computes a number and never writes to the ledger.",
      requestBody: body({ type: "object", required: ["question"], properties: { question: { type: "string" } } }),
      responses: { "200": ok({ type: "object" }), "402": { description: "Monthly token budget exhausted", ...json(ref("Error")) }, "503": { description: "AI is disabled", ...json(ref("Error")) }, ...WRITE_ERRORS },
    },
  },
  "/api/ai/ocr": {
    post: {
      tags: ["AI"],
      summary: "Read a purchase bill image into a draft",
      description:
        "Returns a DRAFT only, with `requiresReview: true`. The server independently re-checks " +
        "the GSTIN checksum and that taxable + tax = total, so a misread is caught before a user " +
        "sees it. File type is decided by magic bytes, not the declared MIME type.",
      requestBody: { required: true, content: { "multipart/form-data": { schema: { type: "object", properties: { file: { type: "string", format: "binary" } } } } } },
      responses: { "200": ok({ type: "object" }), "400": { description: "Unsupported or oversized file", ...json(ref("Error")) }, "503": { description: "AI is disabled", ...json(ref("Error")) }, ...WRITE_ERRORS },
    },
  },
  "/api/ai/categorise": {
    post: {
      tags: ["AI"],
      summary: "Suggest an expense head",
      description: "Constrained to ledgers that already exist in this company, and the suggestion is verified before returning.",
      requestBody: body({ type: "object", required: ["description"], properties: { description: { type: "string" }, amount: { type: "number" } } }),
      responses: { "200": ok({ type: "object" }), "503": { description: "AI is disabled", ...json(ref("Error")) }, ...WRITE_ERRORS },
    },
  },
  "/api/ai/usage": {
    get: {
      tags: ["AI"],
      summary: "Token spend against the monthly budget",
      responses: { "200": ok({ type: "object" }), ...AUTH_ERRORS },
    },
  },

  /* ---- export ---- */
  "/api/export": {
    get: {
      tags: ["Reports"],
      summary: "Export a dataset as CSV",
      parameters: [{ name: "type", in: "query", required: true, schema: { type: "string", enum: ["invoices", "parties", "items", "purchases", "payments", "expenses"] } }],
      responses: { "200": { description: "CSV", content: { "text/csv": { schema: { type: "string" } } } }, ...AUTH_ERRORS },
    },
  },

  /* ---- platform admin ---- */
  "/api/admin/companies": {
    get: { tags: ["Admin"], summary: "List all tenants", description: "Platform super-admin only.", responses: { "200": ok({ type: "object" }), "403": { description: "Not a super-admin", ...json(ref("Error")) } } },
  },
  "/api/admin/companies/{id}": {
    put: { tags: ["Admin"], summary: "Suspend, restore or change a tenant's plan", parameters: [ID_PARAM], responses: { "200": ok({ type: "object" }), "403": { description: "Not a super-admin", ...json(ref("Error")) } } },
  },
  "/api/admin/plans": {
    get: { tags: ["Admin"], summary: "Effective plan configuration", responses: { "200": ok({ type: "object" }), "403": { description: "Not a super-admin", ...json(ref("Error")) } } },
    put: {
      tags: ["Admin"],
      summary: "Override plan pricing and limits",
      description: "`priceMonthlyPaise` and `priceAnnualPaise` are integer paise, as the names say.",
      requestBody: body({ type: "object", required: ["id"], properties: { id: { type: "string", enum: PLAN_IDS }, name: { type: "string" }, tagline: { type: "string" }, priceMonthlyPaise: ref("Paise"), priceAnnualPaise: ref("Paise"), invoiceLimit: { type: "integer" }, userLimit: { type: "integer" }, active: { type: "boolean" } } }),
      responses: { "200": ok({ type: "object" }), "400": { description: "Invalid plan id", ...json(ref("Error")) }, "403": { description: "Not a super-admin", ...json(ref("Error")) } },
    },
  },
  "/api/admin/coupons": {
    get: { tags: ["Admin"], summary: "List coupons", responses: { "200": ok({ type: "array", items: { type: "object" } }), "403": { description: "Not a super-admin", ...json(ref("Error")) } } },
    post: { tags: ["Admin"], summary: "Create a coupon", responses: { "200": ok({ type: "object" }), "403": { description: "Not a super-admin", ...json(ref("Error")) } } },
  },
  "/api/admin/coupons/{id}": {
    put: { tags: ["Admin"], summary: "Update a coupon", parameters: [ID_PARAM], responses: { "200": ok({ type: "object" }), "403": { description: "Not a super-admin", ...json(ref("Error")) } } },
    delete: { tags: ["Admin"], summary: "Delete a coupon", parameters: [ID_PARAM], responses: { "200": ok({ type: "object" }), "403": { description: "Not a super-admin", ...json(ref("Error")) } } },
  },
  "/api/admin/tickets": {
    get: { tags: ["Admin"], summary: "List support tickets across tenants", responses: { "200": ok({ type: "object" }), "403": { description: "Not a super-admin", ...json(ref("Error")) } } },
  },
  "/api/admin/tickets/{id}": {
    put: { tags: ["Admin"], summary: "Reply to or close a ticket", parameters: [ID_PARAM], responses: { "200": ok({ type: "object" }), "403": { description: "Not a super-admin", ...json(ref("Error")) } } },
  },
  "/api/admin/broadcast": {
    get: { tags: ["Admin"], summary: "List broadcasts", responses: { "200": ok({ type: "array", items: { type: "object" } }), "403": { description: "Not a super-admin", ...json(ref("Error")) } } },
    post: { tags: ["Admin"], summary: "Send a broadcast to tenants", responses: { "200": ok({ type: "object" }), "403": { description: "Not a super-admin", ...json(ref("Error")) } } },
  },
  "/api/admin/site-settings": {
    get: { tags: ["Admin"], summary: "Read platform settings and feature flags", responses: { "200": ok({ type: "object" }), "403": { description: "Not a super-admin", ...json(ref("Error")) } } },
    put: { tags: ["Admin"], summary: "Update platform settings and feature flags", responses: { "200": ok({ type: "object" }), "403": { description: "Not a super-admin", ...json(ref("Error")) } } },
  },
  "/api/admin/export": {
    get: {
      tags: ["Admin"],
      summary: "Export platform data as CSV",
      parameters: [{ name: "type", in: "query", schema: { type: "string", enum: ["companies", "tickets"] } }],
      responses: { "200": { description: "CSV", content: { "text/csv": { schema: { type: "string" } } } }, "403": { description: "Not a super-admin", ...json(ref("Error")) } },
    },
  },
};

/* ------------------------------------------------------------------ document */

export const openApiDocument = {
  openapi: "3.1.0",
  info: {
    title: "GST Invoice System API",
    version: "1.0.0",
    description: [
      "HTTP API for a multi-tenant GST invoicing, inventory and accounting application.",
      "",
      "## Everything is scoped to your company",
      "",
      "`companyId` is never accepted from a request. It is resolved from the session, and every",
      "query filters on it. A resource belonging to another company returns 404, not 403 - a 403",
      "would confirm that the id exists.",
      "",
      "## Money is always integer paise",
      "",
      "Every monetary field is an integer number of paise and is named with a `Paise` suffix.",
      "Rupee amounts are accepted on INPUT for fields a human types (`rate`, `amount`, `debit`),",
      "as a number or a string, and are converted server-side. Output is always paise.",
      "",
      "Quantities are the exception: they are floats, because real trade units are fractional.",
      "",
      "## Totals are computed, never accepted",
      "",
      "Send lines; the server computes taxable values, CGST/SGST/IGST, cess, round-off and the",
      "grand total. Totals in a request body are ignored. This is why the API cannot be used to",
      "book an invoice whose tax does not follow from its lines.",
      "",
      "## Authentication",
      "",
      "A session cookie, set by `POST /api/auth/login`. Mutations also require a same-origin",
      "`Origin` or `Referer` header (CSRF defence), so a browser client needs no extra token but",
      "a cross-site form post is rejected.",
      "",
      "## Errors",
      "",
      "Errors are `{ error, code? }`. `code` is present when a client is expected to branch on it:",
      "`PLAN_LIMIT`, `PERIOD_LOCKED`, `VALUATION_RESTATEMENT`, `RETENTION_WARNING`, `DUPLICATE`,",
      "`HAS_MOVEMENTS`, `ALREADY_POSTED`.",
      "",
      "## This document is kept honest by a test",
      "",
      "`src/lib/openapi.test.ts` walks `src/app/api` and fails if any route is missing here, or if",
      "any path here has no route file. See `docs/DEVELOPER_GUIDE.md`.",
    ].join("\n"),
    license: { name: "See LICENSE in the repository" },
  },
  servers: [
    { url: "http://localhost:3000", description: "Local development" },
    { url: "https://{host}", description: "Your deployment", variables: { host: { default: "invoices.example.com" } } },
  ],
  tags: [
    { name: "System", description: "Health and machine-readable metadata." },
    { name: "Auth", description: "Sign in, sign out, register." },
    { name: "Me", description: "The signed-in user: language, two-factor, personal data rights." },
    { name: "Company", description: "Company profile, policies and subscription." },
    { name: "Team", description: "Users and roles within a company." },
    { name: "Parties", description: "Customers and suppliers." },
    { name: "Items", description: "Stock and service items." },
    { name: "Sales", description: "Invoices, quotations, credit and debit notes." },
    { name: "Orders", description: "Sales orders, delivery challans, purchase orders, GRNs." },
    { name: "Purchases", description: "Purchase bills and expenses." },
    { name: "Payments", description: "Receipts, payments, payment links, gateway webhooks." },
    { name: "Billing", description: "Subscription coupons." },
    { name: "Accounting", description: "Chart of accounts, journal vouchers, financial years, budgets, bank reconciliation." },
    { name: "Inventory", description: "Valuation, adjustments, counts, batches, godowns, transfers." },
    { name: "Reports", description: "Exports and derived statements." },
    { name: "Notifications", description: "In-app alerts, reminders and outbound webhooks." },
    { name: "Support", description: "Support tickets." },
    { name: "AI", description: "Optional. Every endpoint degrades to 503 when AI is disabled." },
    { name: "Admin", description: "Platform super-admin. Not part of a tenant's API surface." },
  ],
  components: {
    securitySchemes: {
      sessionCookie: {
        type: "apiKey",
        in: "cookie",
        name: "session",
        description: "Set by POST /api/auth/login. HttpOnly, SameSite, and revocable server-side.",
      },
    },
    schemas,
  },
  security: [{ sessionCookie: [] }],
  paths,
} as const;

export type OpenApiDocument = typeof openApiDocument;

/** Every documented `path -> methods` pair, for the sync test. */
export function documentedOperations(): Map<string, Set<HttpMethod>> {
  const out = new Map<string, Set<HttpMethod>>();
  for (const [path, item] of Object.entries(paths)) {
    const methods = new Set<HttpMethod>();
    for (const method of HTTP_METHODS) {
      if ((item as PathItem)[method]) methods.add(method);
    }
    out.set(path, methods);
  }
  return out;
}
