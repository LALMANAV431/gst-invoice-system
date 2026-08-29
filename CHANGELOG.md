# Changelog

All notable changes to this project are recorded here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/); versioning follows
[Semantic Versioning](https://semver.org/spec/v2.0.0.html).

**Money entries state their unit.** Several fixes below are hundred-fold errors caused by
mixing rupees and paise, so an amount without a unit is not a useful changelog line.

---

## [Unreleased]

Work on the `chore/audit-hardening-blueprint` branch, tracked by PR #2.

### Added — Documentation

- `docs/USER_GUIDE.md` — for the business owner and billing clerk, including a table of
  operations the software will deliberately refuse and why.
- `docs/ADMIN_GUIDE.md` — company administration (roles, period locking, policies, data
  rights) and platform operation (tenants, plans, flags, monitoring, backups).
- `docs/DEVELOPER_GUIDE.md` — conventions, and a **Traps** section documenting every real bug
  found in this repository so the same shapes are recognisable next time.
- `docs/INVENTORY_VALUATION.md` — the costing rules and the conservation invariant.
- `CONTRIBUTING.md`, issue templates and a pull request template.
- **`src/lib/openapi.ts`** — OpenAPI 3.1 description of all 74 documented endpoints,
  authored as TypeScript rather than YAML so that:
  - `src/lib/openapi.test.ts` walks `src/app/api`, derives the real endpoint surface from the
    files, and **fails if the spec and the code disagree in either direction** — an
    undocumented route or a documented route that does not exist;
  - enumerations are imported from the modules that define them, so the spec cannot
    contradict the code about what is allowed.
  Served at `GET /api/openapi`; `npm run docs:openapi` writes `docs/openapi.json`, and
  `npm run docs:openapi:check` fails if the committed file is stale.

### Fixed — Plan pricing was wrong on a fresh install

`PlanConfig.price` was declared "monthly in INR" and set to `299`, while
`getEffectivePlans()` overwrote the same field with `PlanSetting.priceMonthlyPaise` from the
database, and every consumer rendered it with `formatPaise()`.

The figure was therefore correct **only once a pricing override row existed**. A fresh
deployment fell back to the defaults and advertised:

| Plan | Advertised | Intended |
|---|---|---|
| Basic | **₹2.99** | ₹299 |
| Premium | **₹9.99** | ₹999 |

Estimated MRR on the admin dashboard was wrong by the same factor, and the admin pricing
form showed `29900` in a field labelled "Monthly ₹" — so correcting it by hand would have
saved ₹2.99.

Renamed to `priceMonthlyPaise` / `priceAnnualPaise`, converted the defaults with `toPaise()`,
and made the admin form edit rupees while storing paise. 15 tests now pin the actual rupee
amounts, assert every plan tier is a superset of the one below it, and assert prices increase
with tier.

---

## [1.0.0-rc.9] — Inventory valuation

### Added

- **Valuation engine** (`src/lib/inventory.ts`, pure, 60 tests): FIFO with receipt layers and
  moving weighted average, stock ageing, batch expiry classification, dead stock assessment.
- **Conservation invariant**, exact in integer paise, for both methods and through every
  negative-stock and rounding path:
  `openingValue + inValue === cogs + closingValue`. Asserted against 200 randomised movement
  streams with fractional quantities and deliberate over-issues.
- **Negative stock** is costed at the best known rate, disclosed as a quantity, then settled
  by the next receipt; the difference between the guess and the actual cost is recognised as a
  cost variance in COGS, where a correction on already-sold goods belongs.
- `StockAdjustment` — the reason code fixes the movement direction, so a "damage" cannot be
  filed as a stock increase.
- `PhysicalCount` — freezes the book quantity onto every line and pre-fills the counted
  column with it. Posting produces one adjustment; posted sheets are immutable.
- `Batch` — lot with manufacture and expiry dates, quantity driven only by movements.
- `GET /api/reports/inventory` with `valuation`, `ageing`, `dead`, `expiry` and per-item
  `ledger` views; `/api/stock-adjustments`, `/api/physical-counts`, `/api/batches`.
- `src/server/stock.ts` — `recordStockMovement()` is now the only way stock changes. All nine
  former hand-written call sites go through it.
- Seed asserts every item's cached quantity equals its movement-register balance.

### Fixed

- **Closing stock was valued at the current purchase price** (`currentStock *
  purchasePricePaise`), which is not a recognised method. Raising an item's price silently
  revalued stock already held, moving profit between periods with no transaction behind it.
  AS 2 requires cost assigned by FIFO or weighted average.
- **Credit note creation crashed on every call.** `note.id` was referenced inside
  `const note = await db.$transaction(...)`, i.e. inside its own temporal dead zone —
  a `ReferenceError`. The same latent shape existed in the quotation-to-invoice path.
- **`DELETE /api/items` was not tenant-scoped.** It deleted by id alone, so any signed-in user
  could delete another company's item by guessing an id. Now scoped, refuses items with stock
  history (movements cascade and would destroy valuation history), and audit-logged.
- **Editing an item's opening stock changed quantity without recording a movement**, putting
  the cached quantity out of agreement with the register valuation reads.
- **Dead stock was measured from `Item.createdAt`** — the row-creation date. An item imported
  today holding 120-day-old stock reported as 0 days idle. Now measured from the oldest
  remaining FIFO layer.
- Stock transfers labelled movements with the godown's ID instead of its name.

### Changed

- `PUT /api/company` returns `409 VALUATION_RESTATEMENT` unless a change of
  `stockValuationMethod` carries `acknowledgeRestatement: true`. Valuation is derived, so
  switching restates closing stock and COGS for every past period; AS 2 requires a change of
  accounting policy to be deliberate and disclosed.
- Purchase cost of inventory now excludes GST for a regular dealer (recoverable as input
  credit) and includes it for a composition dealer (who cannot claim it). Getting this
  backwards misstates closing stock and gross profit by the whole tax amount.
- Stock adjustments, counts, challans and GRNs post **nothing** to the ledger. Under periodic
  inventory the goods were already charged to `Purchases` on receipt; a second entry would
  double-count the loss.

---

## [1.0.0-rc.8] — Two-factor authentication and data rights

### Added

- **TOTP** written from scratch (`src/lib/totp.ts`, 30 tests) and validated against the five
  published RFC 6238 test vectors. No new dependency: the algorithm is less supply-chain
  surface than a package, and the security-critical parts stay visible.
  - The counter is written as two 32-bit halves, because a JavaScript shift is 32-bit and
    `>>> 32` would make every code beyond 2³² collide.
  - Verification returns the matched counter so the caller can reject a **replayed** code.
- **Two-step enrolment.** `POST /api/me/2fa` issues a secret and URI but does not enable
  anything; `PUT` confirms with a live code. A mis-scanned QR must not be able to lock a user
  out of their own books permanently.
- **Eight recovery codes**, issued once, hashed with SHA-256 (high-entropy values with no
  dictionary to slow), and **consumed by removal** rather than a used-flag — a flag somebody
  forgets to check is a code that still works.
- Login verifies password and second factor in **one request**, so there is never a
  half-authenticated session to steal. A password-only attempt returns
  `{ twoFactorRequired: true }` and sets no cookie.
- `GET /api/me/data` — DPDP data export, admin only, 3/hour, excluding password hashes, TOTP
  secrets and recovery hashes, and stating its monetary unit.
- `DELETE /api/me/data` — DPDP erasure. Requires password and exact company name. Returns
  `409 RETENTION_WARNING` when records fall inside the 8-year GST retention window, requiring
  `acknowledgeRetention: true`. GST retention and DPDP erasure genuinely conflict; the tenant
  makes an informed decision rather than the software silently choosing.

### Fixed

- **The data export contained zero users.** It queried `TeamMember` only, but the company
  owner is linked through `Company.ownerId`.
- `{ role: m.role, ...m.user }` — the spread overwrote the company-scoped role with the
  account role. Now named apart as `companyRole` and `accountRole`.

### Security

- Disabling two-factor authentication requires the current password and revokes every
  session. A hijacked session must not be able to remove the factor that would have stopped
  it.

---

## [1.0.0-rc.7] — Notifications

### Added

- **Reminders derived from current state** with a dedupe key, not scheduled events. Safe to
  re-run, and they clear themselves when the cause is resolved — no cron or queue needed.
  - `INVOICE_OVERDUE` bucketed at 1/7/30/60 days, with the bucket in the key so each
    escalation is a new alert rather than daily noise.
  - `LOW_STOCK`, `GST_DUE`, `GRN_NOT_INVOICED` (weekly), `BOOKS_UNBALANCED` (critical, keyed
    on the difference).
- `Notification` with `@@unique([companyId, dedupeKey])` as the idempotency guard.
- Email with a **mock provider as the default**, so nothing is silently sent in development.
  SMTP is reported as unsupported rather than ignored. User-controlled text is HTML-escaped
  before templating.
- Outbound webhooks, HMAC-SHA256 signed, auto-disabled after 20 consecutive failures.
- `NotificationBell` polling only while the tab is visible.

### Security

- `POST /api/webhooks` is admin-only, HTTPS-only, and refuses loopback, link-local
  (`169.254.169.254`) and RFC1918 addresses. Without that, the endpoint is a server-side
  request forgery primitive.
- Payment-reminder sending is rate limited per company **and** per IP, because the outbound
  address is shared across tenants.

### Fixed

- Notifications were ordered by severity as a string, which sorts
  `CRITICAL, INFO, WARNING` alphabetically. Now ranked explicitly.
- `npm run db:seed` was failing with an opaque `P2003` because the wipe list had not been
  extended for new tables. This was invisible because an earlier verification run piped seed
  output to `/dev/null`, so an empty database reached a passing-looking check.

---

## [1.0.0-rc.6] — Payment gateway

### Added

- Provider-agnostic gateway with **mock as the default**, so the flow is demonstrable with no
  credentials. Mock still requires a valid HMAC signature — skipping verification in mock
  would leave the most security-critical path untested until production.
- `PaymentLink` keyed by an unguessable public token rather than the row id, since the pay
  page is reachable without a session.
- `POST /api/payments/webhook` — signature verified over the **raw** body, with 400 for a bad
  signature (so the gateway stops retrying), 200 with `{ duplicate: true }` for a replay, and
  500 only for our own failures. Unverified bodies are never logged.
- Public `/pay/[token]` page exposing only the invoice number, amount and who is asking.

### Security

- **Idempotency by inserting the webhook event first**, inside the settlement transaction, so
  a concurrent duplicate violates a unique constraint and rolls the whole thing back.
  Check-then-insert races between two deliveries of the same event.
- Timing-safe signature comparison, with the length check first because
  `timingSafeEqual` throws on unequal lengths.

---

## [1.0.0-rc.5] — Orders, challans, purchase orders, GRNs

### Added

- One `OrderDocument` table with a `docType` discriminator for all four documents, rather than
  eight near-duplicate models and four copies of every query.
- Partial fulfilment: delivering part of an order marks it `PARTIAL` with the balance
  outstanding.
- Delivery challans capture transporter, vehicle and movement reason, as GST requires when
  goods move without an invoice.
- "Goods received not invoiced" report.

### Changed

- Stock moves for delivery challans (out) and GRNs (in) only; orders are commitments and move
  nothing. **Stock is never counted twice** — converting a challan to an invoice does not
  issue the goods again.

---

## [1.0.0-rc.4] — Accounting completion

### Added

- Manual journal and contra vouchers, with a live balance indicator showing the exact
  shortfall and which side is short.
- Cash and bank book with a running balance, showing contra ledger names as particulars.
- Cash flow statement, direct method, apportioning each cash movement across its counterparts
  pro-rata so compound vouchers split correctly.
- Financial year closing: posts one entry moving every income and expense balance to retained
  earnings. Reopening also deletes that voucher, or income and expenses would stay zeroed.

### Security

- `POST /api/journal-entries` verifies every ledger id belongs to the caller's company.
  Without that check, a crafted request could post into another tenant's books.

### Fixed

- The seed hardcoded the financial year to `2025-26` while demo transactions were dated
  relative to today, so the year contained **no data**: period locking had nothing to guard
  and year-closing reported nothing to close. The features existed but could not be
  demonstrated.

---

## [1.0.0-rc.3] — Hindi/English UI and the AI layer

### Added

- Typed translation dictionaries. `hi.ts` is typed against the English keys, so **a missing
  Hindi key is a compile error**. There is no runtime fallback — a half-translated screen is
  worse than an untranslated one, and silent fallback is how you ship one.
- GST and accounting terms (CGST, SGST, IGST, HSN, GSTIN, TDS, Cess) deliberately stay
  English in the Hindi dictionary; translating them would be correct Hindi and a usability
  regression. A test asserts this, and that everything else *is* translated.
- Locale stored on the user, not in a cookie, so the choice follows them across devices.
- AI provider abstraction with a **deterministic mock as the default**. The application is
  fully functional with no AI key; endpoints report unavailability rather than failing.
- Token budget checked **before** the call, not after.
- PII redaction before anything leaves the process, with GSTIN matched before PAN so the
  longer pattern wins.
- The assistant is grounded in real ledger figures gathered server-side. The model phrases
  them; it never computes a number and never writes to the ledger.
- Bill OCR returns a **draft** with `requiresReview: true`, and the server independently
  re-checks the GSTIN checksum and that taxable + tax = total, so a misread is caught before
  a user sees it.
- Upload validation by **magic bytes**, not the declared MIME type. SVG is excluded as an
  XSS vector.

### Fixed

- PII redaction used a global counter, producing `[PHONE_2]` with no `[PHONE_1]`, so
  rehydration could not map values back.

---

## [1.0.0-rc.2] — Money, GST and security

Nine defects were proven numerically in the audit before this work; each is fixed here.

### Changed — BREAKING (schema)

- **93 `Float` money columns migrated to integer paise**, in fields suffixed `Paise`.
  Reproducible failure in the old code: 100 lines of `qty 3 x rate 33.33` accumulated to
  `9998.999999999984` instead of `9999`.

### Fixed

- **Discount was applied after tax.** A ₹1,000 discount on a ₹10,000 invoice at 18%
  overcharged GST by ₹180 on every discounted invoice — each one a document a customer could
  dispute and a return that overstated liability. Section 15(3) of the CGST Act requires the
  discount first: tax is now ₹1,620, not ₹1,800.
- **Compensation cess was not implemented at all.** Added as a rate, a per-unit amount, or
  both.
- **Exempt, nil-rated, non-GST and zero-rated supplies were indistinguishable.** They are four
  different boxes on GSTR-1 even though three charge 0%.
- **TDS was netted into the grand total**, understating sales and GST. It is now shown
  separately; the invoice remains for the full amount.
- **Odd-paise CGST/SGST splits were asymmetric and did not always reconcile.**
  `splitPaise()` now distributes the remainder explicitly and the halves always sum back
  exactly.
- **All three seeded GSTINs were checksum-invalid.** Validation was added (checked against
  two published GSTINs) and the seed corrected to valid fictional numbers.
- **Document numbering had a race.** The next number was read outside the transaction, so two
  concurrent requests computed the same one; the unique constraint turned it into a 500 and
  left a gap in a series GST requires to be gap-free. Replaced with an atomic per-year
  counter allocated inside the caller's transaction.
- **There was no double-entry accounting.** Added a chart of accounts, journal postings for
  every document, and trial balance, profit and loss, balance sheet and GST summary derived
  from them.

### Security

- Rate limiting, CSRF origin checks, security headers and a content security policy via
  middleware.
- Zod validation on every write endpoint (previously 2 of 49).
- Server-side session revocation.
- Both critical dependency vulnerabilities cleared; 16 advisories reduced to 5 high, all of
  which require `next@16` — deliberately deferred so that a mechanical `await` migration is
  not mixed into a release containing GST logic changes.
- The seeded demo account no longer has platform-wide powers. `npm run db:seed` creates a
  tenant; `npm run db:seed:admin` creates a super-admin explicitly, with a password you
  supply.

---

## [1.0.0-rc.1] — Audit

### Added

- `docs/AUDIT.md`, `ARCHITECTURE.md`, `DATABASE.md`, `API.md`,
  `GST_COMPLIANCE_NOTES.md`, `DEPLOYMENT.md`, `BUSINESS_MODEL.md`, `ROADMAP.md`.
- `Dockerfile`, `docker-compose.yml`, `.env.example`, health check endpoint.
- `.eslintrc.json` — linting previously hung on an interactive setup prompt, so it had never
  run in CI.
- Money and GST engines with 56 tests.

### Fixed

- **The README described this project as a WordPress plugin and theme requiring PHP and
  MySQL.** It is a Next.js + TypeScript + Prisma application. The working code was also
  stranded on a feature branch, ten commits ahead of `main`, so a reader of the default
  branch would have found only that README.

---

## [0.x] — Pre-audit history

Commits `1c996d9` … `24979a8`. The feature surface — invoicing, purchases, POS, inventory,
GST reports, the super-admin panel, plans, PWA — was built in this period and is the reason
the project was repaired rather than rewritten. The correctness and security defects listed
under `1.0.0-rc.2` all date from here.
