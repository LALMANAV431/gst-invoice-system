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
| Payment gateway, AI features, e-invoice IRP integration | Not built — see roadmap |
| Hindi UI translation | Not built — English only today |

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

**98 tests** cover the money, GST and accounting engines. The seed refuses to finish if the
books it creates do not balance, and `/reports/trial-balance` shows the live position.

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
| `npm run package:portable` | Build the portable USB edition |

---

## Features

**Sales** — quotations, sales invoices, POS billing with barcode scanning, credit notes,
recurring invoices, e-invoice and e-way bill fields, PDF export, UPI QR, WhatsApp share.

**Purchases** — purchase invoices, supplier ledgers, purchase registers, debit notes.

**Inventory** — products and services, HSN/SAC, multiple godowns, stock movements, stock
transfers, low-stock alerts, opening stock, barcode support.

**Accounting** — payments and receipts with invoice allocation, expenses, bank
transactions with reconciliation matching, budgets, day book, party ledgers, outstanding
and ageing reports.

**GST** — intra-state CGST/SGST vs inter-state IGST, place-of-supply logic, GSTR-1 export,
TDS fields, GSTIN capture.

**Multi-tenant SaaS** — companies as tenants, team members with roles
(`ADMIN`/`ACCOUNTANT`/`OPERATOR`/`VIEWER`), plan limits (Free/Basic/Premium), coupons,
support tickets, broadcasts, feature flags, audit log, super-admin panel with
impersonation.

**Platform** — PWA with offline shell, dark mode, CSV import, portable USB build.

For what is *not* built yet — double-entry ledger, trial balance, P&L, balance sheet,
GSTR-3B, e-invoice IRP integration, payment gateway, AI features — see
[`docs/ROADMAP.md`](docs/ROADMAP.md).

---

## Documentation

| Document | Contents |
|---|---|
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

1. Branch from `main`.
2. Keep `npm run lint`, `npm run typecheck` and `npm test` green.
3. Any change touching money or GST **must** come with tests. See
   `src/lib/gst.test.ts` for the expected style — assert against
   independently-known-correct values, not against whatever the implementation
   currently returns.
4. Never commit `.env`, real GSTINs, PANs, bank details or API keys.

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
