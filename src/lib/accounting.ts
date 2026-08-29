/**
 * Double-entry accounting engine.
 *
 * WHY THIS EXISTS
 * ---------------
 * The application previously had no ledger at all: no chart of accounts, no
 * journal entries, no trial balance, no profit & loss, no balance sheet. Reports
 * were computed by summing document tables directly. That cannot guarantee the
 * books balance, and it is why the product could not actually replace Tally.
 *
 * THE INVARIANT
 * -------------
 * For every journal entry, the sum of debits must equal the sum of credits.
 * `assertBalanced()` enforces it before anything is written. Because all amounts
 * are integer paise (see ./money), this check is EXACT - which is precisely why
 * the paise migration had to come first. With floating-point amounts a correctly
 * balanced entry could fail its own balance check for reasons that have nothing
 * to do with accounting.
 *
 * SIGN CONVENTION
 * ---------------
 * Debit increases assets and expenses. Credit increases liabilities, income and
 * equity. Every line carries either a debit or a credit, never both.
 *
 * DISCLAIMER: encodes conventional Indian double-entry bookkeeping to make the
 * arithmetic deterministic and auditable. Not accounting advice - have a
 * practising CA review your chart of accounts.
 */

import { addPaise, Paise } from "./money";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** Which financial statement a group's balances belong to. */
export type LedgerNature = "ASSET" | "LIABILITY" | "INCOME" | "EXPENSE" | "EQUITY";

export type VoucherType =
  | "SALES"
  | "PURCHASE"
  | "RECEIPT"
  | "PAYMENT"
  | "JOURNAL"
  | "CONTRA"
  | "CREDIT_NOTE"
  | "DEBIT_NOTE"
  | "EXPENSE"
  | "OPENING";

/** One side of a posting. Exactly one of debit/credit is non-zero. */
export type PostingLine = {
  /** Ledger name. Resolved to an id by the service layer. */
  ledger: string;
  debitPaise?: Paise;
  creditPaise?: Paise;
  narration?: string;
};

export type Posting = {
  voucherType: VoucherType;
  date: Date;
  narration: string;
  sourceType?: string;
  sourceId?: string;
  lines: PostingLine[];
};

// ---------------------------------------------------------------------------
// System chart of accounts
// ---------------------------------------------------------------------------

/**
 * Default Indian chart of accounts, seeded per company.
 *
 * Posting rules below reference these ledgers BY NAME, so they are marked
 * `isSystem` and must not be renamed or deleted. Users can add their own
 * ledgers and groups freely alongside them.
 */
export const SYSTEM_GROUPS: {
  name: string;
  nature: LedgerNature;
  parent?: string;
  sortOrder: number;
}[] = [
  // Assets
  { name: "Current Assets", nature: "ASSET", sortOrder: 10 },
  { name: "Cash-in-Hand", nature: "ASSET", parent: "Current Assets", sortOrder: 11 },
  { name: "Bank Accounts", nature: "ASSET", parent: "Current Assets", sortOrder: 12 },
  { name: "Sundry Debtors", nature: "ASSET", parent: "Current Assets", sortOrder: 13 },
  { name: "Stock-in-Hand", nature: "ASSET", parent: "Current Assets", sortOrder: 14 },
  { name: "Duties & Taxes (Input)", nature: "ASSET", parent: "Current Assets", sortOrder: 15 },
  { name: "Fixed Assets", nature: "ASSET", sortOrder: 20 },

  // Liabilities
  { name: "Current Liabilities", nature: "LIABILITY", sortOrder: 30 },
  { name: "Sundry Creditors", nature: "LIABILITY", parent: "Current Liabilities", sortOrder: 31 },
  { name: "Duties & Taxes", nature: "LIABILITY", parent: "Current Liabilities", sortOrder: 32 },
  { name: "Loans (Liability)", nature: "LIABILITY", sortOrder: 35 },

  // Equity
  { name: "Capital Account", nature: "EQUITY", sortOrder: 40 },
  { name: "Reserves & Surplus", nature: "EQUITY", parent: "Capital Account", sortOrder: 41 },

  // Income
  { name: "Sales Accounts", nature: "INCOME", sortOrder: 50 },
  { name: "Indirect Income", nature: "INCOME", sortOrder: 55 },

  // Expenses
  { name: "Purchase Accounts", nature: "EXPENSE", sortOrder: 60 },
  { name: "Direct Expenses", nature: "EXPENSE", sortOrder: 65 },
  { name: "Indirect Expenses", nature: "EXPENSE", sortOrder: 70 },
];

/** Ledger names referenced by the posting rules. Do not rename. */
export const LEDGER = {
  CASH: "Cash",
  BANK: "Bank Account",
  UPI: "UPI Account",

  SALES: "Sales",
  SALES_EXEMPT: "Sales - Exempt",
  SALES_ZERO_RATED: "Sales - Zero Rated",
  PURCHASES: "Purchases",

  // Output tax is a liability: collected from customers, owed to government.
  OUTPUT_CGST: "Output CGST",
  OUTPUT_SGST: "Output SGST",
  OUTPUT_IGST: "Output IGST",
  OUTPUT_CESS: "Output Cess",

  // Input tax is an asset: paid to suppliers, recoverable as credit.
  INPUT_CGST: "Input CGST",
  INPUT_SGST: "Input SGST",
  INPUT_IGST: "Input IGST",
  INPUT_CESS: "Input Cess",

  ROUND_OFF: "Round Off",
  DISCOUNT_ALLOWED: "Discount Allowed",
  DISCOUNT_RECEIVED: "Discount Received",
  TDS_RECEIVABLE: "TDS Receivable",
  FREIGHT_OUTWARD: "Freight & Delivery Charges",
  OPENING_BALANCE: "Opening Balance Adjustment",
  // Named distinctly from the "Capital Account" GROUP it sits in. Reusing the
  // group's name for a ledger made postings fail to resolve, because the ledger
  // did not exist under that name.
  CAPITAL: "Owner's Capital",
  RETAINED_EARNINGS: "Retained Earnings",
} as const;

export const SYSTEM_LEDGERS: {
  name: string;
  group: string;
  openingIsDebit: boolean;
}[] = [
  { name: LEDGER.CASH, group: "Cash-in-Hand", openingIsDebit: true },
  { name: LEDGER.BANK, group: "Bank Accounts", openingIsDebit: true },
  { name: LEDGER.UPI, group: "Bank Accounts", openingIsDebit: true },

  { name: LEDGER.SALES, group: "Sales Accounts", openingIsDebit: false },
  { name: LEDGER.SALES_EXEMPT, group: "Sales Accounts", openingIsDebit: false },
  { name: LEDGER.SALES_ZERO_RATED, group: "Sales Accounts", openingIsDebit: false },
  { name: LEDGER.PURCHASES, group: "Purchase Accounts", openingIsDebit: true },

  { name: LEDGER.OUTPUT_CGST, group: "Duties & Taxes", openingIsDebit: false },
  { name: LEDGER.OUTPUT_SGST, group: "Duties & Taxes", openingIsDebit: false },
  { name: LEDGER.OUTPUT_IGST, group: "Duties & Taxes", openingIsDebit: false },
  { name: LEDGER.OUTPUT_CESS, group: "Duties & Taxes", openingIsDebit: false },

  { name: LEDGER.INPUT_CGST, group: "Duties & Taxes (Input)", openingIsDebit: true },
  { name: LEDGER.INPUT_SGST, group: "Duties & Taxes (Input)", openingIsDebit: true },
  { name: LEDGER.INPUT_IGST, group: "Duties & Taxes (Input)", openingIsDebit: true },
  { name: LEDGER.INPUT_CESS, group: "Duties & Taxes (Input)", openingIsDebit: true },

  { name: LEDGER.ROUND_OFF, group: "Indirect Expenses", openingIsDebit: true },
  { name: LEDGER.DISCOUNT_ALLOWED, group: "Indirect Expenses", openingIsDebit: true },
  { name: LEDGER.DISCOUNT_RECEIVED, group: "Indirect Income", openingIsDebit: false },
  { name: LEDGER.TDS_RECEIVABLE, group: "Current Assets", openingIsDebit: true },
  { name: LEDGER.FREIGHT_OUTWARD, group: "Indirect Income", openingIsDebit: false },
  { name: LEDGER.OPENING_BALANCE, group: "Capital Account", openingIsDebit: false },
  { name: LEDGER.CAPITAL, group: "Capital Account", openingIsDebit: false },
  { name: LEDGER.RETAINED_EARNINGS, group: "Reserves & Surplus", openingIsDebit: false },
];

/** Payment mode to ledger name. */
export function ledgerForPaymentMode(mode: string): string {
  switch ((mode || "").toUpperCase()) {
    case "BANK":
    case "CHEQUE":
    case "NEFT":
    case "RTGS":
    case "IMPS":
    case "CARD":
      return LEDGER.BANK;
    case "UPI":
      return LEDGER.UPI;
    default:
      return LEDGER.CASH;
  }
}

/** Sales ledger appropriate to the supply type, so GSTR-1 tables can be derived. */
export function salesLedgerForSupplyType(supplyType: string): string {
  switch (supplyType) {
    case "ZERO_RATED":
      return LEDGER.SALES_ZERO_RATED;
    case "EXEMPT":
    case "NIL_RATED":
    case "NON_GST":
      return LEDGER.SALES_EXEMPT;
    default:
      return LEDGER.SALES;
  }
}

// ---------------------------------------------------------------------------
// The invariant
// ---------------------------------------------------------------------------

export class UnbalancedEntryError extends Error {
  constructor(
    public readonly debit: Paise,
    public readonly credit: Paise,
    public readonly posting: Posting
  ) {
    super(
      `Unbalanced journal entry (${posting.voucherType}): ` +
        `debits ${debit} paise != credits ${credit} paise ` +
        `(difference ${debit - credit} paise). Narration: ${posting.narration}`
    );
    this.name = "UnbalancedEntryError";
  }
}

/**
 * Throw unless debits equal credits exactly.
 *
 * Call this before writing any entry. This is the guarantee that makes a trial
 * balance meaningful; without it, an accounting system is just a sum of tables.
 */
export function assertBalanced(posting: Posting): {
  debitPaise: Paise;
  creditPaise: Paise;
} {
  if (!posting.lines.length) {
    throw new UnbalancedEntryError(0, 0, posting);
  }

  let debitPaise = 0;
  let creditPaise = 0;

  for (const line of posting.lines) {
    const d = line.debitPaise ?? 0;
    const c = line.creditPaise ?? 0;

    if (d !== 0 && c !== 0) {
      throw new Error(
        `Journal line for "${line.ledger}" has both a debit (${d}) and a credit (${c}). ` +
          `A line must carry exactly one side.`
      );
    }
    if (!Number.isSafeInteger(d) || !Number.isSafeInteger(c)) {
      throw new TypeError(
        `Journal line for "${line.ledger}" has a non-integer amount. ` +
          `All amounts must be integer paise - use src/lib/money.ts.`
      );
    }
    if (d < 0 || c < 0) {
      throw new Error(
        `Journal line for "${line.ledger}" has a negative amount. ` +
          `Reverse the side instead of using a negative number.`
      );
    }

    debitPaise = addPaise(debitPaise, d);
    creditPaise = addPaise(creditPaise, c);
  }

  if (debitPaise !== creditPaise) {
    throw new UnbalancedEntryError(debitPaise, creditPaise, posting);
  }

  return { debitPaise, creditPaise };
}

/** Drop zero-amount lines, which are noise on a voucher. */
export function pruneEmptyLines(lines: PostingLine[]): PostingLine[] {
  return lines.filter((l) => (l.debitPaise ?? 0) !== 0 || (l.creditPaise ?? 0) !== 0);
}

// ---------------------------------------------------------------------------
// Posting rules
// ---------------------------------------------------------------------------

export type InvoicePostingInput = {
  partyLedger: string;
  date: Date;
  number: string;
  invoiceId: string;
  /** Taxable value, split by supply type so exempt sales post separately. */
  taxableByLedger: Record<string, Paise>;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  cessPaise: Paise;
  additionalChargesPaise: Paise;
  roundOffPaise: Paise;
  grandTotalPaise: Paise;
  tdsPaise: Paise;
  reverseCharge?: boolean;
};

/**
 * Sales invoice.
 *
 *   Dr Customer                  grand total (less TDS)
 *   Dr TDS Receivable            TDS withheld by the customer
 *   Dr Round Off                 when rounding reduced the total
 *     Cr Sales / Sales-Exempt    taxable value, by supply type
 *     Cr Freight & Delivery      additional charges
 *     Cr Output CGST/SGST/IGST   tax collected
 *     Cr Output Cess             cess collected
 *     Cr Round Off               when rounding increased the total
 *
 * TDS is debited to a receivable rather than reducing the customer's balance,
 * because the customer owes the full invoice value; the TDS portion is settled
 * by them depositing it with the government on your behalf.
 */
export function buildInvoicePosting(input: InvoicePostingInput): Posting {
  const lines: PostingLine[] = [];

  // The customer owes the invoice value net of what they will withhold as TDS.
  lines.push({
    ledger: input.partyLedger,
    debitPaise: input.grandTotalPaise - input.tdsPaise,
  });

  if (input.tdsPaise > 0) {
    lines.push({ ledger: LEDGER.TDS_RECEIVABLE, debitPaise: input.tdsPaise });
  }

  for (const [ledger, taxablePaise] of Object.entries(input.taxableByLedger)) {
    if (taxablePaise !== 0) lines.push({ ledger, creditPaise: taxablePaise });
  }

  if (input.additionalChargesPaise > 0) {
    lines.push({
      ledger: LEDGER.FREIGHT_OUTWARD,
      creditPaise: input.additionalChargesPaise,
    });
  }

  // Under reverse charge the supplier collects no tax, so these are all zero.
  lines.push({ ledger: LEDGER.OUTPUT_CGST, creditPaise: input.cgstPaise });
  lines.push({ ledger: LEDGER.OUTPUT_SGST, creditPaise: input.sgstPaise });
  lines.push({ ledger: LEDGER.OUTPUT_IGST, creditPaise: input.igstPaise });
  lines.push({ ledger: LEDGER.OUTPUT_CESS, creditPaise: input.cessPaise });

  // A positive adjustment increased the total, so it is income (credit).
  if (input.roundOffPaise > 0) {
    lines.push({ ledger: LEDGER.ROUND_OFF, creditPaise: input.roundOffPaise });
  } else if (input.roundOffPaise < 0) {
    lines.push({ ledger: LEDGER.ROUND_OFF, debitPaise: -input.roundOffPaise });
  }

  return {
    voucherType: "SALES",
    date: input.date,
    narration: `Sales invoice ${input.number}`,
    sourceType: "Invoice",
    sourceId: input.invoiceId,
    lines: pruneEmptyLines(lines),
  };
}

export type PurchasePostingInput = {
  partyLedger: string;
  date: Date;
  number: string;
  purchaseId: string;
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  cessPaise: Paise;
  additionalChargesPaise: Paise;
  roundOffPaise: Paise;
  grandTotalPaise: Paise;
  /** When false, tax is added to cost instead of claimed as input credit. */
  itcEligible?: boolean;
};

/**
 * Purchase invoice.
 *
 *   Dr Purchases                 taxable value (+ tax when ITC is blocked)
 *   Dr Input CGST/SGST/IGST      recoverable tax, when ITC is eligible
 *   Dr Input Cess
 *     Cr Supplier                grand total
 *
 * When ITC is not eligible (blocked credit under s.17(5), or a composition
 * dealer), the tax is not recoverable and therefore forms part of the cost of
 * the goods. Posting it to Purchases rather than Input Tax is what keeps the
 * ITC ledger honest.
 */
export function buildPurchasePosting(input: PurchasePostingInput): Posting {
  const itcEligible = input.itcEligible ?? true;
  const lines: PostingLine[] = [];

  const taxPaise = addPaise(
    input.cgstPaise,
    input.sgstPaise,
    input.igstPaise,
    input.cessPaise
  );

  lines.push({
    ledger: LEDGER.PURCHASES,
    debitPaise: itcEligible
      ? addPaise(input.taxablePaise, input.additionalChargesPaise)
      : addPaise(input.taxablePaise, input.additionalChargesPaise, taxPaise),
  });

  if (itcEligible) {
    lines.push({ ledger: LEDGER.INPUT_CGST, debitPaise: input.cgstPaise });
    lines.push({ ledger: LEDGER.INPUT_SGST, debitPaise: input.sgstPaise });
    lines.push({ ledger: LEDGER.INPUT_IGST, debitPaise: input.igstPaise });
    lines.push({ ledger: LEDGER.INPUT_CESS, debitPaise: input.cessPaise });
  }

  if (input.roundOffPaise > 0) {
    lines.push({ ledger: LEDGER.ROUND_OFF, debitPaise: input.roundOffPaise });
  } else if (input.roundOffPaise < 0) {
    lines.push({ ledger: LEDGER.ROUND_OFF, creditPaise: -input.roundOffPaise });
  }

  lines.push({ ledger: input.partyLedger, creditPaise: input.grandTotalPaise });

  return {
    voucherType: "PURCHASE",
    date: input.date,
    narration: `Purchase ${input.number}`,
    sourceType: "Purchase",
    sourceId: input.purchaseId,
    lines: pruneEmptyLines(lines),
  };
}

export type PaymentPostingInput = {
  partyLedger: string;
  cashOrBankLedger: string;
  date: Date;
  number: string;
  paymentId: string;
  amountPaise: Paise;
  /** RECEIVED = money in from a customer. PAID = money out to a supplier. */
  type: "RECEIVED" | "PAID";
};

/**
 * Receipt or payment.
 *
 * Received:  Dr Cash/Bank        Cr Customer
 * Paid:      Dr Supplier         Cr Cash/Bank
 */
export function buildPaymentPosting(input: PaymentPostingInput): Posting {
  const received = input.type === "RECEIVED";

  const lines: PostingLine[] = received
    ? [
        { ledger: input.cashOrBankLedger, debitPaise: input.amountPaise },
        { ledger: input.partyLedger, creditPaise: input.amountPaise },
      ]
    : [
        { ledger: input.partyLedger, debitPaise: input.amountPaise },
        { ledger: input.cashOrBankLedger, creditPaise: input.amountPaise },
      ];

  return {
    voucherType: received ? "RECEIPT" : "PAYMENT",
    date: input.date,
    narration: `${received ? "Receipt" : "Payment"} ${input.number}`,
    sourceType: "Payment",
    sourceId: input.paymentId,
    lines: pruneEmptyLines(lines),
  };
}

export type ExpensePostingInput = {
  expenseLedger: string;
  cashOrBankLedger: string;
  date: Date;
  number: string;
  expenseId: string;
  amountPaise: Paise;
  taxPaise: Paise;
  totalPaise: Paise;
  isInterState?: boolean;
  itcEligible?: boolean;
};

/**
 * Expense.
 *
 *   Dr Expense head              net amount (+ tax when ITC is blocked)
 *   Dr Input CGST/SGST or IGST   when ITC is eligible
 *     Cr Cash/Bank               total paid
 *
 * Most small-business expenses (staff welfare, motor vehicles, food) have
 * blocked credit, which is why `itcEligible` defaults to false here - the safer
 * default is to treat tax as cost rather than over-claim credit.
 */
export function buildExpensePosting(input: ExpensePostingInput): Posting {
  const itcEligible = input.itcEligible ?? false;
  const lines: PostingLine[] = [];

  lines.push({
    ledger: input.expenseLedger,
    debitPaise: itcEligible ? input.amountPaise : addPaise(input.amountPaise, input.taxPaise),
  });

  if (itcEligible && input.taxPaise > 0) {
    if (input.isInterState) {
      lines.push({ ledger: LEDGER.INPUT_IGST, debitPaise: input.taxPaise });
    } else {
      // Halve the tax while preserving the total exactly.
      const cgst = Math.ceil(input.taxPaise / 2);
      const sgst = input.taxPaise - cgst;
      lines.push({ ledger: LEDGER.INPUT_CGST, debitPaise: cgst });
      lines.push({ ledger: LEDGER.INPUT_SGST, debitPaise: sgst });
    }
  }

  lines.push({ ledger: input.cashOrBankLedger, creditPaise: input.totalPaise });

  return {
    voucherType: "EXPENSE",
    date: input.date,
    narration: `Expense ${input.number} - ${input.expenseLedger}`,
    sourceType: "Expense",
    sourceId: input.expenseId,
    lines: pruneEmptyLines(lines),
  };
}

export type CreditNotePostingInput = {
  partyLedger: string;
  date: Date;
  number: string;
  creditNoteId: string;
  /** CREDIT = sales return (reverses a sale). DEBIT = purchase return. */
  kind: "CREDIT" | "DEBIT";
  taxablePaise: Paise;
  cgstPaise: Paise;
  sgstPaise: Paise;
  igstPaise: Paise;
  cessPaise: Paise;
  roundOffPaise: Paise;
  grandTotalPaise: Paise;
};

/**
 * Credit note (sales return) or debit note (purchase return).
 *
 * A credit note reverses a sale, so every side of the sales posting flips:
 *
 *   Dr Sales                     taxable value returned
 *   Dr Output CGST/SGST/IGST     tax reversed, reducing the liability
 *     Cr Customer                amount credited back
 *
 * The mirror applies to a debit note against a supplier.
 */
export function buildCreditNotePosting(input: CreditNotePostingInput): Posting {
  const lines: PostingLine[] = [];
  const isSalesReturn = input.kind === "CREDIT";

  if (isSalesReturn) {
    lines.push({ ledger: LEDGER.SALES, debitPaise: input.taxablePaise });
    lines.push({ ledger: LEDGER.OUTPUT_CGST, debitPaise: input.cgstPaise });
    lines.push({ ledger: LEDGER.OUTPUT_SGST, debitPaise: input.sgstPaise });
    lines.push({ ledger: LEDGER.OUTPUT_IGST, debitPaise: input.igstPaise });
    lines.push({ ledger: LEDGER.OUTPUT_CESS, debitPaise: input.cessPaise });
    if (input.roundOffPaise > 0) {
      lines.push({ ledger: LEDGER.ROUND_OFF, debitPaise: input.roundOffPaise });
    } else if (input.roundOffPaise < 0) {
      lines.push({ ledger: LEDGER.ROUND_OFF, creditPaise: -input.roundOffPaise });
    }
    lines.push({ ledger: input.partyLedger, creditPaise: input.grandTotalPaise });
  } else {
    lines.push({ ledger: input.partyLedger, debitPaise: input.grandTotalPaise });
    lines.push({ ledger: LEDGER.PURCHASES, creditPaise: input.taxablePaise });
    lines.push({ ledger: LEDGER.INPUT_CGST, creditPaise: input.cgstPaise });
    lines.push({ ledger: LEDGER.INPUT_SGST, creditPaise: input.sgstPaise });
    lines.push({ ledger: LEDGER.INPUT_IGST, creditPaise: input.igstPaise });
    lines.push({ ledger: LEDGER.INPUT_CESS, creditPaise: input.cessPaise });
    if (input.roundOffPaise > 0) {
      lines.push({ ledger: LEDGER.ROUND_OFF, creditPaise: input.roundOffPaise });
    } else if (input.roundOffPaise < 0) {
      lines.push({ ledger: LEDGER.ROUND_OFF, debitPaise: -input.roundOffPaise });
    }
  }

  return {
    voucherType: isSalesReturn ? "CREDIT_NOTE" : "DEBIT_NOTE",
    date: input.date,
    narration: `${isSalesReturn ? "Credit" : "Debit"} note ${input.number}`,
    sourceType: "CreditNote",
    sourceId: input.creditNoteId,
    lines: pruneEmptyLines(lines),
  };
}

// ---------------------------------------------------------------------------
// Reporting
// ---------------------------------------------------------------------------

export type LedgerBalance = {
  ledgerId: string;
  ledgerName: string;
  groupName: string;
  nature: LedgerNature;
  debitPaise: Paise;
  creditPaise: Paise;
  /** Positive = net debit, negative = net credit. */
  closingPaise: Paise;
};

/**
 * Net a ledger's movements into a closing balance.
 *
 * Returns a signed value where positive means a net debit. Assets and expenses
 * normally carry a debit balance; liabilities, income and equity a credit one.
 */
export function computeClosing(
  openingPaise: Paise,
  openingIsDebit: boolean,
  debitPaise: Paise,
  creditPaise: Paise
): Paise {
  const opening = openingIsDebit ? openingPaise : -openingPaise;
  return opening + debitPaise - creditPaise;
}

/** True when the trial balance sums to zero, i.e. the books balance. */
export function isTrialBalanced(balances: LedgerBalance[]): boolean {
  return balances.reduce((sum, b) => sum + b.closingPaise, 0) === 0;
}

export type ProfitAndLoss = {
  incomePaise: Paise;
  expensePaise: Paise;
  /** Positive = profit, negative = loss. */
  netProfitPaise: Paise;
  incomeLines: { name: string; amountPaise: Paise }[];
  expenseLines: { name: string; amountPaise: Paise }[];
};

/**
 * Profit & loss from ledger balances.
 *
 * Income normally carries a credit balance, so its closing value is negative
 * under this sign convention; flip it so the statement reads naturally.
 */
export function buildProfitAndLoss(balances: LedgerBalance[]): ProfitAndLoss {
  const incomeLines: { name: string; amountPaise: Paise }[] = [];
  const expenseLines: { name: string; amountPaise: Paise }[] = [];
  let incomePaise = 0;
  let expensePaise = 0;

  for (const b of balances) {
    if (b.nature === "INCOME") {
      const amount = -b.closingPaise;
      if (amount !== 0) incomeLines.push({ name: b.ledgerName, amountPaise: amount });
      incomePaise += amount;
    } else if (b.nature === "EXPENSE") {
      const amount = b.closingPaise;
      if (amount !== 0) expenseLines.push({ name: b.ledgerName, amountPaise: amount });
      expensePaise += amount;
    }
  }

  incomeLines.sort((a, b) => b.amountPaise - a.amountPaise);
  expenseLines.sort((a, b) => b.amountPaise - a.amountPaise);

  return {
    incomePaise,
    expensePaise,
    netProfitPaise: incomePaise - expensePaise,
    incomeLines,
    expenseLines,
  };
}

export type BalanceSheet = {
  assetsPaise: Paise;
  liabilitiesPaise: Paise;
  equityPaise: Paise;
  /** Current-period profit, carried into the balance sheet. */
  netProfitPaise: Paise;
  assetLines: { name: string; amountPaise: Paise }[];
  liabilityLines: { name: string; amountPaise: Paise }[];
  equityLines: { name: string; amountPaise: Paise }[];
  /** assets - (liabilities + equity + profit). Zero when the books balance. */
  differencePaise: Paise;
};

/**
 * Balance sheet from ledger balances.
 *
 * Current-period profit is added to the equity side rather than being left in
 * the income and expense ledgers, which is what makes the sheet balance before
 * year-end closing has been run.
 */
export function buildBalanceSheet(balances: LedgerBalance[]): BalanceSheet {
  const assetLines: { name: string; amountPaise: Paise }[] = [];
  const liabilityLines: { name: string; amountPaise: Paise }[] = [];
  const equityLines: { name: string; amountPaise: Paise }[] = [];
  let assetsPaise = 0;
  let liabilitiesPaise = 0;
  let equityPaise = 0;

  for (const b of balances) {
    if (b.nature === "ASSET") {
      const amount = b.closingPaise;
      if (amount !== 0) assetLines.push({ name: b.ledgerName, amountPaise: amount });
      assetsPaise += amount;
    } else if (b.nature === "LIABILITY") {
      const amount = -b.closingPaise;
      if (amount !== 0) liabilityLines.push({ name: b.ledgerName, amountPaise: amount });
      liabilitiesPaise += amount;
    } else if (b.nature === "EQUITY") {
      const amount = -b.closingPaise;
      if (amount !== 0) equityLines.push({ name: b.ledgerName, amountPaise: amount });
      equityPaise += amount;
    }
  }

  const { netProfitPaise } = buildProfitAndLoss(balances);

  assetLines.sort((a, b) => b.amountPaise - a.amountPaise);
  liabilityLines.sort((a, b) => b.amountPaise - a.amountPaise);
  equityLines.sort((a, b) => b.amountPaise - a.amountPaise);

  return {
    assetsPaise,
    liabilitiesPaise,
    equityPaise,
    netProfitPaise,
    assetLines,
    liabilityLines,
    equityLines,
    differencePaise: assetsPaise - (liabilitiesPaise + equityPaise + netProfitPaise),
  };
}
