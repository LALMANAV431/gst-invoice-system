import { describe, expect, it } from "vitest";
import { toPaise } from "./money";
import { computeGstInvoice } from "./gst";
import {
  assertBalanced,
  buildBalanceSheet,
  buildCreditNotePosting,
  buildExpensePosting,
  buildInvoicePosting,
  buildPaymentPosting,
  buildProfitAndLoss,
  buildPurchasePosting,
  computeClosing,
  isTrialBalanced,
  LEDGER,
  LedgerBalance,
  ledgerForPaymentMode,
  Posting,
  salesLedgerForSupplyType,
  SYSTEM_GROUPS,
  SYSTEM_LEDGERS,
  UnbalancedEntryError,
} from "./accounting";

/** Sum one side of a posting, for assertions. */
function totals(p: Posting) {
  return p.lines.reduce(
    (acc, l) => ({
      debit: acc.debit + (l.debitPaise ?? 0),
      credit: acc.credit + (l.creditPaise ?? 0),
    }),
    { debit: 0, credit: 0 }
  );
}

describe("assertBalanced", () => {
  it("accepts a balanced entry", () => {
    const posting: Posting = {
      voucherType: "JOURNAL",
      date: new Date(),
      narration: "test",
      lines: [
        { ledger: "Cash", debitPaise: 100000 },
        { ledger: "Sales", creditPaise: 100000 },
      ],
    };
    expect(assertBalanced(posting)).toEqual({ debitPaise: 100000, creditPaise: 100000 });
  });

  it("rejects an unbalanced entry", () => {
    const posting: Posting = {
      voucherType: "JOURNAL",
      date: new Date(),
      narration: "bad",
      lines: [
        { ledger: "Cash", debitPaise: 100000 },
        { ledger: "Sales", creditPaise: 99999 },
      ],
    };
    expect(() => assertBalanced(posting)).toThrow(UnbalancedEntryError);
  });

  it("reports the exact difference, so the bug is findable", () => {
    const posting: Posting = {
      voucherType: "JOURNAL",
      date: new Date(),
      narration: "off by one paisa",
      lines: [
        { ledger: "Cash", debitPaise: 100000 },
        { ledger: "Sales", creditPaise: 99999 },
      ],
    };
    try {
      assertBalanced(posting);
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(UnbalancedEntryError);
      expect((e as UnbalancedEntryError).message).toContain("difference 1 paise");
    }
  });

  it("rejects a line carrying both a debit and a credit", () => {
    expect(() =>
      assertBalanced({
        voucherType: "JOURNAL",
        date: new Date(),
        narration: "x",
        lines: [{ ledger: "Cash", debitPaise: 100, creditPaise: 100 }],
      })
    ).toThrow(/exactly one side/);
  });

  it("rejects non-integer amounts, blocking float leakage", () => {
    expect(() =>
      assertBalanced({
        voucherType: "JOURNAL",
        date: new Date(),
        narration: "x",
        lines: [
          { ledger: "Cash", debitPaise: 100.5 },
          { ledger: "Sales", creditPaise: 100.5 },
        ],
      })
    ).toThrow(TypeError);
  });

  it("rejects negative amounts", () => {
    expect(() =>
      assertBalanced({
        voucherType: "JOURNAL",
        date: new Date(),
        narration: "x",
        lines: [
          { ledger: "Cash", debitPaise: -100 },
          { ledger: "Sales", creditPaise: -100 },
        ],
      })
    ).toThrow(/negative/);
  });

  it("rejects an empty entry", () => {
    expect(() =>
      assertBalanced({
        voucherType: "JOURNAL",
        date: new Date(),
        narration: "x",
        lines: [],
      })
    ).toThrow(UnbalancedEntryError);
  });
});

describe("chart of accounts", () => {
  it("gives every group a valid nature", () => {
    const valid = new Set(["ASSET", "LIABILITY", "INCOME", "EXPENSE", "EQUITY"]);
    for (const g of SYSTEM_GROUPS) expect(valid.has(g.nature), g.name).toBe(true);
  });

  it("resolves every group parent to a real group", () => {
    const names = new Set(SYSTEM_GROUPS.map((g) => g.name));
    for (const g of SYSTEM_GROUPS) {
      if (g.parent) expect(names.has(g.parent), `${g.name} -> ${g.parent}`).toBe(true);
    }
  });

  it("places every system ledger in a real group", () => {
    const names = new Set(SYSTEM_GROUPS.map((g) => g.name));
    for (const l of SYSTEM_LEDGERS) {
      expect(names.has(l.group), `${l.name} -> ${l.group}`).toBe(true);
    }
  });

  it("has no duplicate group or ledger names", () => {
    expect(new Set(SYSTEM_GROUPS.map((g) => g.name)).size).toBe(SYSTEM_GROUPS.length);
    expect(new Set(SYSTEM_LEDGERS.map((l) => l.name)).size).toBe(SYSTEM_LEDGERS.length);
  });

  it("defines a ledger for every name the posting rules reference", () => {
    // This caught a real bug: LEDGER.CAPITAL pointed at "Capital Account",
    // which is a GROUP name with no matching ledger, so opening-capital
    // postings failed to resolve. No exemptions - every referenced name must
    // exist as a ledger.
    const defined = new Set(SYSTEM_LEDGERS.map((l) => l.name));
    for (const name of Object.values(LEDGER)) {
      expect(defined.has(name), `LEDGER reference "${name}" has no system ledger`).toBe(true);
    }
  });

  it("does not reuse a group name for a ledger", () => {
    const groupNames = new Set(SYSTEM_GROUPS.map((g) => g.name));
    for (const l of SYSTEM_LEDGERS) {
      expect(groupNames.has(l.name), `ledger "${l.name}" collides with a group name`).toBe(false);
    }
  });

  it("maps payment modes to the right ledger", () => {
    expect(ledgerForPaymentMode("CASH")).toBe(LEDGER.CASH);
    expect(ledgerForPaymentMode("BANK")).toBe(LEDGER.BANK);
    expect(ledgerForPaymentMode("CHEQUE")).toBe(LEDGER.BANK);
    expect(ledgerForPaymentMode("CARD")).toBe(LEDGER.BANK);
    expect(ledgerForPaymentMode("UPI")).toBe(LEDGER.UPI);
    expect(ledgerForPaymentMode("")).toBe(LEDGER.CASH);
    expect(ledgerForPaymentMode("anything-else")).toBe(LEDGER.CASH);
  });

  it("routes sales to a ledger matching the supply type", () => {
    expect(salesLedgerForSupplyType("TAXABLE")).toBe(LEDGER.SALES);
    expect(salesLedgerForSupplyType("ZERO_RATED")).toBe(LEDGER.SALES_ZERO_RATED);
    expect(salesLedgerForSupplyType("EXEMPT")).toBe(LEDGER.SALES_EXEMPT);
    expect(salesLedgerForSupplyType("NIL_RATED")).toBe(LEDGER.SALES_EXEMPT);
    expect(salesLedgerForSupplyType("NON_GST")).toBe(LEDGER.SALES_EXEMPT);
  });
});

describe("sales invoice posting", () => {
  it("balances a simple intra-state invoice", () => {
    const posting = buildInvoicePosting({
      partyLedger: "Sharma Electronics",
      date: new Date("2026-08-29"),
      number: "INV-0001",
      invoiceId: "inv1",
      taxableByLedger: { [LEDGER.SALES]: 1000000 },
      cgstPaise: 90000,
      sgstPaise: 90000,
      igstPaise: 0,
      cessPaise: 0,
      additionalChargesPaise: 0,
      roundOffPaise: 0,
      grandTotalPaise: 1180000,
      tdsPaise: 0,
    });

    const { debit, credit } = totals(posting);
    expect(debit).toBe(1180000);
    expect(credit).toBe(1180000);
    expect(assertBalanced(posting)).toBeTruthy();

    // The customer is debited the full invoice value.
    const party = posting.lines.find((l) => l.ledger === "Sharma Electronics");
    expect(party?.debitPaise).toBe(1180000);
  });

  it("debits TDS to a receivable and not against the customer", () => {
    const posting = buildInvoicePosting({
      partyLedger: "Acme Ltd",
      date: new Date(),
      number: "INV-0002",
      invoiceId: "inv2",
      taxableByLedger: { [LEDGER.SALES]: 1000000 },
      cgstPaise: 90000,
      sgstPaise: 90000,
      igstPaise: 0,
      cessPaise: 0,
      additionalChargesPaise: 0,
      roundOffPaise: 0,
      grandTotalPaise: 1180000,
      tdsPaise: 100000,
    });

    expect(assertBalanced(posting)).toBeTruthy();
    const party = posting.lines.find((l) => l.ledger === "Acme Ltd");
    const tds = posting.lines.find((l) => l.ledger === LEDGER.TDS_RECEIVABLE);
    expect(party?.debitPaise).toBe(1080000);
    expect(tds?.debitPaise).toBe(100000);
    // Together they still account for the full invoice value.
    expect((party?.debitPaise ?? 0) + (tds?.debitPaise ?? 0)).toBe(1180000);
  });

  it("balances with a negative round-off", () => {
    const posting = buildInvoicePosting({
      partyLedger: "Cash Customer",
      date: new Date(),
      number: "INV-0003",
      invoiceId: "inv3",
      taxableByLedger: { [LEDGER.SALES]: 10505 },
      cgstPaise: 263,
      sgstPaise: 262,
      igstPaise: 0,
      cessPaise: 0,
      additionalChargesPaise: 0,
      roundOffPaise: -30,
      grandTotalPaise: 11000,
    tdsPaise: 0,
    });
    expect(assertBalanced(posting)).toBeTruthy();
    const roundOff = posting.lines.find((l) => l.ledger === LEDGER.ROUND_OFF);
    expect(roundOff?.debitPaise).toBe(30);
  });

  it("splits taxable value across sales ledgers by supply type", () => {
    const posting = buildInvoicePosting({
      partyLedger: "Exporter",
      date: new Date(),
      number: "INV-0004",
      invoiceId: "inv4",
      taxableByLedger: {
        [LEDGER.SALES]: 500000,
        [LEDGER.SALES_ZERO_RATED]: 300000,
        [LEDGER.SALES_EXEMPT]: 200000,
      },
      cgstPaise: 45000,
      sgstPaise: 45000,
      igstPaise: 0,
      cessPaise: 0,
      additionalChargesPaise: 0,
      roundOffPaise: 0,
      grandTotalPaise: 1090000,
      tdsPaise: 0,
    });
    expect(assertBalanced(posting)).toBeTruthy();
    expect(posting.lines.find((l) => l.ledger === LEDGER.SALES_ZERO_RATED)?.creditPaise).toBe(
      300000
    );
    expect(posting.lines.find((l) => l.ledger === LEDGER.SALES_EXEMPT)?.creditPaise).toBe(200000);
  });

  it("omits zero-value lines", () => {
    const posting = buildInvoicePosting({
      partyLedger: "P",
      date: new Date(),
      number: "INV-0005",
      invoiceId: "inv5",
      taxableByLedger: { [LEDGER.SALES]: 100000 },
      cgstPaise: 9000,
      sgstPaise: 9000,
      igstPaise: 0,
      cessPaise: 0,
      additionalChargesPaise: 0,
      roundOffPaise: 0,
      grandTotalPaise: 118000,
      tdsPaise: 0,
    });
    expect(posting.lines.some((l) => l.ledger === LEDGER.OUTPUT_IGST)).toBe(false);
    expect(posting.lines.some((l) => l.ledger === LEDGER.OUTPUT_CESS)).toBe(false);
  });
});

describe("purchase posting", () => {
  it("claims input credit when eligible", () => {
    const posting = buildPurchasePosting({
      partyLedger: "Reliable Suppliers",
      date: new Date(),
      number: "PUR-0001",
      purchaseId: "p1",
      taxablePaise: 1000000,
      cgstPaise: 90000,
      sgstPaise: 90000,
      igstPaise: 0,
      cessPaise: 0,
      additionalChargesPaise: 0,
      roundOffPaise: 0,
      grandTotalPaise: 1180000,
      itcEligible: true,
    });
    expect(assertBalanced(posting)).toBeTruthy();
    expect(posting.lines.find((l) => l.ledger === LEDGER.PURCHASES)?.debitPaise).toBe(1000000);
    expect(posting.lines.find((l) => l.ledger === LEDGER.INPUT_CGST)?.debitPaise).toBe(90000);
  });

  it("adds tax to cost when input credit is blocked", () => {
    const posting = buildPurchasePosting({
      partyLedger: "Reliable Suppliers",
      date: new Date(),
      number: "PUR-0002",
      purchaseId: "p2",
      taxablePaise: 1000000,
      cgstPaise: 90000,
      sgstPaise: 90000,
      igstPaise: 0,
      cessPaise: 0,
      additionalChargesPaise: 0,
      roundOffPaise: 0,
      grandTotalPaise: 1180000,
      itcEligible: false,
    });
    expect(assertBalanced(posting)).toBeTruthy();
    // Tax becomes part of the cost of goods.
    expect(posting.lines.find((l) => l.ledger === LEDGER.PURCHASES)?.debitPaise).toBe(1180000);
    expect(posting.lines.some((l) => l.ledger === LEDGER.INPUT_CGST)).toBe(false);
  });
});

describe("payment posting", () => {
  it("posts a receipt as Dr Bank / Cr Customer", () => {
    const posting = buildPaymentPosting({
      partyLedger: "Sharma Electronics",
      cashOrBankLedger: LEDGER.BANK,
      date: new Date(),
      number: "PMT-0001",
      paymentId: "pay1",
      amountPaise: 500000,
      type: "RECEIVED",
    });
    expect(assertBalanced(posting)).toBeTruthy();
    expect(posting.voucherType).toBe("RECEIPT");
    expect(posting.lines.find((l) => l.ledger === LEDGER.BANK)?.debitPaise).toBe(500000);
    expect(posting.lines.find((l) => l.ledger === "Sharma Electronics")?.creditPaise).toBe(500000);
  });

  it("posts a payment as Dr Supplier / Cr Bank", () => {
    const posting = buildPaymentPosting({
      partyLedger: "Reliable Suppliers",
      cashOrBankLedger: LEDGER.CASH,
      date: new Date(),
      number: "PMT-0002",
      paymentId: "pay2",
      amountPaise: 250000,
      type: "PAID",
    });
    expect(assertBalanced(posting)).toBeTruthy();
    expect(posting.voucherType).toBe("PAYMENT");
    expect(posting.lines.find((l) => l.ledger === "Reliable Suppliers")?.debitPaise).toBe(250000);
    expect(posting.lines.find((l) => l.ledger === LEDGER.CASH)?.creditPaise).toBe(250000);
  });
});

describe("expense posting", () => {
  it("treats tax as cost when credit is blocked (the default)", () => {
    const posting = buildExpensePosting({
      expenseLedger: "Office Rent",
      cashOrBankLedger: LEDGER.BANK,
      date: new Date(),
      number: "EXP-0001",
      expenseId: "e1",
      amountPaise: 1000000,
      taxPaise: 180000,
      totalPaise: 1180000,
    });
    expect(assertBalanced(posting)).toBeTruthy();
    expect(posting.lines.find((l) => l.ledger === "Office Rent")?.debitPaise).toBe(1180000);
  });

  it("splits input tax without losing a paisa on an odd amount", () => {
    const posting = buildExpensePosting({
      expenseLedger: "Internet",
      cashOrBankLedger: LEDGER.BANK,
      date: new Date(),
      number: "EXP-0002",
      expenseId: "e2",
      amountPaise: 10000,
      taxPaise: 1801, // odd number of paise
      totalPaise: 11801,
      itcEligible: true,
    });
    expect(assertBalanced(posting)).toBeTruthy();
    const cgst = posting.lines.find((l) => l.ledger === LEDGER.INPUT_CGST)?.debitPaise ?? 0;
    const sgst = posting.lines.find((l) => l.ledger === LEDGER.INPUT_SGST)?.debitPaise ?? 0;
    expect(cgst + sgst).toBe(1801);
  });

  it("uses IGST for an inter-state expense", () => {
    const posting = buildExpensePosting({
      expenseLedger: "Consulting",
      cashOrBankLedger: LEDGER.BANK,
      date: new Date(),
      number: "EXP-0003",
      expenseId: "e3",
      amountPaise: 100000,
      taxPaise: 18000,
      totalPaise: 118000,
      itcEligible: true,
      isInterState: true,
    });
    expect(assertBalanced(posting)).toBeTruthy();
    expect(posting.lines.find((l) => l.ledger === LEDGER.INPUT_IGST)?.debitPaise).toBe(18000);
  });
});

describe("credit and debit note posting", () => {
  it("reverses a sale", () => {
    const posting = buildCreditNotePosting({
      partyLedger: "Sharma Electronics",
      date: new Date(),
      number: "CN-0001",
      creditNoteId: "cn1",
      kind: "CREDIT",
      taxablePaise: 100000,
      cgstPaise: 9000,
      sgstPaise: 9000,
      igstPaise: 0,
      cessPaise: 0,
      roundOffPaise: 0,
      grandTotalPaise: 118000,
    });
    expect(assertBalanced(posting)).toBeTruthy();
    expect(posting.voucherType).toBe("CREDIT_NOTE");
    // Sales is debited, reversing the original credit.
    expect(posting.lines.find((l) => l.ledger === LEDGER.SALES)?.debitPaise).toBe(100000);
    // Output tax liability is reduced.
    expect(posting.lines.find((l) => l.ledger === LEDGER.OUTPUT_CGST)?.debitPaise).toBe(9000);
    expect(posting.lines.find((l) => l.ledger === "Sharma Electronics")?.creditPaise).toBe(118000);
  });

  it("reverses a purchase", () => {
    const posting = buildCreditNotePosting({
      partyLedger: "Reliable Suppliers",
      date: new Date(),
      number: "DN-0001",
      creditNoteId: "dn1",
      kind: "DEBIT",
      taxablePaise: 100000,
      cgstPaise: 9000,
      sgstPaise: 9000,
      igstPaise: 0,
      cessPaise: 0,
      roundOffPaise: 0,
      grandTotalPaise: 118000,
    });
    expect(assertBalanced(posting)).toBeTruthy();
    expect(posting.voucherType).toBe("DEBIT_NOTE");
    expect(posting.lines.find((l) => l.ledger === "Reliable Suppliers")?.debitPaise).toBe(118000);
    expect(posting.lines.find((l) => l.ledger === LEDGER.INPUT_CGST)?.creditPaise).toBe(9000);
  });

  it("a credit note exactly reverses the invoice it cancels", () => {
    const shared = {
      taxablePaise: 100000,
      cgstPaise: 9000,
      sgstPaise: 9000,
      igstPaise: 0,
      cessPaise: 0,
      roundOffPaise: 0,
      grandTotalPaise: 118000,
    };
    const invoice = buildInvoicePosting({
      partyLedger: "P",
      date: new Date(),
      number: "INV-1",
      invoiceId: "i",
      taxableByLedger: { [LEDGER.SALES]: shared.taxablePaise },
      additionalChargesPaise: 0,
      tdsPaise: 0,
      ...shared,
    });
    const note = buildCreditNotePosting({
      partyLedger: "P",
      date: new Date(),
      number: "CN-1",
      creditNoteId: "c",
      kind: "CREDIT",
      ...shared,
    });

    // Net effect on every ledger must be zero.
    const net = new Map<string, number>();
    for (const l of [...invoice.lines, ...note.lines]) {
      const delta = (l.debitPaise ?? 0) - (l.creditPaise ?? 0);
      net.set(l.ledger, (net.get(l.ledger) ?? 0) + delta);
    }
    for (const [ledger, amount] of net) {
      expect(amount, `${ledger} should net to zero`).toBe(0);
    }
  });
});

describe("GST engine feeds the ledger consistently", () => {
  it("an invoice computed by computeGstInvoice produces a balanced posting", () => {
    const gst = computeGstInvoice({
      supplierStateCode: "29",
      placeOfSupplyStateCode: "29",
      lines: [
        { quantity: 3, rate: 33.33, gstRate: 18 },
        { quantity: 1, rate: 105.05, gstRate: 5 },
        { quantity: 2, rate: 500, gstRate: 28, cessRate: 12 },
      ],
      invoiceDiscount: 50,
      additionalCharges: 75.25,
      tdsRate: 2,
    });

    const posting = buildInvoicePosting({
      partyLedger: "Test Party",
      date: new Date(),
      number: "INV-X",
      invoiceId: "x",
      taxableByLedger: {
        [LEDGER.SALES]: gst.taxablePaise - gst.additionalChargesPaise,
      },
      cgstPaise: gst.cgstPaise,
      sgstPaise: gst.sgstPaise,
      igstPaise: gst.igstPaise,
      cessPaise: gst.cessPaise,
      additionalChargesPaise: gst.additionalChargesPaise,
      roundOffPaise: gst.roundOffPaise,
      grandTotalPaise: gst.grandTotalPaise,
      tdsPaise: gst.tdsPaise,
    });

    // This is the end-to-end guarantee: GST arithmetic and the ledger agree.
    expect(assertBalanced(posting)).toBeTruthy();
  });

  it("holds across many rate and state combinations", () => {
    const scenarios = [
      { lines: [{ quantity: 1, rate: 999.99, gstRate: 18 }] },
      { lines: [{ quantity: 7, rate: 12.5, gstRate: 5 }], invoiceDiscount: 3.33 },
      {
        lines: [{ quantity: 1, rate: 1234.56, gstRate: 28, cessRate: 22 }],
        additionalCharges: 99.99,
      },
      {
        lines: [
          { quantity: 2, rate: 250, gstRate: 12 },
          { quantity: 1, rate: 100, gstRate: 0, supplyType: "EXEMPT" as const },
        ],
      },
    ];

    for (const [i, scenario] of scenarios.entries()) {
      for (const pos of ["29", "27"]) {
        const gst = computeGstInvoice({
          supplierStateCode: "29",
          placeOfSupplyStateCode: pos,
          ...scenario,
        });

        const taxableByLedger: Record<string, number> = {};
        for (const line of gst.lines) {
          const ledger = salesLedgerForSupplyType(line.supplyType);
          taxableByLedger[ledger] = (taxableByLedger[ledger] ?? 0) + line.taxablePaise;
        }

        const posting = buildInvoicePosting({
          partyLedger: "P",
          date: new Date(),
          number: `INV-${i}-${pos}`,
          invoiceId: `${i}-${pos}`,
          taxableByLedger,
          cgstPaise: gst.cgstPaise,
          sgstPaise: gst.sgstPaise,
          igstPaise: gst.igstPaise,
          cessPaise: gst.cessPaise,
          additionalChargesPaise: gst.additionalChargesPaise,
          roundOffPaise: gst.roundOffPaise,
          grandTotalPaise: gst.grandTotalPaise,
          tdsPaise: gst.tdsPaise,
        });

        expect(() => assertBalanced(posting), `scenario ${i} pos ${pos}`).not.toThrow();
      }
    }
  });
});

describe("closing balances", () => {
  it("nets debits and credits against a debit opening", () => {
    expect(computeClosing(100000, true, 50000, 20000)).toBe(130000);
  });

  it("nets against a credit opening", () => {
    expect(computeClosing(100000, false, 20000, 50000)).toBe(-130000);
  });
});

describe("trial balance", () => {
  const balances: LedgerBalance[] = [
    {
      ledgerId: "1",
      ledgerName: "Cash",
      groupName: "Cash-in-Hand",
      nature: "ASSET",
      debitPaise: 1180000,
      creditPaise: 0,
      closingPaise: 1180000,
    },
    {
      ledgerId: "2",
      ledgerName: "Sales",
      groupName: "Sales Accounts",
      nature: "INCOME",
      debitPaise: 0,
      creditPaise: 1000000,
      closingPaise: -1000000,
    },
    {
      ledgerId: "3",
      ledgerName: "Output CGST",
      groupName: "Duties & Taxes",
      nature: "LIABILITY",
      debitPaise: 0,
      creditPaise: 90000,
      closingPaise: -90000,
    },
    {
      ledgerId: "4",
      ledgerName: "Output SGST",
      groupName: "Duties & Taxes",
      nature: "LIABILITY",
      debitPaise: 0,
      creditPaise: 90000,
      closingPaise: -90000,
    },
  ];

  it("sums to zero when the books balance", () => {
    expect(isTrialBalanced(balances)).toBe(true);
  });

  it("detects an imbalance", () => {
    const broken = [
      ...balances,
      {
        ledgerId: "5",
        ledgerName: "Suspense",
        groupName: "Current Assets",
        nature: "ASSET" as const,
        debitPaise: 1,
        creditPaise: 0,
        closingPaise: 1,
      },
    ];
    expect(isTrialBalanced(broken)).toBe(false);
  });
});

describe("profit & loss", () => {
  const balances: LedgerBalance[] = [
    {
      ledgerId: "1",
      ledgerName: "Sales",
      groupName: "Sales Accounts",
      nature: "INCOME",
      debitPaise: 0,
      creditPaise: 5000000,
      closingPaise: -5000000,
    },
    {
      ledgerId: "2",
      ledgerName: "Purchases",
      groupName: "Purchase Accounts",
      nature: "EXPENSE",
      debitPaise: 3000000,
      creditPaise: 0,
      closingPaise: 3000000,
    },
    {
      ledgerId: "3",
      ledgerName: "Office Rent",
      groupName: "Indirect Expenses",
      nature: "EXPENSE",
      debitPaise: 500000,
      creditPaise: 0,
      closingPaise: 500000,
    },
    {
      ledgerId: "4",
      ledgerName: "Cash",
      groupName: "Cash-in-Hand",
      nature: "ASSET",
      debitPaise: 1500000,
      creditPaise: 0,
      closingPaise: 1500000,
    },
  ];

  it("reports income, expense and profit, ignoring balance-sheet ledgers", () => {
    const pl = buildProfitAndLoss(balances);
    expect(pl.incomePaise).toBe(5000000); // Rs 50,000
    expect(pl.expensePaise).toBe(3500000); // Rs 35,000
    expect(pl.netProfitPaise).toBe(1500000); // Rs 15,000 profit
    expect(pl.incomeLines).toHaveLength(1);
    expect(pl.expenseLines).toHaveLength(2);
  });

  it("reports a loss as a negative profit", () => {
    const pl = buildProfitAndLoss([
      { ...balances[0], creditPaise: 100000, closingPaise: -100000 },
      balances[1],
    ]);
    expect(pl.netProfitPaise).toBe(100000 - 3000000);
    expect(pl.netProfitPaise).toBeLessThan(0);
  });

  it("sorts expense lines largest first", () => {
    const pl = buildProfitAndLoss(balances);
    expect(pl.expenseLines[0].name).toBe("Purchases");
  });
});

describe("balance sheet", () => {
  it("balances, with current profit carried to equity", () => {
    // Capital 10,000 -> Cash. Sale of 5,000 cash, cost 3,000 cash.
    // Cash = 10,000 + 5,000 - 3,000 = 12,000
    // Equity = 10,000 capital + 2,000 profit = 12,000
    const balances: LedgerBalance[] = [
      {
        ledgerId: "1",
        ledgerName: "Cash",
        groupName: "Cash-in-Hand",
        nature: "ASSET",
        debitPaise: 1500000,
        creditPaise: 300000,
        closingPaise: 1200000,
      },
      {
        ledgerId: "2",
        ledgerName: "Capital Account",
        groupName: "Capital Account",
        nature: "EQUITY",
        debitPaise: 0,
        creditPaise: 1000000,
        closingPaise: -1000000,
      },
      {
        ledgerId: "3",
        ledgerName: "Sales",
        groupName: "Sales Accounts",
        nature: "INCOME",
        debitPaise: 0,
        creditPaise: 500000,
        closingPaise: -500000,
      },
      {
        ledgerId: "4",
        ledgerName: "Purchases",
        groupName: "Purchase Accounts",
        nature: "EXPENSE",
        debitPaise: 300000,
        creditPaise: 0,
        closingPaise: 300000,
      },
    ];

    const bs = buildBalanceSheet(balances);
    expect(bs.assetsPaise).toBe(1200000);
    expect(bs.equityPaise).toBe(1000000);
    expect(bs.netProfitPaise).toBe(200000);
    // The invariant: assets = liabilities + equity + profit.
    expect(bs.differencePaise).toBe(0);
  });

  it("balances with liabilities present", () => {
    const balances: LedgerBalance[] = [
      {
        ledgerId: "1",
        ledgerName: "Sharma Electronics",
        groupName: "Sundry Debtors",
        nature: "ASSET",
        debitPaise: 1180000,
        creditPaise: 0,
        closingPaise: 1180000,
      },
      {
        ledgerId: "2",
        ledgerName: "Sales",
        groupName: "Sales Accounts",
        nature: "INCOME",
        debitPaise: 0,
        creditPaise: 1000000,
        closingPaise: -1000000,
      },
      {
        ledgerId: "3",
        ledgerName: "Output CGST",
        groupName: "Duties & Taxes",
        nature: "LIABILITY",
        debitPaise: 0,
        creditPaise: 90000,
        closingPaise: -90000,
      },
      {
        ledgerId: "4",
        ledgerName: "Output SGST",
        groupName: "Duties & Taxes",
        nature: "LIABILITY",
        debitPaise: 0,
        creditPaise: 90000,
        closingPaise: -90000,
      },
    ];

    const bs = buildBalanceSheet(balances);
    expect(bs.assetsPaise).toBe(1180000);
    expect(bs.liabilitiesPaise).toBe(180000);
    expect(bs.netProfitPaise).toBe(1000000);
    expect(bs.differencePaise).toBe(0);
  });
});

describe("money helpers used by postings", () => {
  it("toPaise keeps rupee input exact in postings", () => {
    expect(toPaise("1180.00")).toBe(118000);
  });
});
