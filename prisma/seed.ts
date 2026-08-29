/**
 * Demo data seed.
 *
 * Two things worth knowing:
 *
 * 1. All monetary values here are written in RUPEES and converted with
 *    `toPaise()`. Never write a paise literal by hand - during the paise
 *    migration a mechanical rename turned `salePrice: 14999` into
 *    `salePricePaise: 14999`, silently repricing a Rs 14,999 phone at Rs 149.99.
 *    Converting explicitly makes that class of mistake impossible.
 *
 * 2. The demo user is NO LONGER a platform super-admin. Seeding a published
 *    credential (demo@gst.com / demo1234) with full platform control - including
 *    tenant impersonation - meant anyone who seeded a public deployment handed
 *    over the whole platform. Create a super-admin explicitly with:
 *
 *      npm run db:seed:admin -- --email you@example.com --password '<strong>'
 */

import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";
import { toPaise } from "../src/lib/money";
import { computeGstInvoice } from "../src/lib/gst";
import {
  buildInvoicePosting,
  buildPaymentPosting,
  buildPurchasePosting,
  LEDGER,
  ledgerForPaymentMode,
  salesLedgerForSupplyType,
  SYSTEM_GROUPS,
  SYSTEM_LEDGERS,
  assertBalanced,
  Posting,
} from "../src/lib/accounting";

const prisma = new PrismaClient();

/** Create the default chart of accounts for a company. */
async function seedChartOfAccounts(companyId: string) {
  const groupIds = new Map<string, string>();
  const ordered = [...SYSTEM_GROUPS].sort((a, b) => {
    if (!a.parent && b.parent) return -1;
    if (a.parent && !b.parent) return 1;
    return a.sortOrder - b.sortOrder;
  });

  for (const g of ordered) {
    const created = await prisma.ledgerGroup.create({
      data: {
        companyId,
        name: g.name,
        nature: g.nature,
        parentId: g.parent ? (groupIds.get(g.parent) ?? null) : null,
        isSystem: true,
        sortOrder: g.sortOrder,
      },
    });
    groupIds.set(g.name, created.id);
  }

  for (const l of SYSTEM_LEDGERS) {
    const groupId = groupIds.get(l.group);
    if (!groupId) continue;
    await prisma.ledger.create({
      data: {
        companyId,
        groupId,
        name: l.name,
        isSystem: true,
        openingIsDebit: l.openingIsDebit,
      },
    });
  }

  return groupIds;
}

/** Give a party its control ledger. */
async function seedPartyLedger(
  companyId: string,
  groupIds: Map<string, string>,
  party: { id: string; name: string; type: string }
) {
  const groupName = party.type === "VENDOR" ? "Sundry Creditors" : "Sundry Debtors";
  const groupId = groupIds.get(groupName)!;
  return prisma.ledger.create({
    data: {
      companyId,
      groupId,
      name: party.name,
      partyId: party.id,
      openingIsDebit: party.type !== "VENDOR",
    },
  });
}

/** Write a posting, refusing to store anything unbalanced. */
async function postEntry(
  companyId: string,
  userId: string,
  posting: Posting,
  voucherNo: string
) {
  assertBalanced(posting);

  const names = [...new Set(posting.lines.map((l) => l.ledger))];
  const ledgers = await prisma.ledger.findMany({
    where: { companyId, name: { in: names } },
    select: { id: true, name: true },
  });
  const byName = new Map(ledgers.map((l) => [l.name, l.id]));

  const missing = names.filter((n) => !byName.has(n));
  if (missing.length) throw new Error(`Seed: missing ledgers ${missing.join(", ")}`);

  await prisma.journalEntry.create({
    data: {
      companyId,
      voucherType: posting.voucherType,
      voucherNo,
      date: posting.date,
      narration: posting.narration,
      sourceType: posting.sourceType ?? null,
      sourceId: posting.sourceId ?? null,
      createdBy: userId,
      lines: {
        create: posting.lines.map((l) => ({
          ledgerId: byName.get(l.ledger)!,
          debitPaise: l.debitPaise ?? 0,
          creditPaise: l.creditPaise ?? 0,
        })),
      },
    },
  });
}

async function main() {
  const email = "demo@gst.com";
  const password = await bcrypt.hash("demo1234", 10);

  // Wipe & re-seed. Children before parents for FK safety.
  await prisma.journalEntryLine.deleteMany();
  await prisma.journalEntry.deleteMany();
  await prisma.ledger.deleteMany();
  await prisma.ledgerGroup.deleteMany();
  await prisma.documentCounter.deleteMany();
  await prisma.financialYear.deleteMany();
  await prisma.aiUsageLog.deleteMany();
  await prisma.stockMovement.deleteMany();
  await prisma.stockTransfer.deleteMany();
  await prisma.payment.deleteMany();
  await prisma.invoiceItem.deleteMany();
  await prisma.invoice.deleteMany();
  await prisma.purchaseItem.deleteMany();
  await prisma.purchase.deleteMany();
  await prisma.quotationItem.deleteMany();
  await prisma.quotation.deleteMany();
  await prisma.creditNoteItem.deleteMany();
  await prisma.creditNote.deleteMany();
  await prisma.expense.deleteMany();
  await prisma.supportTicket.deleteMany();
  await prisma.broadcast.deleteMany();
  await prisma.recurringInvoice.deleteMany();
  await prisma.bankTransaction.deleteMany();
  await prisma.budget.deleteMany();
  await prisma.godown.deleteMany();
  await prisma.auditLog.deleteMany();
  await prisma.item.deleteMany();
  await prisma.party.deleteMany();
  await prisma.teamMember.deleteMany();
  await prisma.company.deleteMany();
  await prisma.user.deleteMany();

  // A tenant admin, NOT a platform super-admin.
  const user = await prisma.user.create({
    data: { email, password, name: "Demo User", isSuperAdmin: false },
  });

  const company = await prisma.company.create({
    data: {
      ownerId: user.id,
      name: "Demo Traders Pvt Ltd",
      gstin: "27ABCDE1234F1Z0",
      pan: "ABCDE1234F",
      email: "info@demotraders.com",
      phone: "+91 9876543210",
      addressLine1: "Shop No. 12, Market Road",
      city: "Mumbai",
      state: "Maharashtra",
      stateCode: "27",
      pincode: "400001",
      financialYear: "2025-26",
    },
  });

  // Financial year, so period locking has something to enforce against.
  await prisma.financialYear.create({
    data: {
      companyId: company.id,
      label: "2025-26",
      startDate: new Date(2025, 3, 1),
      endDate: new Date(2026, 2, 31, 23, 59, 59, 999),
    },
  });

  const groupIds = await seedChartOfAccounts(company.id);

  // ---- Parties ----------------------------------------------------------
  const customer = await prisma.party.create({
    data: {
      companyId: company.id,
      name: "Sharma Electronics",
      type: "CUSTOMER",
      gstin: "27AAACS1234B1Z0",
      phone: "+91 9988776655",
      city: "Pune",
      state: "Maharashtra",
      stateCode: "27",
      addressLine1: "Plot 45, MG Road",
      pincode: "411001",
      creditLimitPaise: toPaise(500000), // Rs 5,00,000
    },
  });

  // Inter-state customer, so IGST invoices appear in the demo data.
  const customerKa = await prisma.party.create({
    data: {
      companyId: company.id,
      name: "Bengaluru Gadgets",
      type: "CUSTOMER",
      gstin: "29AAACR9876H1ZP",
      city: "Bengaluru",
      state: "Karnataka",
      stateCode: "29",
    },
  });

  const walkIn = await prisma.party.create({
    data: { companyId: company.id, name: "Walk-in Customer", type: "CUSTOMER" },
  });

  const vendor = await prisma.party.create({
    data: {
      companyId: company.id,
      name: "Reliable Suppliers",
      type: "VENDOR",
      gstin: "29AAACR9876H1ZP",
      phone: "+91 9123456789",
      city: "Bengaluru",
      state: "Karnataka",
      stateCode: "29",
      balanceType: "PAYABLE",
    },
  });

  for (const p of [customer, customerKa, walkIn, vendor]) {
    await seedPartyLedger(company.id, groupIds, p);
  }

  // ---- Items ------------------------------------------------------------
  // Prices in RUPEES, converted explicitly.
  const itemsData = [
    { name: "Samsung Galaxy A15", hsn: "8517", unit: "NOS", sale: 14999, purchase: 12500, gstRate: 18, stock: 25 },
    { name: "Boat Headphones 250", hsn: "8518", unit: "NOS", sale: 1499, purchase: 950, gstRate: 18, stock: 60 },
    { name: "USB-C Cable 1m", hsn: "8544", unit: "NOS", sale: 199, purchase: 80, gstRate: 18, stock: 200 },
    { name: "Power Bank 10000mAh", hsn: "8507", unit: "NOS", sale: 999, purchase: 650, gstRate: 18, stock: 40 },
    { name: "Laptop Bag", hsn: "4202", unit: "NOS", sale: 799, purchase: 400, gstRate: 12, stock: 30 },
    // Exercises the exempt path, which used to be indistinguishable from 0%.
    { name: "Printed Book (exempt)", hsn: "4901", unit: "NOS", sale: 350, purchase: 220, gstRate: 0, stock: 15, supplyType: "EXEMPT" },
    // Exercises cess, which was previously unsupported entirely.
    { name: "Aerated Drink 300ml", hsn: "2202", unit: "NOS", sale: 40, purchase: 25, gstRate: 28, stock: 120, cessRate: 12 },
  ];

  const items: { id: string; name: string; hsn: string; unit: string; salePricePaise: number; purchasePricePaise: number; gstRate: number; cessRate: number; supplyType: string }[] = [];
  for (const it of itemsData) {
    const created = await prisma.item.create({
      data: {
        companyId: company.id,
        name: it.name,
        hsn: it.hsn,
        unit: it.unit,
        salePricePaise: toPaise(it.sale),
        purchasePricePaise: toPaise(it.purchase),
        gstRate: it.gstRate,
        cessRate: it.cessRate ?? 0,
        supplyType: it.supplyType ?? "TAXABLE",
        openingStock: it.stock,
        currentStock: it.stock,
        lowStockAlert: 10,
      },
    });
    items.push(created as never);
  }

  const byName = (n: string) => items.find((i) => i.name === n)!;

  // ---- Demo transactions, posted through the real engines ---------------
  //
  // Using the same code paths the application uses means the seeded books are
  // guaranteed to balance - and if a posting rule ever breaks, `npm run db:seed`
  // fails loudly instead of producing plausible-looking wrong data.

  let invoiceSeq = 0;
  async function createDemoInvoice(opts: {
    party: { id: string; name: string; stateCode: string | null };
    lines: { item: ReturnType<typeof byName>; qty: number }[];
    date: Date;
    discount?: number;
    payNow?: boolean;
    paymentMode?: string;
  }) {
    const gst = computeGstInvoice({
      supplierStateCode: company.stateCode,
      placeOfSupplyStateCode: opts.party.stateCode ?? company.stateCode,
      lines: opts.lines.map((l) => ({
        quantity: l.qty,
        rate: l.item.salePricePaise / 100,
        gstRate: l.item.gstRate,
        cessRate: l.item.cessRate,
        supplyType: l.item.supplyType as never,
      })),
      invoiceDiscount: opts.discount ?? 0,
      roundToNearestRupee: true,
    });

    invoiceSeq += 1;
    const number = `INV/25-26/${String(invoiceSeq).padStart(4, "0")}`;

    const invoice = await prisma.invoice.create({
      data: {
        companyId: company.id,
        partyId: opts.party.id,
        number,
        date: opts.date,
        dueDate: new Date(opts.date.getTime() + 30 * 86400000),
        status: "UNPAID",
        subTotalPaise: gst.taxablePaise - gst.additionalChargesPaise,
        cgstTotalPaise: gst.cgstPaise,
        sgstTotalPaise: gst.sgstPaise,
        igstTotalPaise: gst.igstPaise,
        cessTotalPaise: gst.cessPaise,
        taxTotalPaise: gst.taxPaise,
        discountPaise: gst.invoiceDiscountPaise,
        roundOffPaise: gst.roundOffPaise,
        grandTotalPaise: gst.grandTotalPaise,
        isInterState: gst.isInterState,
        placeOfSupply: opts.party.stateCode ?? company.stateCode,
        items: {
          create: gst.lines.map((line, i) => ({
            itemId: opts.lines[i].item.id,
            itemName: opts.lines[i].item.name,
            hsn: opts.lines[i].item.hsn,
            quantity: line.quantity,
            unit: opts.lines[i].item.unit,
            ratePaise: line.ratePaise,
            discountPaise: line.discountPaise,
            apportionedDiscountPaise: line.apportionedDiscountPaise,
            taxablePaise: line.taxablePaise,
            gstRate: line.gstRate,
            cessRate: opts.lines[i].item.cessRate,
            cgstPaise: line.cgstPaise,
            sgstPaise: line.sgstPaise,
            igstPaise: line.igstPaise,
            cessPaise: line.cessPaise,
            totalPaise: line.totalPaise,
            supplyType: line.supplyType,
          })),
        },
      },
    });

    for (const l of opts.lines) {
      await prisma.item.update({
        where: { id: l.item.id },
        data: { currentStock: { decrement: l.qty } },
      });
      await prisma.stockMovement.create({
        data: {
          companyId: company.id,
          itemId: l.item.id,
          type: "OUT",
          quantity: l.qty,
          reference: number,
          notes: `Sale: ${number}`,
          date: opts.date,
        },
      });
    }

    const taxableByLedger: Record<string, number> = {};
    for (const line of gst.lines) {
      const ledger = salesLedgerForSupplyType(line.supplyType);
      taxableByLedger[ledger] = (taxableByLedger[ledger] ?? 0) + line.taxablePaise;
    }

    await postEntry(
      company.id,
      user.id,
      buildInvoicePosting({
        partyLedger: opts.party.name,
        date: opts.date,
        number,
        invoiceId: invoice.id,
        taxableByLedger,
        cgstPaise: gst.cgstPaise,
        sgstPaise: gst.sgstPaise,
        igstPaise: gst.igstPaise,
        cessPaise: gst.cessPaise,
        additionalChargesPaise: 0,
        roundOffPaise: gst.roundOffPaise,
        grandTotalPaise: gst.grandTotalPaise,
        tdsPaise: 0,
      }),
      number
    );

    if (opts.payNow) {
      const payNumber = `PMT/25-26/${String(invoiceSeq).padStart(4, "0")}`;
      const payment = await prisma.payment.create({
        data: {
          companyId: company.id,
          partyId: opts.party.id,
          invoiceId: invoice.id,
          number: payNumber,
          type: "RECEIVED",
          mode: opts.paymentMode ?? "UPI",
          amountPaise: gst.grandTotalPaise,
          date: opts.date,
        },
      });
      await prisma.invoice.update({
        where: { id: invoice.id },
        data: { amountPaidPaise: gst.grandTotalPaise, status: "PAID" },
      });
      await postEntry(
        company.id,
        user.id,
        buildPaymentPosting({
          partyLedger: opts.party.name,
          cashOrBankLedger: ledgerForPaymentMode(opts.paymentMode ?? "UPI"),
          date: opts.date,
          number: payNumber,
          paymentId: payment.id,
          amountPaise: gst.grandTotalPaise,
          type: "RECEIVED",
        }),
        payNumber
      );
    }

    return invoice;
  }

  const today = new Date();
  const daysAgo = (n: number) => new Date(today.getTime() - n * 86400000);

  // Intra-state, paid in full.
  await createDemoInvoice({
    party: customer,
    lines: [
      { item: byName("Samsung Galaxy A15"), qty: 2 },
      { item: byName("USB-C Cable 1m"), qty: 3 },
    ],
    date: daysAgo(20),
    payNow: true,
    paymentMode: "UPI",
  });

  // Intra-state with a bill-level discount - the case that used to overcharge GST.
  await createDemoInvoice({
    party: customer,
    lines: [{ item: byName("Boat Headphones 250"), qty: 10 }],
    date: daysAgo(12),
    discount: 500,
  });

  // Inter-state, so IGST is exercised.
  await createDemoInvoice({
    party: customerKa,
    lines: [
      { item: byName("Power Bank 10000mAh"), qty: 5 },
      { item: byName("Laptop Bag"), qty: 4 },
    ],
    date: daysAgo(8),
  });

  // Mixed exempt + cess, over-the-counter and paid in cash.
  await createDemoInvoice({
    party: walkIn,
    lines: [
      { item: byName("Printed Book (exempt)"), qty: 2 },
      { item: byName("Aerated Drink 300ml"), qty: 6 },
    ],
    date: daysAgo(3),
    payNow: true,
    paymentMode: "CASH",
  });

  // ---- A purchase, so input tax credit exists ---------------------------
  {
    const purchaseLines = [
      { item: byName("Samsung Galaxy A15"), qty: 10 },
      { item: byName("Boat Headphones 250"), qty: 25 },
    ];
    const gst = computeGstInvoice({
      supplierStateCode: company.stateCode,
      placeOfSupplyStateCode: vendor.stateCode,
      lines: purchaseLines.map((l) => ({
        quantity: l.qty,
        rate: l.item.purchasePricePaise / 100,
        gstRate: l.item.gstRate,
      })),
      roundToNearestRupee: true,
    });

    const number = "PUR/25-26/0001";
    const date = daysAgo(25);
    const purchase = await prisma.purchase.create({
      data: {
        companyId: company.id,
        partyId: vendor.id,
        number,
        vendorBillNo: "RS/2025/8891",
        date,
        status: "UNPAID",
        subTotalPaise: gst.taxablePaise,
        cgstTotalPaise: gst.cgstPaise,
        sgstTotalPaise: gst.sgstPaise,
        igstTotalPaise: gst.igstPaise,
        cessTotalPaise: gst.cessPaise,
        taxTotalPaise: gst.taxPaise,
        roundOffPaise: gst.roundOffPaise,
        grandTotalPaise: gst.grandTotalPaise,
        isInterState: gst.isInterState,
        placeOfSupply: vendor.stateCode,
        itcEligible: true,
        items: {
          create: gst.lines.map((line, i) => ({
            itemId: purchaseLines[i].item.id,
            itemName: purchaseLines[i].item.name,
            hsn: purchaseLines[i].item.hsn,
            quantity: line.quantity,
            unit: purchaseLines[i].item.unit,
            ratePaise: line.ratePaise,
            taxablePaise: line.taxablePaise,
            gstRate: line.gstRate,
            cgstPaise: line.cgstPaise,
            sgstPaise: line.sgstPaise,
            igstPaise: line.igstPaise,
            cessPaise: line.cessPaise,
            totalPaise: line.totalPaise,
          })),
        },
      },
    });

    for (const l of purchaseLines) {
      await prisma.item.update({
        where: { id: l.item.id },
        data: { currentStock: { increment: l.qty } },
      });
      await prisma.stockMovement.create({
        data: {
          companyId: company.id,
          itemId: l.item.id,
          type: "IN",
          quantity: l.qty,
          reference: number,
          notes: `Purchase: ${number}`,
          date,
        },
      });
    }

    await postEntry(
      company.id,
      user.id,
      buildPurchasePosting({
        partyLedger: vendor.name,
        date,
        number,
        purchaseId: purchase.id,
        taxablePaise: gst.taxablePaise,
        cgstPaise: gst.cgstPaise,
        sgstPaise: gst.sgstPaise,
        igstPaise: gst.igstPaise,
        cessPaise: gst.cessPaise,
        additionalChargesPaise: 0,
        roundOffPaise: gst.roundOffPaise,
        grandTotalPaise: gst.grandTotalPaise,
        itcEligible: true,
      }),
      number
    );
  }

  // ---- Opening capital, so the balance sheet has an equity side ---------
  {
    const capitalPaise = toPaise(500000); // Rs 5,00,000
    const date = new Date(2025, 3, 1);
    await postEntry(
      company.id,
      user.id,
      {
        voucherType: "OPENING",
        date,
        narration: "Opening capital introduced",
        lines: [
          { ledger: LEDGER.BANK, debitPaise: capitalPaise },
          { ledger: LEDGER.CAPITAL, creditPaise: capitalPaise },
        ],
      },
      "OPENING/25-26/0001"
    );
  }

  // Seed the counters so the next document continues the series instead of
  // restarting at 1 and colliding with the demo numbers above.
  await prisma.documentCounter.createMany({
    data: [
      { companyId: company.id, documentType: "INVOICE", financialYear: "2025-26", prefix: "INV", lastNumber: invoiceSeq },
      { companyId: company.id, documentType: "PAYMENT", financialYear: "2025-26", prefix: "PMT", lastNumber: invoiceSeq },
      { companyId: company.id, documentType: "PURCHASE", financialYear: "2025-26", prefix: "PUR", lastNumber: 1 },
    ],
  });

  // ---- Platform settings ------------------------------------------------
  await prisma.siteSetting.deleteMany();
  await prisma.coupon.deleteMany();
  await prisma.planSetting.deleteMany();

  const siteSettings: Record<string, string> = {
    site_name: "GST Books",
    support_phone: "+91 90000 00000",
    support_email: "support@gstbooks.in",
    whatsapp_number: "+919000000000",
    address: "Mumbai, Maharashtra, India",
    announcement: "New: POS billing with barcode scanner is now live!",
    announcement_active: "true",
    facebook_url: "",
    instagram_url: "",
    twitter_url: "",
  };
  for (const [key, value] of Object.entries(siteSettings)) {
    await prisma.siteSetting.create({ data: { key, value } });
  }

  await prisma.planSetting.createMany({
    data: [
      { id: "FREE", name: "Free", tagline: "For freelancers & new businesses", priceMonthlyPaise: 0, priceAnnualPaise: 0, invoiceLimit: 20, userLimit: 1 },
      { id: "BASIC", name: "Basic", tagline: "For growing small businesses", priceMonthlyPaise: toPaise(299), priceAnnualPaise: toPaise(2990), invoiceLimit: -1, userLimit: 3 },
      { id: "PREMIUM", name: "Premium", tagline: "Full Tally/Busy replacement", priceMonthlyPaise: toPaise(999), priceAnnualPaise: toPaise(9990), invoiceLimit: -1, userLimit: 25 },
    ],
  });

  await prisma.coupon.createMany({
    data: [
      { code: "WELCOME20", description: "20% off first subscription", type: "PERCENT", percentOff: 20, active: true },
      { code: "FLAT100", description: "Flat Rs 100 off", type: "FLAT", flatOffPaise: toPaise(100), appliesToPlan: "BASIC", active: true },
    ],
  });

  // ---- Verify the seeded books actually balance -------------------------
  const lines = await prisma.journalEntryLine.aggregate({
    _sum: { debitPaise: true, creditPaise: true },
  });
  const totalDebit = lines._sum.debitPaise ?? 0;
  const totalCredit = lines._sum.creditPaise ?? 0;
  if (totalDebit !== totalCredit) {
    throw new Error(
      `Seed produced unbalanced books: debits ${totalDebit} != credits ${totalCredit}`
    );
  }

  console.log("\nSeed complete.");
  console.log(`   Login:   ${email} / demo1234   (tenant admin)`);
  console.log(`   Ledger:  debits = credits = Rs ${(totalDebit / 100).toFixed(2)} — books balance`);
  console.log("   Super-admin: NOT seeded. Create one explicitly:");
  console.log("     npm run db:seed:admin -- --email you@example.com --password '<strong-password>'");
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
