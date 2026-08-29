# GST Invoice System

Affordable GST invoicing, inventory and accounting for Indian businesses — built as a
multi-tenant SaaS web application.

> **Note on the previous README:** it described this project as a *WordPress plugin and
> theme* requiring PHP and MySQL. That was inaccurate. This is a **Next.js + TypeScript +
> Prisma** application. No WordPress, PHP or MySQL is involved. See
> [`docs/AUDIT.md`](docs/AUDIT.md) for the full audit that corrected this.

---

## Status

| Area | Status |
|---|---|
| Auth, multi-tenant scoping, RBAC | Working |
| Invoices, purchases, quotations, credit notes, POS, expenses | Working |
| Inventory, stock movements, godowns, stock transfers | Working |
| **Money stored as integer paise** | **Working — migrated from `Float`** |
| **GST: discount before tax, cess, exempt/nil/zero-rated, RCM, inclusive pricing** | **Working** |
| **Double-entry ledger, trial balance, P&L, balance sheet, GST summary** | **Working** |
| **Atomic gap-free document numbering** | **Working** |
| **Rate limiting, CSRF origin checks, security headers, session revocation** | **Working** |
| GSTR-1 export, day book, party ledger, outstanding | Working |
| PDF invoices, UPI QR, CSV import, PWA, dark mode | Working |
| Super-admin panel, plans, coupons, tickets, audit log | Working |
| **Hindi + English UI** | **Working — a missing translation is a compile error** |
| **Inventory valuation: FIFO / weighted average, COGS, ageing, dead stock, batch expiry** | **Working** |
| **Stock adjustments and physical stock counts** | **Working** |
| **Payment links + signature-verified idempotent gateway webhooks** | **Working (mock gateway by default)** |
| **Notifications, reminders, email, outbound webhooks** | **Working (mock email by default)** |
| **Two-factor authentication (TOTP) + DPDP data export / erasure** | **Working** |
| **AI: bill OCR, assistant, expense categorisation** | **Working — optional, mock provider by default** |
| **Journal + contra vouchers, cash book, cash flow, year closing** | **Working** |
| **Sales orders, delivery challans, purchase orders, GRNs** | **Working** |
| **OpenAPI 3.1 spec, kept in sync with the routes by a test** | **Working — `GET /api/openapi`** |
| E-invoice IRP / e-way bill integration | Endpoints exist; needs GSP credentials |

### Correctness

Money is stored as **integer paise** throughout and GST is computed by a single tested
engine. The defects the original code carried are fixed and covered by regression tests:

| Was | Now |
|---|---|
| 93 `Float` money columns; `3 × ₹33.33 × 100` summed to `9998.999999999984` | Integer paise; sums exactly to `9999` |
| ₹1,000 discount on ₹10,000 @18% charged ₹1,800 GST (**₹180 overcharge**) | Discount apportioned pro-rata **before** tax → ₹1,620 |
| No compensation cess | Cess by rate and per unit (tobacco, vehicles, aerated drinks) |
| Exempt / nil-rated / non-GST / zero-rated indistinguishable | Explicit supply types, preserved per line |
| TDS subtracted from invoice total | Invoice face value intact; TDS reported separately |
| Invoice numbers allocated outside the transaction (raced) | Atomic counter inside the transaction, FY-scoped |
| No ledger; reports summed document tables | Double-entry ledger; every document posts a balanced entry |

Inventory valuation was the same class of defect: closing stock was valued at the item's
**current** purchase price, so raising a supplier's price silently revalued stock already held
and moved profit between periods. It is now assigned by FIFO or weighted average from the
stock movement register, with an invariant that holds exactly in integer paise:

```
openingValue + inValue === costOfGoodsSold + closingValue
```

**321 tests** cover the money, GST, accounting, inventory, TOTP, i18n, AI, payment and
notification layers, including a 200-case randomised property test for that invariant. The
seed refuses to finish if the books it creates do not balance, or if any item's stock quantity
disagrees with its movement register.

Still not production-ready — see [`SECURITY.md`](SECURITY.md) and
[`docs/ROADMAP.md`](docs/ROADMAP.md). The main gaps are a Next.js 16 upgrade (5 open `high`
advisories), PostgreSQL migration, and no test coverage above the domain layer.

---

## Tech stack

| Layer | Choice |
|---|---|
| Framework | Next.js 14 (App Router, React Server Components) |
| Language | TypeScript 5 |
| UI | Tailwind CSS 3, Lucide icons, Framer Motion, Recharts |
| Database | Prisma 5 ORM — SQLite today, PostgreSQL recommended for production |
| Auth | JWT in an `httpOnly` cookie, bcrypt password hashing |
| PDF | jsPDF + jspdf-autotable |
| Validation | Zod |
| Tests | Vitest |
| Deployment | Docker multi-stage build, GitHub Actions CI |

---

## Quick start

**Requirements:** Node.js 20+ and npm. No database server needed for local development —
SQLite is used by default.

```bash
git clone https://github.com/LALMANAV431/gst-invoice-system.git
cd gst-invoice-system

npm install

cp .env.example .env
# Set JWT_SECRET in .env. Generate one with:
#   openssl rand -base64 48

npm run db:setup     # creates the schema and loads demo data
npm run dev
```

Open <http://localhost:3000>.

### Demo credentials

| Field | Value |
|---|---|
| Email | `demo@gst.com` |
| Password | `demo1234` |

This account is a **tenant admin only**. It comes with a demo company, customers,
suppliers, products, invoices, a purchase and opening capital — enough that the ledger,
trial balance, P&L and balance sheet all have real data.

It is deliberately **not** a platform super-admin. The seed used to grant `isSuperAdmin`
to these published credentials, which handed full platform control — including tenant
impersonation — to anyone who seeded a public deployment. Create a super-admin explicitly:

```bash
npm run db:seed:admin -- --email you@example.com --password '<strong-password>'
```

The script enforces a minimum password strength and refuses obvious words.

---

## Docker

```bash
cp .env.example .env          # set JWT_SECRET
docker compose up --build

# First run only — create the schema and load demo data:
docker compose --profile setup run --rm migrate
```

- App: <http://localhost:3000>
- Health check: <http://localhost:3000/api/health>

The default compose service uses SQLite, matching the current Prisma schema. A PostgreSQL
service is available under the `postgres` profile but requires switching the schema
provider first — see [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md).

---

## npm scripts

| Script | Purpose |
|---|---|
| `npm run dev` | Start the dev server |
| `npm run build` | Generate the Prisma client and build for production |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | Run the Vitest suite once |
| `npm run test:watch` | Vitest in watch mode |
| `npm run db:push` | Sync the schema to the database |
| `npm run db:seed` | Load demo data (tenant admin only) |
| `npm run db:seed:admin` | Create/promote a platform super-admin |
| `npm run db:setup` | `db:push` + `db:seed` |
| `npm run docs:openapi` | Regenerate `docs/openapi.json` from `src/lib/openapi.ts` |
| `npm run docs:openapi:check` | Fail if that file is stale (runs in CI) |
| `npm run package:portable` | Build the portable USB edition |

---

## Features

**Sales** — quotations, sales invoices, POS billing with barcode scanning, credit notes,
recurring invoices, e-invoice and e-way bill fields, PDF export, UPI QR, WhatsApp share.

**Purchases** — purchase invoices, supplier ledgers, purchase registers, debit notes.

**Orders and goods movement** — sales orders, delivery challans (with transporter, vehicle
and movement reason), purchase orders, goods receipt notes, partial fulfilment tracking, and
a goods-received-not-invoiced report.

**Inventory** — products and services, HSN/SAC, multiple godowns, stock transfers,
low-stock alerts, barcode support, and a full stock register. Valuation by **FIFO or weighted
average** with cost of goods sold, stock ageing, dead-stock and batch-expiry reports, stock
adjustments with fixed reason codes, and physical stock counts that post their variance as a
single audited adjustment.

**Accounting** — double-entry ledger with a standard chart of accounts, manual journal and
contra vouchers, payments and receipts with invoice allocation, expenses, bank reconciliation,
budgets, day book, party ledgers, outstanding and ageing, cash and bank book, cash flow
(direct method), and financial-year locking and closing.

**Statements** — trial balance, profit and loss, balance sheet, GST summary.

**GST** — intra-state CGST/SGST vs inter-state IGST, place-of-supply logic, compensation cess
(rate and per unit), the four zero-rate supply types kept distinct, reverse charge, composition
scheme, inclusive/MRP pricing, discount before tax, TDS reported separately, round-off,
GSTIN checksum validation, GSTR-1 export with JSON.

**Payments** — payment links with unguessable tokens, signature-verified idempotent gateway
webhooks, partial settlement. Runs against a mock gateway with no credentials.

**Notifications** — in-app centre, escalating overdue reminders, low-stock, GST-due and
books-unbalanced alerts, email, and HMAC-signed outbound webhooks.

**Security** — TOTP two-factor authentication with recovery codes, revocable sessions, rate
limiting, CSRF origin checks, content security policy, magic-byte upload validation, audit
log, and DPDP data export and erasure with GST retention warnings.

**AI (optional)** — bill OCR into a reviewable draft, a natural-language assistant grounded in
real ledger figures, and expense categorisation. Runs on a deterministic mock provider by
default; the application is fully functional with no API key.

**Multi-tenant SaaS** — companies as tenants, team members with roles
(`ADMIN`/`ACCOUNTANT`/`OPERATOR`/`VIEWER`), plan limits (Free/Basic/Premium), coupons,
support tickets, broadcasts, feature flags, super-admin panel.

**Platform** — Hindi and English UI, PWA with offline shell, dark mode, CSV import,
OpenAPI 3.1 spec at `GET /api/openapi`, Docker, portable USB build.

For what is *not* built — e-invoice IRP integration, e-way bill API, serial-number tracking,
manufacturing, customer portal — and for what was deliberately deferred and why, see
[`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## Documentation

| Document | Contents |
|---|---|
| [`docs/USER_GUIDE.md`](docs/USER_GUIDE.md) | **Start here if you use the app.** Billing, GST, stock, reports |
| [`docs/ADMIN_GUIDE.md`](docs/ADMIN_GUIDE.md) | Company administration, and running the platform |
| [`docs/DEVELOPER_GUIDE.md`](docs/DEVELOPER_GUIDE.md) | **Start here to contribute.** Conventions, and traps that have bitten |
| [`docs/INVENTORY_VALUATION.md`](docs/INVENTORY_VALUATION.md) | FIFO/weighted average, COGS, the conservation invariant |
| [`docs/openapi.json`](docs/openapi.json) | OpenAPI 3.1 spec, also served at `GET /api/openapi` |
| [`CHANGELOG.md`](CHANGELOG.md) | What changed, with the wrong numbers and the right ones |
| [`CONTRIBUTING.md`](CONTRIBUTING.md) | How to contribute, and the review checklist |
| [`docs/AUDIT.md`](docs/AUDIT.md) | Repository audit: findings, evidence, severity |
| [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) | Target architecture, folder layout, AI service design |
| [`docs/DATABASE.md`](docs/DATABASE.md) | Current and target schema, double-entry model |
| [`docs/API.md`](docs/API.md) | Endpoint reference and conventions |
| [`docs/GST_COMPLIANCE_NOTES.md`](docs/GST_COMPLIANCE_NOTES.md) | GST formulas, worked examples, disclaimer |
| [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) | Docker, PostgreSQL migration, hosting, backups, checklist |
| [`docs/BUSINESS_MODEL.md`](docs/BUSINESS_MODEL.md) | Pricing, revenue streams, growth, unit economics |
| [`docs/ROADMAP.md`](docs/ROADMAP.md) | Phased plan from current state to production |
| [`SECURITY.md`](SECURITY.md) | Security posture, known issues, reporting |
| [`PRD.md`](PRD.md) | Original product requirements document |

---

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md) for the full guide. The essentials:

1. Branch from `main`. Keep `npm run lint`, `npm run typecheck`, `npm test` and
   `npm run build` green.
2. Any change touching money or GST **must** come with tests. See `src/lib/gst.test.ts` for
   the expected style — assert against independently-known-correct values, not against
   whatever the implementation currently returns.
3. Money is **integer paise**, in fields named `...Paise`. Never a float.
4. `companyId` comes from the session, never from a request body.
5. New endpoints must be described in `src/lib/openapi.ts` — a test fails until they are.
6. Never commit `.env`, or real GSTINs, PANs, Aadhaar numbers, bank details or API keys.

---

## Licence

No licence file is currently present, which means the code is **"all rights reserved"** by
default and nobody else may legally use, copy or distribute it. That may be exactly what
you want for a commercial SaaS. Decide deliberately:

- **Commercial SaaS, closed source** — keep it unlicensed, or add a proprietary
  `LICENSE` stating all rights reserved. Best fit for the business model in
  [`docs/BUSINESS_MODEL.md`](docs/BUSINESS_MODEL.md).
- **Open core** — AGPL-3.0 for the core plus a commercial licence for white-label
  resellers. AGPL requires anyone running a modified version as a network service to
  publish their changes, which discourages competitors from reselling your work.
- **Fully permissive** — MIT or Apache-2.0. Maximum adoption, but a competitor could
  legally launch a rival service using your code.

All current runtime dependencies are MIT/ISC/Apache-2.0 licensed, so any of these choices
is compatible. Confirm with a lawyer before you start selling.

---

## Disclaimer

This software helps you produce GST documents and reports. It is not tax, legal or
accounting advice. GST rates, cess schedules, place-of-supply rules and return formats
change. Have a practising Chartered Accountant review your configuration and your returns
before you file. See [`docs/GST_COMPLIANCE_NOTES.md`](docs/GST_COMPLIANCE_NOTES.md).
