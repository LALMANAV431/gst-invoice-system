import { describe, expect, it } from "vitest";
import { buildCashFlow, classifyCashFlow, type CashFlowActivity } from "./accounting";

describe("classifyCashFlow", () => {
  it("treats fixed assets as investing", () => {
    expect(classifyCashFlow("ASSET", "Fixed Assets")).toBe("INVESTING");
  });

  it("treats capital and long-term loans as financing", () => {
    expect(classifyCashFlow("EQUITY", "Capital Account")).toBe("FINANCING");
    expect(classifyCashFlow("EQUITY", "Reserves & Surplus")).toBe("FINANCING");
    expect(classifyCashFlow("LIABILITY", "Loans (Liability)")).toBe("FINANCING");
  });

  it("treats trading accounts as operating", () => {
    // Debtors, creditors, income, expenses and taxes are all trading activity.
    expect(classifyCashFlow("ASSET", "Sundry Debtors")).toBe("OPERATING");
    expect(classifyCashFlow("LIABILITY", "Sundry Creditors")).toBe("OPERATING");
    expect(classifyCashFlow("INCOME", "Sales Accounts")).toBe("OPERATING");
    expect(classifyCashFlow("EXPENSE", "Indirect Expenses")).toBe("OPERATING");
    expect(classifyCashFlow("LIABILITY", "Duties & Taxes")).toBe("OPERATING");
  });

  it("classifies any equity ledger as financing even in an unknown group", () => {
    // A user-created equity ledger should not silently land in operating.
    expect(classifyCashFlow("EQUITY", "Partner Accounts")).toBe("FINANCING");
  });

  it("defaults an unrecognised group to operating", () => {
    expect(classifyCashFlow("EXPENSE", "Some Custom Group")).toBe("OPERATING");
  });
});

describe("buildCashFlow", () => {
  const movement = (
    name: string,
    amountPaise: number,
    activity: CashFlowActivity
  ) => ({ name, amountPaise, activity });

  it("sums each activity and reconciles opening to closing", () => {
    const cf = buildCashFlow(100000, [
      movement("Sharma Electronics", 500000, "OPERATING"),
      movement("Reliable Suppliers", -200000, "OPERATING"),
      movement("Office Rent", -50000, "OPERATING"),
      movement("Computer Equipment", -150000, "INVESTING"),
      movement("Owner's Capital", 300000, "FINANCING"),
    ]);

    expect(cf.operatingPaise).toBe(250000);
    expect(cf.investingPaise).toBe(-150000);
    expect(cf.financingPaise).toBe(300000);
    // The invariant: opening + all activities = closing.
    expect(cf.closingPaise).toBe(100000 + 250000 - 150000 + 300000);
    expect(cf.closingPaise).toBe(500000);
  });

  it("merges repeated ledgers into one line", () => {
    const cf = buildCashFlow(0, [
      movement("Sharma Electronics", 100000, "OPERATING"),
      movement("Sharma Electronics", 50000, "OPERATING"),
    ]);
    const line = cf.lines.filter((l) => l.name === "Sharma Electronics");
    expect(line).toHaveLength(1);
    expect(line[0].amountPaise).toBe(150000);
  });

  it("drops lines that net to zero", () => {
    // Money in and straight back out is not a cash flow worth showing.
    const cf = buildCashFlow(0, [
      movement("Suspense", 100000, "OPERATING"),
      movement("Suspense", -100000, "OPERATING"),
    ]);
    expect(cf.lines.some((l) => l.name === "Suspense")).toBe(false);
    expect(cf.operatingPaise).toBe(0);
  });

  it("sorts by absolute size, so the biggest movements lead", () => {
    const cf = buildCashFlow(0, [
      movement("Small", 1000, "OPERATING"),
      movement("Huge outflow", -900000, "OPERATING"),
      movement("Medium", 50000, "OPERATING"),
    ]);
    expect(cf.lines.map((l) => l.name)).toEqual(["Huge outflow", "Medium", "Small"]);
  });

  it("handles no movements", () => {
    const cf = buildCashFlow(250000, []);
    expect(cf.lines).toEqual([]);
    expect(cf.operatingPaise).toBe(0);
    // Closing must still equal opening.
    expect(cf.closingPaise).toBe(250000);
  });

  it("reports a negative closing balance rather than clamping it", () => {
    // An overdrawn bank account is real; hiding it would be wrong.
    const cf = buildCashFlow(10000, [movement("Reliable Suppliers", -60000, "OPERATING")]);
    expect(cf.closingPaise).toBe(-50000);
  });

  it("keeps every amount an exact integer number of paise", () => {
    const cf = buildCashFlow(1, [
      movement("A", 3, "OPERATING"),
      movement("B", -2, "INVESTING"),
    ]);
    for (const line of cf.lines) {
      expect(Number.isSafeInteger(line.amountPaise)).toBe(true);
    }
    expect(Number.isSafeInteger(cf.closingPaise)).toBe(true);
    expect(cf.closingPaise).toBe(2);
  });
});
