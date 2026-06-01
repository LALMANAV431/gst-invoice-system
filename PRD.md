# 📘 Product Requirements Document (PRD)
## GST Books — Portable GST Billing, Inventory & Accounting System

| | |
|---|---|
| **Product** | GST Books |
| **Document type** | Product Requirements Document (PRD) |
| **Version** | 2.0 (Full) |
| **Last updated** | June 2026 |
| **Author / Owner** | LALMANAV431 |
| **Status** | Live — MVP + advanced modules shipped |
| **Repository** | `LALMANAV431/gst-invoice-system` |

---

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Vision & Objectives](#3-vision--objectives)
4. [Success Metrics (KPIs)](#4-success-metrics-kpis)
5. [Target Users & Personas](#5-target-users--personas)
6. [User Journeys](#6-user-journeys)
7. [Scope (In / Out)](#7-scope-in--out)
8. [Functional Requirements (by module)](#8-functional-requirements-by-module)
9. [Data Model](#9-data-model)
10. [API Reference](#10-api-reference)
11. [UX, Screens & Navigation](#11-ux-screens--navigation)
12. [Non-Functional Requirements](#12-non-functional-requirements)
13. [Security, Privacy & Compliance](#13-security-privacy--compliance)
14. [Architecture & Tech Stack](#14-architecture--tech-stack)
15. [Deployment Models](#15-deployment-models)
16. [Monetization & Pricing](#16-monetization--pricing)
17. [Competitive Analysis](#17-competitive-analysis)
18. [Risks, Assumptions & Dependencies](#18-risks-assumptions--dependencies)
19. [Release Plan & Milestones](#19-release-plan--milestones)
20. [Glossary](#20-glossary)

---

## 1. Executive Summary

**GST Books** is a GST-compliant **billing, inventory and accounting** product
for Indian micro, small and medium businesses (MSMEs). It is a modern,
affordable alternative to **Tally ERP 9 / Tally Prime** and **Busy Accounting**.

The product is delivered in two interchangeable forms from a **single codebase**:

1. **Portable USB / Pendrive Edition** — runs directly from a USB drive using a
   bundled portable Node.js runtime. No installation, no admin rights; all data
   lives in an embedded SQLite file on the pendrive.
2. **Cloud SaaS Edition** — the same app deployed to the web (multi-user, online).

It covers the full quote-to-cash and purchase-to-pay cycles, GST returns
(GSTR-1, HSN summary, E-Invoice, E-Way Bill), inventory with godowns, financial
reporting, POS counter billing with a barcode scanner, and subscription billing.

---

## 2. Problem Statement

Indian MSMEs face three recurring pains with existing accounting software:

1. **Cost:** Tally/Busy licenses cost ₹15,000–₹54,000+, which is high for small
   shops and freelancers.
2. **Lock-in & portability:** Traditional software is installed per-machine.
   Moving books between a shop PC, home PC and the accountant's PC is painful.
3. **Complexity:** Legacy UIs are keyboard-heavy and intimidating for
   non-accountants; mobile/whatsapp-first workflows are missing.

**Opportunity:** A low-cost, portable, modern-UI product that runs from a
pendrive *or* the cloud, is GST-compliant, and is simple enough for a shopkeeper
yet powerful enough for an accountant.

---

## 3. Vision & Objectives

> **Vision:** "Carry your entire business books in your pocket — on a pendrive or
> in the cloud — and bill a GST invoice in under 30 seconds."

### Objectives
- **O1:** Deliver GST-correct invoicing (CGST/SGST/IGST, HSN, round-off, TDS).
- **O2:** Run fully offline from a USB pendrive with zero installation.
- **O3:** Provide the day-to-day modules of Tally/Busy at <10% of the price.
- **O4:** Keep customer data private and portable (local-first).
- **O5:** Monetize via tiered subscriptions (Free / Basic / Premium).

---

## 4. Success Metrics (KPIs)

| Metric | Target |
|--------|--------|
| Time to first invoice (fresh pendrive) | < 5 minutes |
| Time to create a standard GST invoice | < 30 seconds |
| Core billing flows working offline | 100% |
| Data loss across plug-out/plug-in cycles | 0 |
| Free → paid conversion (cloud) | ≥ 5% |
| Crash-free sessions | ≥ 99.5% |
| Monthly active companies (Year 1) | 1,000 |

---

## 5. Target Users & Personas

| Persona | Description | Primary needs | Key modules |
|---------|-------------|---------------|-------------|
| **Ravi — Retail shopkeeper** | Runs a mobile/electronics shop | Fast counter billing, stock, GST bills | POS, Items, Invoices |
| **Sunita — Distributor/Wholesaler** | Supplies to retailers | Purchases, party ledgers, outstanding, godowns | Purchases, Parties, Reports |
| **Mr. Verma — Accountant / CA** | Manages multiple clients' books | GSTR-1, ledgers, audit trail, exports | Reports, Audit, Export |
| **Anjali — Freelancer / Service biz** | Solo professional | Quotes → invoices, expenses, payment tracking | Quotations, Expenses, Payments |

**Roles within a company:** Admin, Accountant, Operator, Viewer (RBAC).

---

## 6. User Journeys

### 6.1 First-time setup (Pendrive)
1. Plug pendrive → double-click `START-GST-Books.bat`.
2. Browser opens at `localhost:3000` → register company (name, GSTIN, state).
3. Add a few items and a customer (or import via CSV).
4. Create first invoice → download PDF / share on WhatsApp.

### 6.2 Daily counter sale (POS)
1. Open **POS** → scan barcode (camera) or tap product → cart fills.
2. Select customer (default Walk-in) → **Complete Sale**.
3. Invoice created, stock auto-reduced, UPI QR shown for payment.

### 6.3 Month-end GST filing
1. Open **Reports → GSTR-1** → select month.
2. Review B2B / B2C / HSN summary → **Export JSON**.
3. Upload JSON to the GST portal.

### 6.4 Accountant review
1. Login as **Accountant/Viewer** role.
2. Open **Party Ledger** and **Outstanding & Aging**.
3. Export registers to CSV; check **Audit Trail** for changes.

---

## 7. Scope (In / Out)

### In Scope (v1 — shipped)
- Company setup, masters (parties, items, godowns).
- Sales, purchases, quotations, credit/debit notes, payments, expenses.
- POS billing with barcode scanning.
- GST computation, GSTR-1 JSON, E-Invoice IRN, E-Way Bill (simulated APIs).
- Reports (dashboard, day book, ledger, outstanding, P&L, stock, GST).
- Bank reconciliation (CSV), budgets, recurring invoices, audit trail.
- Auth + RBAC, subscription plans, PWA + dark mode, CSV import/export, PDF.
- Portable USB packaging + cloud deployment.

### Out of Scope (v1)
- Native desktop `.exe` (uses portable web server + browser instead).
- Real-time concurrent multi-PC editing of the *same* pendrive DB file.
- Direct government portal auto-filing (manual JSON upload instead).
- Payroll, manufacturing/BOM, multi-currency consolidation (roadmap).
- Live NIC/GSP E-Invoice signing (currently simulated; integration on roadmap).

---

## 8. Functional Requirements (by module)

> Notation: **US** = User Story, **AC** = Acceptance Criteria.
> Priority: **P0** (must), **P1** (should), **P2** (nice).

### 8.1 Authentication & Company (P0)
- **US:** As an owner, I can register with my company so I can start billing.
- **AC:**
  - Register creates a `User` + first `Company`; email is unique.
  - Login issues a JWT in an httpOnly cookie (30-day expiry).
  - Passwords hashed with bcrypt; invalid login returns 401.
  - Company stores GSTIN, PAN, address, state code, bank details, prefixes.

### 8.2 Parties (Customers/Vendors) (P0)
- **US:** As a user, I can manage customers and vendors with GSTIN and balances.
- **AC:**
  - CRUD parties; type = CUSTOMER / VENDOR / BOTH.
  - Opening balance with RECEIVABLE/PAYABLE direction.
  - Outstanding auto-computed from invoices, purchases, payments, notes.
  - **CSV import** with column auto-mapping; **CSV export**.

### 8.3 Items / Inventory (P0)
- **US:** As a user, I track products with HSN, GST rate, price and live stock.
- **AC:**
  - CRUD items: name, SKU, **barcode**, HSN, unit, sale/purchase price, GST rate.
  - Opening stock sets current stock; low-stock alert threshold.
  - Every sale/purchase/return updates stock via a `StockMovement` audit row.
  - CSV import/export.

### 8.4 Sales Invoices (P0)
- **US:** As a user, I create GST-compliant invoices that auto-calculate tax.
- **AC:**
  - Multi-line items; per-line discount; per-line GST rate.
  - Auto CGST+SGST (intra-state) vs IGST (inter-state) by comparing state codes.
  - Invoice-level discount, round-off, **TDS** (rate → auto deduction).
  - Sequential numbering with configurable prefix (e.g., `INV-0001`).
  - Stock auto-decrements; deleting an invoice restores stock.
  - PDF download, print view, WhatsApp & email share.
  - **Plan limit:** Free plan capped at 20 invoices/month (configurable).

### 8.5 Purchases (P0)
- **US:** As a user, I record vendor bills to track expenses and stock-in.
- **AC:** Mirror of invoices; stock auto-increments; vendor bill no. captured.

### 8.6 Quotations / Estimates (P1)
- **US:** As a user, I send quotes and convert accepted ones to invoices.
- **AC:**
  - Status: OPEN / ACCEPTED / CONVERTED / EXPIRED / REJECTED.
  - **Convert to Invoice** copies lines, deducts stock, links the invoice.

### 8.7 Credit / Debit Notes (P1)
- **US:** As a user, I handle sales returns (credit) and purchase returns (debit).
- **AC:**
  - Credit Note → stock IN, reduces customer receivable.
  - Debit Note → stock OUT, reduces vendor payable.
  - Reference to original document + reason captured.

### 8.8 Payments (P0)
- **US:** As a user, I record receipts/payments and track outstanding.
- **AC:**
  - Type RECEIVED/PAID; mode CASH/BANK/UPI/CHEQUE/CARD.
  - Linking to an invoice/purchase auto-updates status to Partial/Paid.
  - Deleting a payment reverses the status.

### 8.9 Expenses (P1)
- **US:** As a user, I log business expenses with category and GST.
- **AC:** Category, payment mode, amount + GST, optional vendor, monthly totals.

### 8.10 POS Quick Billing (P1)
- **US:** As a cashier, I bill quickly by scanning barcodes.
- **AC:**
  - Camera barcode scan (with manual entry fallback) matches item by barcode/SKU.
  - Product grid + search; cart with qty +/−; live totals.
  - **Complete Sale** creates an invoice and reduces stock.

### 8.11 Godowns & Stock Transfer (P1, Basic plan)
- **US:** As a user, I manage multiple warehouses and move stock between them.
- **AC:** CRUD godowns; transfer records OUT+IN stock movements.

### 8.12 GST & Compliance (P0/P1)
- **GSTR-1 (P0):** B2B / B2C / HSN summary for a period + **portal-style JSON export**.
- **E-Invoice (P1, Premium):** generate IRN (64-char), AckNo, AckDate, signed QR.
- **E-Way Bill (P1, Premium):** generate 12-digit EWB, enforce ₹50,000 threshold.
- **AC:** GSTIN-bearing parties → B2B; others → B2C; HSN grouped by rate.

### 8.13 Reports (P0)
- Dashboard (KPIs, 6-month sales/purchase trend, top items donut).
- **Day Book** (all vouchers chronologically).
- **Party Ledger** (running Dr/Cr balance, opening → closing).
- **Outstanding & Aging** (0–30 / 31–60 / 61–90 / 90+).
- **Profit & Loss**, sales & purchase registers, **stock report & valuation**.

### 8.14 Banking (P1, Premium)
- **Bank reconciliation:** import CSV statement, mark matched/unmatched.
- **UPI QR** on invoices for scan-to-pay.

### 8.15 Budgets (P1, Basic) & Recurring Invoices (P1, Premium)
- Budgets: set monthly budget per category.
- Recurring: define template + frequency for auto-generation.

### 8.16 Platform Features (P0/P1)
- **RBAC:** Admin / Accountant / Operator / Viewer.
- **Audit trail:** CREATE/UPDATE/DELETE logged with user + timestamp.
- **PWA:** installable, offline page; **dark mode** with persistence.
- **Exports:** PDF invoices; CSV for parties/items/invoices/purchases/payments.
- **Subscription plans** with server-side feature gating + usage meter.

---

## 9. Data Model

Core entities (Prisma + SQLite). Relationships scoped per `Company`.

| Entity | Key fields | Notes |
|--------|-----------|-------|
| **User** | email (unique), password, name, role | Owns companies; team membership |
| **TeamMember** | userId, companyId, role | RBAC join table |
| **Company** | name, gstin, pan, stateCode, prefixes, bank, **plan**, planExpiry | Tenant root |
| **Party** | name, type, gstin, openingBalance, balanceType | Customer/Vendor |
| **Item** | name, sku, **barcode**, hsn, unit, salePrice, purchasePrice, gstRate, currentStock, lowStockAlert | Inventory |
| **Invoice / InvoiceItem** | number, date, totals, cgst/sgst/igst, **tds**, **irn**, **ewayBillNo** | Sales |
| **Purchase / PurchaseItem** | number, vendorBillNo, totals | Purchases |
| **Quotation / QuotationItem** | number, validUntil, status, convertedInvoiceId | Estimates |
| **CreditNote / CreditNoteItem** | number, kind (CREDIT/DEBIT), reason, originalRef | Returns |
| **Payment** | number, type, mode, amount, invoiceId/purchaseId | Money in/out |
| **Expense** | number, category, amount, gstRate, total | Expenses |
| **StockMovement** | itemId, type (IN/OUT), quantity, reference | Stock audit |
| **Godown / StockTransfer** | name; from/to godown, quantity | Warehouses |
| **BankTransaction** | date, debit, credit, balance, isMatched | Reconciliation |
| **Budget** | category, period, amount | Budgeting |
| **RecurringInvoice** | name, frequency, nextRunDate, template | Automation |
| **AuditLog** | action, entity, entityId, userId, changes | Audit trail |

> Tax math per line: `taxable = qty×rate − discount`; `tax = taxable × gst%`;
> intra-state splits tax into CGST+SGST, inter-state uses IGST.

---

## 10. API Reference

All routes are under `/api/*`, return JSON, and require a valid session cookie
(except auth). Premium/Basic routes enforce plan gating (HTTP **402** + `upgrade`).

| Method & Path | Purpose |
|---------------|---------|
| `POST /api/auth/register` | Create user + company |
| `POST /api/auth/login` / `logout` | Session management |
| `GET/POST /api/parties` · `GET/PUT/DELETE /api/parties/[id]` | Parties CRUD |
| `POST /api/parties/import` | Bulk CSV import |
| `GET/POST /api/items` · `PUT/DELETE /api/items/[id]` | Items CRUD |
| `POST /api/items/import` | Bulk CSV import |
| `GET/POST /api/invoices` · `GET/DELETE /api/invoices/[id]` | Invoices |
| `POST /api/invoices/[id]/einvoice` | Generate IRN (Premium) |
| `POST /api/invoices/[id]/eway-bill` | Generate E-Way Bill (Premium) |
| `GET/POST /api/purchases` · `GET/DELETE /api/purchases/[id]` | Purchases |
| `GET/POST /api/quotations` · `POST /api/quotations/[id]/convert` | Quotations |
| `GET/POST /api/credit-notes` · `GET/DELETE /api/credit-notes/[id]` | Returns |
| `GET/POST /api/payments` · `DELETE /api/payments/[id]` | Payments |
| `GET/POST /api/expenses` · `DELETE /api/expenses/[id]` | Expenses |
| `GET/POST /api/godowns` · `GET/POST /api/stock-transfers` | Warehouses (Basic) |
| `GET/POST /api/bank-reconciliation` · `/match` | Banking (Premium) |
| `GET/POST /api/budgets` | Budgets (Basic) |
| `GET/POST /api/recurring-invoices` | Recurring (Premium) |
| `GET/POST/PUT/DELETE /api/team` | Team & roles (Premium) |
| `GET /api/export?type=...` | CSV export of masters |
| `PUT /api/company` · `POST /api/company/plan` | Settings & plan change |

---

## 11. UX, Screens & Navigation

**Primary navigation (sidebar):** Dashboard, POS Billing, Parties, Items,
Quotations, Sales Invoices, Purchases, Credit/Debit Notes, Payments, Expenses,
Godowns, Bank Recon, Budgets, Reports, Plans & Billing, Settings.

**Design principles**
- Modern, clean UI (Tailwind) with **dark mode**.
- Animations (Framer Motion): page transitions, KPI counters, hover lift.
- Mobile-responsive with an animated drawer; **PWA** install prompt.
- Print-optimized invoice layout; consistent INR formatting & amount-in-words.

---

## 12. Non-Functional Requirements

| Area | Requirement |
|------|-------------|
| **Portability** | Runs from USB on Windows 10/11 (also macOS/Linux), no install, no admin |
| **Performance** | Smooth with 10,000+ vouchers per company on SQLite |
| **Reliability** | ACID transactions for stock & ledger; safe invoice delete/restore |
| **Availability (cloud)** | 99.5%+ target |
| **Privacy** | Local-first; pendrive data never leaves the device |
| **Backup** | Copy the `Data/` folder; JSON/CSV exports |
| **Accessibility** | Keyboard-friendly forms, readable contrast in both themes |
| **Localization** | English UI; INR + Indian number/words; Hindi on roadmap |
| **Browser support** | Latest Chrome/Edge/Firefox; camera APIs for POS scanning |

---

## 13. Security, Privacy & Compliance

- **Auth:** JWT (httpOnly, SameSite=Lax, 30-day), bcrypt password hashing.
- **Tenant isolation:** every query is scoped by `companyId`.
- **RBAC:** Admin / Accountant / Operator / Viewer.
- **Audit trail:** immutable log of create/update/delete with user + timestamp.
- **Secrets:** `JWT_SECRET` configurable per deployment/pendrive.
- **GST compliance:** tax-invoice fields (GSTIN, HSN, tax breakup), round-off,
  E-Way threshold (₹50,000), GSTIN state-code-driven place-of-supply.
- **Data residency:** pendrive edition keeps 100% of data on the device.

---

## 14. Architecture & Tech Stack

- **Framework:** Next.js 14 (App Router) + React 18 + TypeScript.
- **Styling:** Tailwind CSS; **Framer Motion**; lucide-react icons; Recharts.
- **Data:** SQLite via **Prisma** ORM (engines bundled for Windows + Linux).
- **Auth:** JWT + bcryptjs.
- **Docs/Output:** jsPDF + jspdf-autotable (PDF), **qrcode** (UPI QR),
  **html5-qrcode** (barcode scan), **papaparse** (CSV).
- **Packaging:** `next build` (standalone) → `scripts/package-portable.mjs`.

---

## 15. Deployment Models

### 15.1 Portable USB / Pendrive (primary)
```
PENDRIVE\GSTBooks-Portable\
├── START-GST-Books.bat      ← double-click (Windows)
├── start-mac-linux.sh       ← macOS / Linux
├── README.txt
├── node\                    ← portable Node.js (node.exe)
├── app\                     ← standalone server + static + public + Prisma engines
│   ├── server.js
│   └── prisma\ (schema + seed.db)
└── Data\
    └── gstbooks.db          ← user's data (auto-created first run)
```
- Launcher sets `PORT`, `JWT_SECRET`, absolute `DATABASE_URL` to `Data\gstbooks.db`,
  seeds the DB on first run, starts the server, opens the browser.
- Build command: `npm run package:portable`. See **docs/USB-SETUP.md**.

### 15.2 Cloud SaaS (secondary)
- Deploy to Vercel/any Node host; swap SQLite → Postgres (Neon/Supabase) for
  concurrent multi-user; cron for recurring invoices.

---

## 16. Monetization & Pricing

| Plan | Price | Invoices/mo | Users | Highlights |
|------|-------|-------------|-------|-----------|
| **Free** | ₹0 | 20 | 1 | GST reports, WhatsApp share |
| **Basic** | ₹299/mo | Unlimited | 3 | + Godowns, Budgets, TDS |
| **Premium** | ₹999/mo | Unlimited | 25 | + E-Invoice, E-Way Bill, Bank recon, Recurring, Audit, Multi-user |

- Server-side **feature gating**; limit breaches return HTTP 402 + upgrade prompt.
- Pendrive edition can unlock plans locally; pricing primarily for cloud SaaS.
- Future: Razorpay/Stripe checkout + webhook activation (currently instant demo).

**Positioning vs market:** one-time ₹2,999 single-user / ₹5,999 multi-user
options (vs Tally ₹18,000+ / Busy ₹15,000+) for the portable edition.

---

## 17. Competitive Analysis

| Capability | GST Books | Tally Prime | Busy |
|------------|-----------|-------------|------|
| Price (entry) | Free / ₹299 mo / ₹2,999 one-time | ₹18,000+ | ₹15,000+ |
| Runs from pendrive (no install) | ✅ | ❌ | ❌ |
| Modern web UI + dark mode | ✅ | ❌ | ❌ |
| POS + camera barcode | ✅ | Partial | Partial |
| GSTR-1 JSON export | ✅ | ✅ | ✅ |
| E-Invoice / E-Way | ✅ (simulated→API) | ✅ | ✅ |
| WhatsApp/UPI QR on invoice | ✅ | Partial | Partial |
| Cloud + local from one app | ✅ | ❌ | Partial |

---

## 18. Risks, Assumptions & Dependencies

| # | Risk / Assumption | Mitigation |
|---|-------------------|-----------|
| R1 | Portable Node.js must be on the pendrive | Documented one-time step; engines pre-bundled |
| R2 | SQLite single-writer (no concurrent multi-PC on same file) | Cloud/Postgres edition for multi-user |
| R3 | E-Invoice/E-Way currently simulated | Swap to NIC/GSP API (roadmap), flow already wired |
| R4 | Antivirus may flag node.exe | Whitelist official Node.js; documented |
| R5 | Pendrive loss = data loss | Built-in backup guidance; encrypted-backup roadmap |
| A1 | Users have a modern browser + camera for POS | Manual barcode entry fallback provided |

---

## 19. Release Plan & Milestones

| Milestone | Contents | Status |
|-----------|----------|--------|
| **M1 — Core MVP** | Auth, parties, items, invoices, purchases, payments, reports, PDF | ✅ Done |
| **M2 — Advanced accounting** | Quotations, credit/debit notes, expenses, godowns, bank recon, budgets, recurring, audit, RBAC | ✅ Done |
| **M3 — Monetization & compliance** | Plans + gating, E-Invoice, E-Way, TDS, billing page | ✅ Done |
| **M4 — Free power-ups** | PWA + dark mode, UPI QR, POS barcode, CSV import | ✅ Done |
| **M5 — Portable + PRD** | Standalone build, USB packaging, launchers, full PRD | ✅ Done |
| **M6 — Integrations** | Real NIC/GSP e-invoice, Razorpay links, encrypted backup, Tally import | 🔜 Planned |

---

## 20. Glossary

| Term | Meaning |
|------|---------|
| **GSTIN** | GST Identification Number (15-char) |
| **HSN** | Harmonized System of Nomenclature (product tax code) |
| **CGST/SGST/IGST** | Central / State / Integrated GST |
| **IRN** | Invoice Reference Number (E-Invoice) |
| **E-Way Bill** | Electronic waybill for goods movement > ₹50,000 |
| **TDS** | Tax Deducted at Source |
| **B2B / B2C** | Business-to-Business / Business-to-Consumer supplies |
| **Receivable / Payable** | Money owed to you / by you |
| **Standalone build** | Self-contained Next.js server output for portability |
| **PWA** | Progressive Web App (installable, offline-capable) |

---

*This PRD reflects the current shipped product and its near-term roadmap.
For setup, see `README.md` and `docs/USB-SETUP.md`.*
