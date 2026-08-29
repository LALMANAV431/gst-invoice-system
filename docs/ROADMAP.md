# Roadmap

Phased plan from the current state to a production-ready accounting SaaS. Ordered by risk,
not by visible feature count — correctness work comes first because everything else sits on
top of it.

Effort estimates assume one experienced full-stack developer.

---

## Phase 0 — Audit and foundation ✅ **complete**

- [x] Locate the application (it was stranded on a feature branch, not `main`)
- [x] Full audit with reproduced evidence → [`AUDIT.md`](AUDIT.md)
- [x] Replace the README, which described a non-existent WordPress plugin
- [x] Fix `npm run lint` (hung on an interactive prompt; CI lint was a silent no-op)
- [x] Integer-paise money engine → `src/lib/money.ts`
- [x] Correct GST engine → `src/lib/gst.ts`
- [x] Fix three checksum-invalid seed GSTINs
- [x] Docker, Compose, `.dockerignore`, `/api/health` — build and runtime verified
- [x] Document all environment variables
- [x] Architecture, database, API, GST, deployment and business documentation

---

## Phase 1 — Correctness and security ✅ **complete**

### 1.1 Money and GST wired in ✅

- [x] Migrated all 93 `Float` money columns to integer paise, suffixed `…Paise`
- [x] Replaced `calcLineGST` with `computeGstInvoice()` across invoices, purchases,
      quotations, credit notes, POS and quotation-conversion
- [x] Added `cessRate`, `cessPerUnitPaise`, `supplyType`, `pricingMode`,
      `apportionedDiscountPaise` to all line-item models and the invoice form
- [x] Invoice-level discount apportioned pro-rata **before** tax
- [x] TDS reported separately; invoice face value no longer reduced
- [x] Deleted `src/lib/numbering.ts` and `calcLineGST` outright rather than deprecating
      them, so the old behaviour cannot be reintroduced
- [x] Extracted logic into `src/server/services/`
- [x] Live form preview uses the same engine as the server, so the total shown is the total
      saved

**Verified:** `₹10,000 @18%` with a `₹1,000` discount now charges `₹1,620` GST, not `₹1,800`.
Cess, exempt supplies and inclusive pricing all confirmed against the running API.

### 1.2 Security ✅

- [x] Next.js 14.2.18 → 14.2.35; `jspdf` 2.x → 4.x; `vitest` 2.x → 4.x; plus `nanoid`,
      `js-yaml`, `brace-expansion` — **16 advisories (2 critical) → 5 high, 0 critical**
- [x] Demo account no longer a super-admin; `npm run db:seed:admin` with password strength rules
- [x] `src/middleware.ts` — rate limiting, CSRF origin checks, CSP and security headers
- [x] Zod validation on every write route
- [x] `Secure` cookie flag in production
- [x] Session revocation via `User.tokenVersion`

### 1.3 Data integrity ✅

- [x] `DocumentCounter` for atomic, gap-free, financial-year-scoped numbering
- [x] `FinancialYear` with period locking
- [x] Pagination on invoice, purchase, quotation, credit-note, payment and expense lists
- [x] Added indexes: `(companyId, gstin)`, `(companyId, barcode)`,
      `(companyId, status, dueDate)`, `(companyId, partyId, date)`
- [x] Payment totals derived from the payments table rather than incremented, so they
      cannot drift
- [x] Credit-limit enforcement on invoice creation

**Verified:** five concurrent invoice creations produced five distinct sequential numbers.

---

## Phase 2 — Real accounting ✅ **core complete**

### 2.1 Double-entry ledger ✅

- [x] `LedgerGroup`, `Ledger`, `JournalEntry`, `JournalEntryLine`
- [x] Default Indian chart of accounts, seeded per company (19 groups, 22 system ledgers)
- [x] `src/lib/accounting.ts` — one deterministic posting rule per document type
- [x] Auto-posting for sales, purchases, receipts, payments, expenses, credit and debit notes
- [x] `assertBalanced()` refuses to store an unbalanced entry
- [x] Party control ledgers, so a party's ledger balance and outstanding cannot disagree
- [x] Blocked-ITC handling: tax becomes cost instead of input credit
- [x] Sales split across ledgers by supply type, so GSTR-1 grouping is derivable

**Verified:** the seed refuses to finish unless debits equal credits, and reports
`debits = credits = ₹776,373.30`.

### 2.2 Financial statements ✅

- [x] Trial balance, with a prominent warning when it does not balance
- [x] Profit & loss, defaulting to the Indian financial year
- [x] Balance sheet, with current-period profit carried to the equity side
- [x] GST summary (output vs input tax, the core of GSTR-3B)

### 2.3 Remaining in this phase

- [ ] Manual journal vouchers (UI; the posting layer already supports them)
- [ ] Cash flow statement
- [ ] Opening balance entry screen
- [ ] Drill-down from a statement figure to its source document
- [ ] Comparative periods
- [ ] Ledger edit as reverse-and-repost for every document type (see `SECURITY.md` item 7)
- [ ] Year closing with retained-earnings transfer
- [ ] Full GSTR-3B, GSTR-2B reconciliation, ITC eligibility classification

---

## Phase 3 — Next.js 16 and PostgreSQL 🔴 **next up**

### 3.1 Next.js 16 upgrade (3–5 days)

The only remaining blocker for a clean `npm audit`.

- [ ] Upgrade `next` and `eslint-config-next` to 16.3.x
- [ ] Await the now-async request APIs: `cookies()`, `headers()`, route `params`
- [ ] Re-verify middleware, PWA service worker and the standalone Docker build
- [ ] Re-run the full suite plus a manual invoice/payment/report pass

Kept separate because it touches every route handler and page; mixing it with tax logic
would make both changes unreviewable.

### 3.2 PostgreSQL (3–4 days)

- [ ] Switch the provider; adopt `prisma migrate` instead of `db push`
- [ ] Commit `prisma/migrations/`
- [ ] Change cumulative paise columns to `BigInt` (`Int` caps at ~₹2.14 crore on Postgres;
      SQLite's 64-bit `INTEGER` hides this today)
- [ ] Postgres service container in CI
- [ ] Connection pooling
- [ ] Keep the SQLite schema for the portable USB edition

### 3.3 Testing above the domain layer (1 week)

98 tests cover money, GST and accounting. Nothing covers the HTTP or database layer.

- [ ] Integration tests per API route against a real database
- [ ] Auth, RBAC and **cross-tenant isolation** tests — the highest-value gap
- [ ] Rate limiting and CSRF tests
- [ ] Invoice → payment → trial-balance flow test
- [ ] Playwright E2E for invoice creation and the reports
- [ ] Run tests and `npm audit --audit-level=high` in CI

---

## Phase 4 — Monetisation (3–4 weeks)

- [ ] Razorpay subscriptions (test mode first)
- [ ] **Signature-verified, idempotent** webhooks
- [ ] Plan upgrade/downgrade with proration; dunning for failed payments
- [ ] GST-compliant invoices for your own subscriptions
- [ ] Extend `src/lib/plan.ts` to the six tiers in [`BUSINESS_MODEL.md`](BUSINESS_MODEL.md)
- [ ] Usage metering per limit, enforced server-side
- [ ] Landing and pricing pages with SEO; Terms, Privacy, Refund, Cookie policies
- [ ] Revenue dashboard: MRR, ARR, churn, conversion
- [ ] CA/partner portal with multi-client dashboard and commission tracking

The CA channel is the highest-leverage distribution available; treat it as a growth feature,
not an afterthought.

---

## Phase 5 — AI (2–3 weeks)

Strictly after the fundamentals. AI on top of wrong numbers produces confident wrong answers.

- [ ] Provider abstraction with `mock` as the default (design in
      [`ARCHITECTURE.md`](ARCHITECTURE.md))
- [ ] `AiUsageLog` is already in the schema; wire per-tenant budgets enforced **before** the call
- [ ] Response caching; PII redaction
- [ ] **Bill OCR** — highest value; removes the most painful data entry
- [ ] **Natural-language reporting** in Hindi and English ("aaj kitni sale hui?")
- [ ] Expense categorisation — suggestions only, never auto-posted
- [ ] GST error detection; duplicate invoice/party detection; forecasting

**Non-negotiable:** AI never writes to the ledger. It proposes; a human approves. Every
feature degrades cleanly to unavailable when `AI_ENABLED=false`.

---

## Phase 6 — Depth and scale (ongoing)

- [x] Hindi/English i18n — typed dictionaries; a missing key is a compile error
- [x] Batch/expiry tracking; FIFO and weighted-average valuation; COGS; stock
      ageing; dead stock; stock adjustments; physical counts
      (see `docs/INVENTORY_VALUATION.md`)
- [x] Public API webhooks (outbound, HMAC-signed, SSRF-guarded)
- [x] 2FA (TOTP, written against RFC 6238 vectors)
- [ ] E-invoice IRP integration via a GSP (fields already exist)
- [ ] E-way bill API integration
- [ ] Offline-first POS with sync
- [ ] Serial-number tracking (batch tracking landed; per-unit serials did not)
- [ ] Manufacturing (BOM, work orders); payroll
- [ ] Customer and supplier portals
- [ ] Public API with keys and rate limits
- [ ] White-label with custom domains
- [ ] Background jobs (`pg-boss`); Redis caching

### Inventory follow-ups

Deliberately left out of the valuation work, with the reasoning recorded so the
next person does not have to rediscover it:

- **Layer-exact sales-return costing.** A return currently re-enters stock at the
  weighted average of costed receipts (`estimateCostRate`), not at the exact FIFO
  layer the original issue consumed. Doing it properly needs a link from each
  issue to the layers it drew from — a new table and a write on every sale. The
  estimate stays inside the range of prices actually paid and cannot unbalance
  anything (the returned goods form a new layer and the conservation invariant
  still holds), so this is accuracy, not correctness.
- **Materialised period-opening snapshots.** Valuation replays every movement for
  an item on each request. One query loads them all and grouping happens in
  memory, which is fine for hundreds of items but not for years of history on
  thousands. The fix is a stored opening position per period, *not* a query per
  item.
- **Per-godown stock balances.** Movements record `godownId`, but `Item.godownId`
  is a single field, so godown quantities are not a first-class balance and a
  stock transfer does not really move stock between locations. This is an existing
  modelling gap that the valuation work exposed rather than caused.
- **Per-batch FIFO costing.** Batches carry quantity and expiry and are valued at
  the item purchase price. Layered costing per batch matters for pharma; it needs
  batch selection on every issue, which is a UI change as much as a data one.
- **Ledger posting for stock losses.** Under periodic inventory a write-off is
  already inside `Purchases`, so adjustments correctly post nothing. Moving to
  perpetual inventory (capitalising receipts to `Stock-in-Hand`) would make a
  write-off a real journal entry, and would also let the balance sheet carry stock
  as an asset continuously rather than only after year-end closing. That is a
  significant accounting-policy change, not a bug fix.

---

## Sequencing rationale

**Why correctness came first.** A missing report is an inconvenience; a wrong tax total is a
liability that compounds silently. The discount-after-tax bug overcharged GST on every
discounted invoice — each one a document a customer could dispute and a return that
overstated liability.

**Why paise before double entry.** Double entry's guarantee is that debits equal credits
*exactly*. With floating-point amounts a balanced entry can fail its own balance check for
reasons unrelated to accounting. The integer migration is what makes the invariant checkable
— and it is now enforced on every write.

**Why the Next.js upgrade is separate.** It converts the request APIs to async across every
route and page. Landing it alongside tax logic would mean a diff where a reviewer cannot tell
a mechanical `await` from a change in how GST is computed.

**Why AI is last.** It is the only component whose marginal cost scales with usage, and the
only one that can confidently produce wrong output. It is also the easiest to sell — which is
exactly why it must wait until the numbers underneath it are right.

---

## Current state summary

**Working and tested:** exact money arithmetic, GST (intra/inter-state, cess, all five supply
types, RCM, inclusive pricing, discount ordering, round-off, TDS), double-entry ledger with an
enforced balance invariant, trial balance, P&L, balance sheet, GST summary, atomic gap-free
numbering, period locking, rate limiting, CSRF, CSP, session revocation, Zod on every write
route, Docker with a verified runtime.

**Before real bookkeeping:** Next.js 16 upgrade (5 open `high` advisories), PostgreSQL with
versioned migrations, integration and cross-tenant isolation tests, upload validation, and
ledger reversal on every document edit path.

**Estimated:** 2–3 weeks to close Phase 3, at which point the system is defensible as a
book of record for a small business.
