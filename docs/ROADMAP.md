# Roadmap

Phased plan from the current state to a production-ready accounting SaaS. Ordered by risk,
not by visible feature count — the correctness work comes first because everything else
sits on top of it.

Effort estimates assume one experienced full-stack developer.

---

## Phase 0 — Audit and foundation ✅ **complete**

Delivered in this change.

- [x] Locate the application (it was stranded on a feature branch, not `main`)
- [x] Full audit with reproduced evidence → [`AUDIT.md`](AUDIT.md)
- [x] Replace the README, which described a non-existent WordPress plugin
- [x] Fix `npm run lint` (hung on an interactive prompt; CI lint was a silent no-op)
- [x] Integer-paise money engine → `src/lib/money.ts`
- [x] Correct GST engine → `src/lib/gst.ts`
- [x] 56 tests covering both
- [x] Fix three checksum-invalid seed GSTINs
- [x] Docker, Compose, `.dockerignore`, `/api/health` — build and runtime verified
- [x] Document all ~40 environment variables
- [x] Honest security posture → [`SECURITY.md`](SECURITY.md)
- [x] Architecture, database, API, GST, deployment and business documentation

**Not** done in Phase 0, deliberately: the new engines are **not yet wired into the invoice
routes**. `src/lib/utils.ts` `calcLineGST` is still in use and still has the defects. A
partial migration — some totals in paise, others in floats — would be worse than either
endpoint. That is Phase 1.

---

## Phase 1 — Correctness and security (3–4 weeks) 🔴 **blocking**

Nothing here is optional. Until it is finished, this application should not keep anyone's
books of record.

### 1.1 Wire in the money and GST engines (1 week)

- [ ] Migrate 93 `Float` money columns to integer paise (`…Paise`) — procedure in
      [`DATABASE.md`](DATABASE.md): add column, backfill, **verify**, then drop
- [ ] Replace `calcLineGST` with `computeGstInvoice()` in the invoice, purchase,
      credit-note, quotation and POS routes
- [ ] Add `cessRate`, `cessPerUnit`, `supplyType`, `pricingMode` to line-item models and forms
- [ ] Stop netting TDS into `grandTotal`; store it separately
- [ ] Reconciliation report over historical data to identify invoices affected by the
      discount-after-tax bug
- [ ] Extract logic from route handlers into `src/server/services/`

**Done when:** every invoice satisfies `taxable + tax + roundOff === grandTotal` exactly, and
a discounted invoice charges GST on the discounted value.

### 1.2 Security (1 week)

- [ ] Upgrade Next.js within 14.2.x; clear the 2 critical and 8 high advisories
- [ ] Upgrade `jspdf` (breaking — retest PDF templates) to drop the vulnerable `dompurify`
- [ ] Stop seeding a super-admin; separate `db:seed` from `db:seed:admin`
- [ ] `middleware.ts`: rate limiting, CSRF origin check, security headers
- [ ] Zod validation on all 49 routes
- [ ] `Secure` cookie flag in production
- [ ] Server-side session revocation, so logout and user deletion actually invalidate tokens
- [ ] Upload MIME/size validation
- [ ] Bound impersonation: expiry, mandatory reason, tenant-visible audit entry

### 1.3 Data integrity (3–4 days)

- [ ] `DocumentCounter` for atomic, gap-free, financial-year-scoped numbering
- [ ] `FinancialYear` with period locking, so filed periods cannot be edited
- [ ] Paginate all list endpoints (`GET /api/invoices` currently returns everything)
- [ ] Add the indexes listed in [`DATABASE.md`](DATABASE.md)

### 1.4 PostgreSQL (3–4 days)

- [ ] Switch the provider; adopt `prisma migrate` instead of `db push`
- [ ] Commit `prisma/migrations/`
- [ ] Postgres service container in CI; run tests and migrations there
- [ ] Connection pooling
- [ ] Keep the SQLite schema for the portable USB edition

### 1.5 CI (1 day)

- [ ] Run `npm test` in CI
- [ ] Run `npm audit --audit-level=high`
- [ ] Verify migrations and seed against Postgres

---

## Phase 2 — Real accounting (4–5 weeks)

What makes this a Tally alternative rather than an invoicing tool.

### 2.1 Double-entry ledger (2 weeks)

- [ ] `LedgerGroup`, `Ledger`, `JournalEntry`, `JournalEntryLine` (schema in
      [`DATABASE.md`](DATABASE.md))
- [ ] Default Indian chart of accounts, seeded per company
- [ ] `src/lib/accounting.ts` — one deterministic posting rule per document type
- [ ] Auto-post sales, purchases, payments, expenses, credit and debit notes
- [ ] Enforce debits = credits inside the transaction **and** as a DB constraint
- [ ] Manual journal vouchers
- [ ] Opening balances

**Done when:** every document produces a balanced posting and the trial balance is zero.
This is only checkable because amounts are integers — which is why Phase 1 comes first.

### 2.2 Financial statements (1 week)

- [ ] Trial balance
- [ ] Profit & loss
- [ ] Balance sheet
- [ ] Cash flow
- [ ] Drill-down from any figure to its source document
- [ ] Comparative periods

These become straightforward queries over `JournalEntryLine` once 2.1 exists.

### 2.3 GST returns (1–2 weeks)

- [ ] GSTR-3B
- [ ] ITC ledger with eligible/ineligible classification
- [ ] GSTR-2B reconciliation (upload, match, report mismatches)
- [ ] HSN summary and rate-wise tax report
- [ ] RCM report
- [ ] Compliance calendar with filing reminders
- [ ] CA export package

### 2.4 Year-end (3 days)

- [ ] Year closing with retained-earnings transfer
- [ ] Carry balances into the new year
- [ ] Lock closed years

---

## Phase 3 — Monetisation (3–4 weeks)

Revenue infrastructure. Nothing here matters until Phases 1–2 make the product trustworthy.

### 3.1 Payments (1.5 weeks)

- [ ] Razorpay subscriptions (test mode first)
- [ ] **Signature-verified, idempotent** webhooks
- [ ] Plan upgrade/downgrade with proration
- [ ] Dunning for failed payments
- [ ] GST-compliant invoices for your own subscriptions
- [ ] Billing history; cancellation flow

### 3.2 Plans and metering (1 week)

- [ ] Extend `src/lib/plan.ts` to the six tiers in [`BUSINESS_MODEL.md`](BUSINESS_MODEL.md)
- [ ] Usage metering per limit, enforced server-side
- [ ] Add-on purchase flow
- [ ] Coupons (partly built), referrals

### 3.3 Marketing surface (1 week)

- [ ] Landing and pricing pages with SEO
- [ ] Terms, Privacy, Refund, Cookie policies
- [ ] Onboarding wizard; demo mode
- [ ] Revenue dashboard: MRR, ARR, churn, conversion

### 3.4 CA / partner portal (1 week)

- [ ] Multi-client dashboard
- [ ] Client switching; bulk exports
- [ ] Commission tracking

The CA channel is the highest-leverage distribution available; treat this as a growth
feature, not an afterthought.

---

## Phase 4 — AI (2–3 weeks)

Strictly after the fundamentals. AI on top of wrong numbers produces confident wrong
answers.

- [ ] Provider abstraction with `mock` as the default (design in
      [`ARCHITECTURE.md`](ARCHITECTURE.md))
- [ ] `AiUsageLog`; per-tenant budgets enforced **before** the call
- [ ] Response caching; PII redaction
- [ ] **Bill OCR** — the highest-value feature; removes the most painful data entry
- [ ] **Natural-language reporting** in Hindi and English ("aaj kitni sale hui?")
- [ ] Expense categorisation — suggestions only, never auto-posted
- [ ] GST error detection; duplicate invoice/party detection
- [ ] Cash-flow and sales forecasting; stock reorder suggestions

**Non-negotiable:** AI never writes to the ledger. It proposes; a human approves. Every
feature degrades cleanly to unavailable when `AI_ENABLED=false`.

---

## Phase 5 — Depth and scale (ongoing)

- [ ] Hindi/English i18n with `next-intl` (currently English only despite the claim)
- [ ] E-invoice IRP integration via a GSP (fields already exist)
- [ ] E-way bill API integration
- [ ] Offline-first POS with sync
- [ ] Batch/expiry/serial tracking; FIFO and weighted-average valuation
- [ ] Manufacturing (BOM, work orders); payroll
- [ ] Customer and supplier portals
- [ ] Public API with keys and rate limits; webhooks
- [ ] White-label with custom domains
- [ ] E2E tests (Playwright); background jobs (`pg-boss`); Redis caching

---

## Sequencing rationale

**Why correctness before features.** A missing report is an inconvenience; a wrong tax total
is a liability that compounds silently. The discount-after-tax bug overcharges GST on every
discounted invoice — each one a document a customer may dispute and a return that overstates
liability. Shipping more features on that base multiplies the eventual cleanup.

**Why paise before double entry.** Double entry's guarantee is that debits equal credits
exactly. With floating-point amounts, a balanced entry can fail its own balance check for
reasons that have nothing to do with the accounting. The integer migration makes the
invariant checkable.

**Why AI last.** AI is the only component whose marginal cost scales with usage, and the only
one that can confidently produce wrong output. It is also the easiest to sell — which is
exactly why it must wait until the numbers underneath it are right.

**Why monetisation before AI.** Subscription revenue funds AI spend. Reversing the order
means paying for tokens before anyone is paying you.

---

## Minimum viable production release

The smallest scope that can responsibly keep a real business's books:

**Phase 1 in full, plus Phase 2.1 and 2.2.**

That yields: correct GST, exact money, real double-entry accounting, trial balance, P&L,
balance sheet, GSTR-1, secure multi-tenancy, PostgreSQL, and a tested deployment.
Approximately **7–9 weeks**.

Everything already built — POS, inventory, godowns, quotations, credit notes, bank
reconciliation, the super-admin panel, PWA, CSV import — comes along for free, because it
already works. It just needs to sit on arithmetic that reconciles.
