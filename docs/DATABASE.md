# Database

> **Status:** the paise migration and the double-entry schema described below are
> **implemented**. This document now describes the current schema and records the reasoning,
> rather than proposing future work. Remaining schema work is in
> [`ROADMAP.md`](ROADMAP.md) Phase 3 (PostgreSQL, `BigInt` for cumulative columns).

## Current schema

Prisma 5 on SQLite. 27 models. Full definition in `prisma/schema.prisma`.

```
User ──┬── Company (tenant root) ──┬── Party (customer/supplier)
       │                           ├── Item ── StockMovement
       │                           ├── Godown ── StockTransfer
       │                           ├── Invoice ── InvoiceItem
       │                           ├── Purchase ── PurchaseItem
       │                           ├── Quotation ── QuotationItem
       │                           ├── CreditNote ── CreditNoteItem
       │                           ├── Payment
       │                           ├── Expense
       │                           ├── BankTransaction
       │                           ├── RecurringInvoice
       │                           ├── Budget
       │                           └── AuditLog
       └── TeamMember (role per company)

Platform-level: SiteSetting, Coupon, PlanSetting, SupportTicket, Broadcast
```

### Multi-tenancy

`Company` is the tenant boundary. Every tenant table carries `companyId` with
`onDelete: Cascade`, and access is always filtered by the `companyId` resolved from the
session. This is implemented correctly and consistently throughout — it is the strongest
part of the current schema.

### Existing indexes

Already present and well chosen:

```prisma
@@unique([companyId, number])   // Invoice, Purchase, Payment, Quotation,
                                // CreditNote, Expense — prevents duplicate
                                // document numbers within a tenant
@@index([companyId, date])      // the dominant access pattern for every
                                // transactional table
@@index([companyId, itemId])    // StockMovement
@@index([companyId, entity, createdAt])  // AuditLog
@@unique([userId, companyId])   // TeamMember
@@unique([companyId, category, period])  // Budget
```

---

## Money columns: integer paise ✅ implemented

**The problem:** 93 `Float` columns hold monetary values. Verified consequence — accumulating
100 lines of `3 x ₹33.33` yields `9998.999999999984` instead of `9999`.

**The change:** every money column becomes an integer number of paise, suffixed `Paise`.

```prisma
// Before
model Invoice {
  subTotal   Float @default(0)
  cgstTotal  Float @default(0)
  grandTotal Float @default(0)
}

// After
model Invoice {
  subTotalPaise   Int @default(0)
  cgstTotalPaise  Int @default(0)
  sgstTotalPaise  Int @default(0)
  igstTotalPaise  Int @default(0)
  cessTotalPaise  Int @default(0)   // new — cess was entirely absent
  taxTotalPaise   Int @default(0)
  discountPaise   Int @default(0)
  roundOffPaise   Int @default(0)
  grandTotalPaise Int @default(0)
  amountPaidPaise Int @default(0)
  tdsPaise        Int @default(0)
}
```

`Int` (32-bit) holds up to ₹2.14 crore per field. For a system that may record annual
turnover aggregates, use `BigInt` on cumulative columns. Quantities stay `Float` —
`2.5 kg` is a legitimate quantity, and a quantity is not money.

Naming every such column `…Paise` makes a stray float visible in code review.

### Migration procedure

Never convert in place — the original values must remain recoverable.

```sql
-- 1. Add the new column alongside the old one
ALTER TABLE "Invoice" ADD COLUMN "grandTotalPaise" INTEGER NOT NULL DEFAULT 0;

-- 2. Backfill with explicit rounding
UPDATE "Invoice" SET "grandTotalPaise" = CAST(ROUND("grandTotal" * 100) AS INTEGER);

-- 3. VERIFY before dropping anything — this must return zero rows
SELECT id, "grandTotal", "grandTotalPaise"
FROM "Invoice"
WHERE ABS("grandTotal" * 100 - "grandTotalPaise") > 0.5;

-- 4. Only after verification, and after a full backup, drop the old column
```

Run steps 1–3, deploy code that reads the new columns, keep the old ones for one release as
a safety net, then drop them.

**Expect the backfill to expose existing bad data.** Invoices whose stored `grandTotal` does
not equal `subTotal + taxTotal` were computed with the discount-after-tax bug and are wrong
at rest. Reconcile them with a report before migrating; do not silently "fix" historical
invoices that customers have already received, since the document they hold is the legal
record. Correct them with credit notes where the amounts materially differ.

---

## Double-entry accounting ✅ implemented

The largest functional gap: there is no ledger. Without double entry there is no arithmetic
guarantee the books balance, and no trial balance, profit & loss or balance sheet is
possible.

```prisma
model LedgerGroup {
  id        String  @id @default(cuid())
  companyId String
  name      String            // "Sundry Debtors", "Bank Accounts", "Direct Expenses"
  nature    String            // ASSET | LIABILITY | INCOME | EXPENSE | EQUITY
  parentId  String?           // groups nest, as in Tally
  isSystem  Boolean @default(false)  // system groups cannot be deleted

  parent   LedgerGroup?  @relation("GroupTree", fields: [parentId], references: [id])
  children LedgerGroup[] @relation("GroupTree")
  ledgers  Ledger[]

  @@unique([companyId, name])
  @@index([companyId, nature])
}

model Ledger {
  id                  String  @id @default(cuid())
  companyId           String
  groupId             String
  name                String
  code                String?
  openingBalancePaise Int     @default(0)
  openingIsDebit      Boolean @default(true)

  // A party or bank account gets exactly one control ledger.
  partyId       String? @unique
  bankAccountId String? @unique

  group   LedgerGroup        @relation(fields: [groupId], references: [id])
  entries JournalEntryLine[]

  @@unique([companyId, name])
  @@index([companyId, groupId])
}

model JournalEntry {
  id          String   @id @default(cuid())
  companyId   String
  voucherType String   // SALES | PURCHASE | RECEIPT | PAYMENT | JOURNAL |
                       // CONTRA | CREDIT_NOTE | DEBIT_NOTE | STOCK_JOURNAL
  voucherNo   String
  date        DateTime
  narration   String?

  // Link back to the document that produced this posting.
  sourceType String?   // "Invoice" | "Payment" | "Expense" | ...
  sourceId   String?

  // Immutable once the period is locked.
  isLocked  Boolean @default(false)
  createdBy String
  createdAt DateTime @default(now())

  lines JournalEntryLine[]

  @@unique([companyId, voucherType, voucherNo])
  @@index([companyId, date])
  @@index([companyId, sourceType, sourceId])
}

model JournalEntryLine {
  id       String @id @default(cuid())
  entryId  String
  ledgerId String

  debitPaise  Int @default(0)
  creditPaise Int @default(0)

  entry  JournalEntry @relation(fields: [entryId], references: [id], onDelete: Cascade)
  ledger Ledger       @relation(fields: [ledgerId], references: [id])

  @@index([ledgerId])
  @@index([entryId])
}
```

### The invariant

**For every `JournalEntry`, the sum of `debitPaise` must equal the sum of `creditPaise`.**

Enforce this in the service layer inside the transaction that writes the entry, and again as
a database constraint via a deferred trigger. Because amounts are integers, this check is
exact — which is precisely why the paise migration must come first. With floats, a balanced
entry could fail its own balance check.

### Example posting — a sales invoice

`₹10,000 + 18% GST` intra-state, to a Karnataka customer:

| Ledger | Debit | Credit |
|---|---|---|
| Sharma Electronics (Sundry Debtors) | 11,800.00 | |
| Sales @ 18% | | 10,000.00 |
| Output CGST | | 900.00 |
| Output SGST | | 900.00 |
| **Total** | **11,800.00** | **11,800.00** |

Every document type gets one deterministic posting rule, in `src/lib/accounting.ts`. Once
these exist, trial balance, P&L and balance sheet are queries over
`JournalEntryLine`, not bespoke report code — which is why they are cheap to add afterwards
and impossible to add correctly before.

---

## Supporting tables ✅ implemented

### Numbering counter — fixes the race condition

```prisma
model DocumentCounter {
  id            String @id @default(cuid())
  companyId     String
  documentType  String   // INVOICE | PURCHASE | PAYMENT | QUOTATION | ...
  financialYear String   // "2026-27"
  prefix        String
  lastNumber    Int    @default(0)

  @@unique([companyId, documentType, financialYear])
}
```

Increment this row inside the same transaction that creates the document. The unique
constraint plus row-level locking makes allocation atomic, replacing the current
read-then-increment that collides under concurrency. Keying on `financialYear` also satisfies
the GST requirement for a series that restarts each year.

### Financial year and period locking

```prisma
model FinancialYear {
  id        String   @id @default(cuid())
  companyId String
  startDate DateTime          // 1 April
  endDate   DateTime          // 31 March
  isClosed  Boolean  @default(false)
  lockedTill DateTime?        // no backdated entries before this date

  @@unique([companyId, startDate])
}
```

Once a period is filed, entries in it must not change. Without this, a user can edit a
GSTR-1 already submitted, and the return no longer matches the books.

### Cess and supply type on line items

```prisma
model InvoiceItem {
  // ...
  supplyType     String @default("TAXABLE")  // TAXABLE | EXEMPT | NIL_RATED |
                                             // NON_GST | ZERO_RATED
  cessRate       Float  @default(0)
  cessPerUnit    Int    @default(0)          // paise
  cessPaise      Int    @default(0)
  pricingMode    String @default("EXCLUSIVE") // EXCLUSIVE | INCLUSIVE
  apportionedDiscountPaise Int @default(0)   // share of the invoice-level discount
}
```

`apportionedDiscountPaise` is stored rather than recomputed so an invoice can be
reproduced exactly years later, even if apportionment logic changes.

### AI usage metering

```prisma
model AiUsageLog {
  id           String   @id @default(cuid())
  companyId    String
  userId       String
  feature      String   // OCR | ASSISTANT | CATEGORISE | FORECAST
  provider     String
  model        String
  inputTokens  Int
  outputTokens Int
  costPaise    Int      @default(0)
  cacheHit     Boolean  @default(false)
  createdAt    DateTime @default(now())

  @@index([companyId, createdAt])
  @@index([companyId, feature])
}
```

Required to enforce per-tenant budgets and to know whether AI features are profitable at
₹299/month.

---

## Indexes ✅ added

```prisma
// Party lookup by GSTIN — used for duplicate detection and 2B reconciliation
@@index([companyId, gstin])

// Item lookup by barcode — the POS hot path; must be fast
@@index([companyId, barcode])

// Overdue receivables — the most-run business query
@@index([companyId, status, dueDate])

// Ledger statement — the core accounting query
@@index([ledgerId, entryId])

// Payment allocation
@@index([companyId, partyId, date])
```

---

## Seed data

`prisma/seed.ts` creates a demo company with customers, suppliers, products, invoices and
purchases, and is safely re-runnable (it clears child tables FK-first).

Two changes made and needed:

1. **Fixed:** all three GSTINs were checksum-invalid (`27ABCDE1234F1Z5`,
   `27AAACS1234B1Z5`, `29AAACR9876H1Z2`). Corrected to checksum-valid fictional numbers.
2. **Still to fix:** the demo user is created with `isSuperAdmin: true`. Seeding a published
   credential with full platform control is a critical risk. Split into `db:seed` (tenant
   demo data only) and a separate, explicit `db:seed:admin` requiring a strong password.

Seed data must always use synthetic GSTINs, PANs and bank details — never real ones.
