# 📘 Product Requirements Document (PRD)
## GST Books — Portable GST Billing, Inventory & Accounting System

> **PRD = Product Requirements Document** — the single source of truth that
> describes *what* we are building, *for whom*, *why*, and *how success is measured*.

| | |
|---|---|
| **Product** | GST Books |
| **Document type** | Product Requirements Document (PRD) |
| **Version** | 3.0 (Advanced) |
| **Last updated** | June 2026 |
| **Author / Owner** | LALMANAV431 |
| **Status** | Live — MVP + advanced modules shipped |
| **Pricing model** | **Subscription only** (monthly / annual). No one-time license. |
| **Repository** | `LALMANAV431/gst-invoice-system` |

---

## Table of Contents
1. [Executive Summary](#1-executive-summary)
2. [Problem Statement](#2-problem-statement)
3. [Vision & Objectives](#3-vision--objectives)
4. [Success Metrics (KPIs) & North Star](#4-success-metrics-kpis--north-star)
5. [Target Users & Personas](#5-target-users--personas)
6. [User Journeys](#6-user-journeys)
7. [Information Architecture & Navigation Map](#7-information-architecture--navigation-map)
8. [Scope (In / Out)](#8-scope-in--out)
9. [Functional Requirements (by module)](#9-functional-requirements-by-module)
10. [Status / State Machines](#10-status--state-machines)
11. [GST Calculation Rules & Edge Cases](#11-gst-calculation-rules--edge-cases)
12. [Data Model](#12-data-model)
13. [API Reference](#13-api-reference)
14. [UX, Screens & Navigation](#14-ux-screens--navigation)
15. [Non-Functional Requirements](#15-non-functional-requirements)
16. [Security, Privacy & Compliance](#16-security-privacy--compliance)
17. [Architecture & Tech Stack](#17-architecture--tech-stack)
18. [Deployment Models](#18-deployment-models)
19. [Monetization & Pricing (Subscription)](#19-monetization--pricing-subscription)
20. [Revenue Model & Projections](#20-revenue-model--projections)
21. [Competitive Analysis](#21-competitive-analysis)
22. [Analytics & Telemetry](#22-analytics--telemetry)
23. [Testing & QA Strategy](#23-testing--qa-strategy)
24. [Internationalization & Accessibility](#24-internationalization--accessibility)
25. [Support, SLA & Onboarding](#25-support-sla--onboarding)
26. [Stakeholders & RACI](#26-stakeholders--raci)
27. [Risks, Assumptions & Dependencies](#27-risks-assumptions--dependencies)
28. [Release Plan & Milestones](#28-release-plan--milestones)
29. [Open Questions](#29-open-questions)
30. [Glossary](#30-glossary)
31. [Change Log](#31-change-log)

---

## 1. Executive Summary

**GST Books** is a GST-compliant **billing, inventory and accounting** product
for Indian micro, small and medium businesses (MSMEs) — a modern, affordable,
**subscription-based** alternative to **Tally Prime** and **Busy Accounting**.

Delivered from a **single codebase** in two interchangeable editions:

1. **Portable USB / Pendrive Edition** — runs directly from a USB drive using a
   bundled portable Node.js runtime. No installation, no admin rights; all data
   lives in an embedded SQLite file on the pendrive.
2. **Cloud SaaS Edition** — the same app deployed online (multi-user, anywhere).

It covers quote-to-cash and purchase-to-pay, GST returns (GSTR-1, HSN, E-Invoice,
E-Way Bill), multi-godown inventory, financial reporting, POS counter billing
with a barcode scanner, and **recurring subscription billing**.

---

## 2. Problem Statement

Indian MSMEs face four recurring pains with existing accounting software:

1. **High upfront cost:** Tally/Busy licenses cost ₹15,000–₹54,000+, a big
   barrier for small shops and freelancers.
2. **Portability & lock-in:** Per-machine installs make moving books between the
   shop PC, home PC and the accountant's PC painful.
3. **Complexity:** Legacy, keyboard-heavy UIs intimidate non-accountants.
4. **No predictable upgrades:** One-time licenses leave users on stale versions;
   compliance changes (GST rules) require paid re-purchases.

**Opportunity:** A low-cost, **subscription** product (always up to date) that is
portable (pendrive *or* cloud), GST-compliant, and simple enough for a shopkeeper
yet powerful enough for an accountant.

---

## 3. Vision & Objectives

> **Vision:** "Carry your entire business books in your pocket — on a pendrive or
> in the cloud — bill a GST invoice in under 30 seconds, and always stay
> compliant with automatic updates."

### Objectives
- **O1:** Deliver GST-correct invoicing (CGST/SGST/IGST, HSN, round-off, TDS).
- **O2:** Run fully offline from a USB pendrive with zero installation.
- **O3:** Provide the day-to-day modules of Tally/Busy at a fraction of the cost.
- **O4:** Keep customer data private and portable (local-first).
- **O5:** Build a sustainable **recurring-revenue** business (MRR/ARR), not
  one-time sales — funding continuous updates, support and compliance changes.

---

## 4. Success Metrics (KPIs) & North Star

**North Star Metric:** *Number of GST invoices created per active company per month*
(captures real, recurring product value).

| Metric | Target |
|--------|--------|
| Time to first invoice (fresh pendrive) | < 5 minutes |
| Time to create a standard GST invoice | < 30 seconds |
| Core billing flows working offline | 100% |
| Data loss across plug-out/plug-in cycles | 0 |
| Free → paid conversion (cloud) | ≥ 5% |
| Monthly churn (paid) | < 4% |
| Net Revenue Retention | ≥ 100% |
| Crash-free sessions | ≥ 99.5% |
| Monthly active companies (Year 1) | 1,000 |

---

## 5. Target Users & Personas

| Persona | Description | Primary needs | Key modules |
|---------|-------------|---------------|-------------|
| **Ravi — Retail shopkeeper** | Mobile/electronics shop | Fast counter billing, stock, GST bills | POS, Items, Invoices |
| **Sunita — Distributor/Wholesaler** | Supplies to retailers | Purchases, party ledgers, outstanding, godowns | Purchases, Parties, Reports |
| **Mr. Verma — Accountant / CA** | Multiple clients' books | GSTR-1, ledgers, audit trail, exports | Reports, Audit, Export |
| **Anjali — Freelancer / Service biz** | Solo professional | Quotes → invoices, expenses, payments | Quotations, Expenses, Payments |

**Roles within a company (RBAC):** Admin, Accountant, Operator, Viewer.

---

## 6. User Journeys

### 6.1 First-time setup (Pendrive)
Plug pendrive → double-click `START-GST-Books.bat` → browser opens → register
company (name, GSTIN, state) → add items/customer (or CSV import) → first invoice
→ PDF / WhatsApp share.

### 6.2 Daily counter sale (POS)
Open **POS** → scan barcode or tap product → select customer → **Complete Sale**
→ invoice created, stock reduced, UPI QR shown.

### 6.3 Month-end GST filing
**Reports → GSTR-1** → pick month → review B2B/B2C/HSN → **Export JSON** → upload
to GST portal.

### 6.4 Accountant review
Login as Accountant/Viewer → **Party Ledger** + **Outstanding & Aging** → export
CSV → check **Audit Trail**.

### 6.5 Subscription upgrade
Hit Free-plan limit (20 invoices/mo) → in-app prompt → **Plans & Billing** →
choose monthly/annual → plan activates → feature unlocked.

---

## 7. Information Architecture & Navigation Map

```
GST Books
├── (Public) Landing → Login / Register
└── (App, authenticated)
    ├── Dashboard            KPIs, trends, top items
    ├── POS Billing          barcode scan, cart, quick checkout
    ├── Parties              customers/vendors, CSV import
    ├── Items                inventory, barcode, CSV import
    ├── Quotations           estimates → convert to invoice
    ├── Sales Invoices       GST invoice, PDF, IRN, E-Way, share
    ├── Purchases            vendor bills
    ├── Credit/Debit Notes   returns
    ├── Payments             receipts/payments
    ├── Expenses             categorized expenses
    ├── Godowns              warehouses + stock transfer
    ├── Bank Recon           CSV import + matching
    ├── Budgets              per-category monthly budgets
    ├── Reports              Day Book, Ledger, Outstanding, GSTR-1, P&L
    ├── Plans & Billing      subscription management
    └── Settings             company, bank, prefixes, Team, Audit
```

---

## 8. Scope (In / Out)

### In Scope (v1 — shipped)
Company setup; masters (parties, items, godowns); sales, purchases, quotations,
credit/debit notes, payments, expenses; POS with barcode; GST computation,
GSTR-1 JSON, E-Invoice IRN, E-Way Bill (simulated); reports; bank reconciliation;
budgets; recurring invoices; audit trail; auth + RBAC; **subscription plans**;
PWA + dark mode; CSV import/export; PDF; portable USB packaging + cloud.

### Out of Scope (v1)
Native `.exe`; real-time concurrent multi-PC editing of the *same* pendrive DB;
direct government portal auto-filing; payroll, manufacturing/BOM, multi-currency
consolidation; live NIC/GSP E-Invoice signing (simulated for now); **one-time
perpetual licenses** (explicitly not offered).

---

## 9. Functional Requirements (by module)

> **US** = User Story, **AC** = Acceptance Criteria.
> Priority: **P0** (must), **P1** (should), **P2** (nice).

### 9.1 Authentication & Company (P0)
- **US:** As an owner, I register with my company so I can start billing.
- **AC:** unique email; JWT httpOnly cookie (30 days); bcrypt hashing; company
  stores GSTIN, PAN, address, state code, bank details, document prefixes, **plan**.

### 9.2 Parties (P0)
- CRUD; type CUSTOMER/VENDOR/BOTH; opening balance + direction; outstanding
  auto-computed from invoices, purchases, payments, notes; **CSV import/export**.

### 9.3 Items / Inventory (P0)
- CRUD with name, SKU, **barcode**, HSN, unit, sale/purchase price, GST rate;
  opening stock → current stock; low-stock alert; `StockMovement` audit on every
  transaction; CSV import/export.

### 9.4 Sales Invoices (P0)
- Multi-line, per-line discount + GST rate; auto CGST+SGST vs IGST by state code;
  invoice-level discount, round-off, **TDS**; sequential numbering with prefix;
  stock auto-decrement (restored on delete); PDF/print/WhatsApp/email;
  **Free-plan cap = 20 invoices/month** (server-enforced, HTTP 402 on breach).

### 9.5 Purchases (P0)
- Mirror of invoices; stock auto-increment; vendor bill number captured.

### 9.6 Quotations (P1)
- Status OPEN/ACCEPTED/CONVERTED/EXPIRED/REJECTED; **Convert to Invoice** copies
  lines, deducts stock, links invoice.

### 9.7 Credit / Debit Notes (P1)
- Credit (sales return) → stock IN, reduces receivable; Debit (purchase return) →
  stock OUT, reduces payable; original reference + reason captured.

### 9.8 Payments (P0)
- RECEIVED/PAID; CASH/BANK/UPI/CHEQUE/CARD; linking auto-updates invoice/purchase
  status; delete reverses status.

### 9.9 Expenses (P1)
- Category, payment mode, amount + GST, optional vendor, monthly totals.

### 9.10 POS Quick Billing (P1)
- Camera barcode scan (+ manual fallback) → match by barcode/SKU; product grid +
  search; cart; **Complete Sale** creates invoice, reduces stock.

### 9.11 Godowns & Stock Transfer (P1, Basic)
- CRUD godowns; transfer records OUT+IN movements.

### 9.12 GST & Compliance (P0/P1)
- GSTR-1 B2B/B2C/HSN + **JSON export** (P0); E-Invoice IRN + QR (P1, Premium);
  E-Way Bill with ₹50,000 threshold (P1, Premium).

### 9.13 Reports (P0)
- Dashboard; Day Book; Party Ledger (running Dr/Cr); Outstanding & Aging; P&L;
  sales/purchase registers; stock report & valuation.

### 9.14 Banking (P1, Premium)
- Bank reconciliation (CSV import + match); UPI QR on invoices.

### 9.15 Budgets (P1, Basic) & Recurring Invoices (P1, Premium)
- Budgets per category/month; recurring templates + frequency.

### 9.16 Platform (P0/P1)
- RBAC; audit trail; PWA + dark mode; PDF + CSV exports; **subscription plans**
  with server-side gating + usage meter.

---

## 10. Status / State Machines

### Invoice / Purchase payment status
```
UNPAID ──(partial payment)──▶ PARTIAL ──(full payment)──▶ PAID
  ▲                              │                          │
  └──────────(payment deleted / reversed)──────────────────┘
```

### Quotation lifecycle
```
OPEN ──▶ ACCEPTED ──▶ CONVERTED (invoice created, stock deducted)
  │            
  ├──▶ EXPIRED (past validUntil)
  └──▶ REJECTED
```

### Credit/Debit note
```
CREDIT (sales return)  → Stock IN  → Receivable ↓
DEBIT  (purchase return) → Stock OUT → Payable ↓
```

### Subscription plan
```
FREE ⇄ BASIC ⇄ PREMIUM   (upgrade/downgrade)
PAID ──(planExpiry passed)──▶ auto-downgrade to FREE
```

---

## 11. GST Calculation Rules & Edge Cases

**Per line:**
```
taxableAmount = (quantity × rate) − lineDiscount        (min 0)
taxAmount     = round(taxableAmount × gstRate / 100, 2)
if intra-state:  CGST = SGST = taxAmount / 2
if inter-state:  IGST = taxAmount
lineTotal     = taxableAmount + taxAmount
```
**Invoice level:**
```
subTotal   = Σ taxableAmount
taxTotal   = Σ (CGST+SGST+IGST)
tdsAmount  = round(subTotal × tdsRate / 100, 2)         (sales only)
grandTotal = subTotal + taxTotal − invoiceDiscount + roundOff − tdsAmount
```
**Place-of-supply / intra vs inter:** determined by comparing the company's
`stateCode` with the party's `stateCode`. If party state code is missing, defaults
to intra-state (CGST+SGST).

**Edge cases & rules:**
- Rounding to 2 decimals at line and total level; explicit `roundOff` field for
  bill-level rounding.
- B2B requires party GSTIN; otherwise treated as B2C in GSTR-1.
- E-Way Bill only allowed when `grandTotal ≥ ₹50,000`.
- E-Invoice requires company GSTIN to be set.
- Deleting any stock-affecting document reverses its `StockMovement`.
- Negative stock is allowed but surfaced via low-stock alerts (configurable
  blocking is on the roadmap).

---

## 12. Data Model

Core entities (Prisma + SQLite), all scoped per `Company`.

| Entity | Key fields | Notes |
|--------|-----------|-------|
| **User** | email (unique), password, name, role | Owns companies |
| **TeamMember** | userId, companyId, role | RBAC join |
| **Company** | name, gstin, pan, stateCode, prefixes, bank, **plan**, planExpiry | Tenant root |
| **Party** | name, type, gstin, openingBalance, balanceType | Customer/Vendor |
| **Item** | name, sku, **barcode**, hsn, unit, prices, gstRate, currentStock, lowStockAlert | Inventory |
| **Invoice / InvoiceItem** | number, date, totals, cgst/sgst/igst, **tds**, **irn**, **ewayBillNo** | Sales |
| **Purchase / PurchaseItem** | number, vendorBillNo, totals | Purchases |
| **Quotation / QuotationItem** | number, validUntil, status, convertedInvoiceId | Estimates |
| **CreditNote / CreditNoteItem** | number, kind, reason, originalRef | Returns |
| **Payment** | number, type, mode, amount, invoiceId/purchaseId | Money in/out |
| **Expense** | number, category, amount, gstRate, total | Expenses |
| **StockMovement** | itemId, type, quantity, reference | Stock audit |
| **Godown / StockTransfer** | name; from/to, quantity | Warehouses |
| **BankTransaction** | date, debit, credit, balance, isMatched | Reconciliation |
| **Budget** | category, period, amount | Budgeting |
| **RecurringInvoice** | name, frequency, nextRunDate, template | Automation |
| **AuditLog** | action, entity, entityId, userId, changes | Audit trail |

---

## 13. API Reference

All routes under `/api/*`, JSON, session-cookie auth (except auth). Plan-gated
routes return HTTP **402** + `upgrade: true`.

| Method & Path | Purpose |
|---------------|---------|
| `POST /api/auth/register` · `login` · `logout` | Auth/session |
| `GET/POST /api/parties` · `GET/PUT/DELETE /api/parties/[id]` · `POST /api/parties/import` | Parties |
| `GET/POST /api/items` · `PUT/DELETE /api/items/[id]` · `POST /api/items/import` | Items |
| `GET/POST /api/invoices` · `GET/DELETE /api/invoices/[id]` | Invoices |
| `POST /api/invoices/[id]/einvoice` · `/eway-bill` | IRN / E-Way (Premium) |
| `GET/POST /api/purchases` · `GET/DELETE /api/purchases/[id]` | Purchases |
| `GET/POST /api/quotations` · `POST /api/quotations/[id]/convert` | Quotations |
| `GET/POST /api/credit-notes` · `GET/DELETE /api/credit-notes/[id]` | Returns |
| `GET/POST /api/payments` · `DELETE /api/payments/[id]` | Payments |
| `GET/POST /api/expenses` · `DELETE /api/expenses/[id]` | Expenses |
| `GET/POST /api/godowns` · `/stock-transfers` | Warehouses (Basic) |
| `GET/POST /api/bank-reconciliation` · `/match` | Banking (Premium) |
| `GET/POST /api/budgets` · `/recurring-invoices` | Budgets / Recurring |
| `GET/POST/PUT/DELETE /api/team` | Team & roles (Premium) |
| `GET /api/export?type=...` | CSV export |
| `PUT /api/company` · `POST /api/company/plan` | Settings & plan |

---

## 14. UX, Screens & Navigation

Sidebar nav (see §7). Design principles: clean Tailwind UI with **dark mode**;
Framer Motion animations (page transitions, KPI counters, hover lift);
mobile-responsive animated drawer; **PWA** install prompt; print-optimized
invoice; INR formatting + amount-in-words.

---

## 15. Non-Functional Requirements

| Area | Requirement |
|------|-------------|
| Portability | USB on Windows 10/11 (+ macOS/Linux), no install/admin |
| Performance | Smooth at 10,000+ vouchers per company (SQLite) |
| Reliability | ACID transactions for stock & ledger |
| Availability (cloud) | 99.5%+ |
| Privacy | Local-first; pendrive data stays on device |
| Backup | Copy `Data/`; JSON/CSV exports |
| Accessibility | Keyboard-friendly, readable contrast in both themes |
| Localization | English UI; INR + Indian words; Hindi on roadmap |
| Browsers | Latest Chrome/Edge/Firefox; camera API for POS |

---

## 16. Security, Privacy & Compliance

JWT (httpOnly, SameSite=Lax, 30-day) + bcrypt; tenant isolation by `companyId`;
RBAC (Admin/Accountant/Operator/Viewer); immutable audit trail; configurable
`JWT_SECRET`; GST tax-invoice fields (GSTIN, HSN, tax breakup, round-off);
E-Way ₹50,000 threshold; pendrive edition keeps 100% data on device.

---

## 17. Architecture & Tech Stack

Next.js 14 (App Router) + React 18 + TypeScript; Tailwind + Framer Motion +
lucide-react + Recharts; SQLite via **Prisma** (engines bundled Windows + Linux);
JWT + bcryptjs; jsPDF (PDF), qrcode (UPI QR), html5-qrcode (barcode), papaparse
(CSV); packaging via `next build` standalone + `scripts/package-portable.mjs`.

---

## 18. Deployment Models

### 18.1 Portable USB / Pendrive (primary)
```
PENDRIVE\GSTBooks-Portable\
├── START-GST-Books.bat   ← double-click (Windows)
├── start-mac-linux.sh    ← macOS / Linux
├── node\                 ← portable Node.js
├── app\                  ← standalone server + assets + Prisma engines
└── Data\gstbooks.db      ← user's data (auto-created)
```
Build: `npm run package:portable`. See **docs/USB-SETUP.md**.

### 18.2 Cloud SaaS (secondary)
Deploy to Vercel/any Node host; swap SQLite → Postgres for concurrent multi-user;
cron for recurring invoices.

---

## 19. Monetization & Pricing (Subscription)

> **Subscription only — no one-time / perpetual license.** Recurring billing funds
> continuous updates, hosting, support and GST-compliance changes. Annual plans
> are offered at a discount instead of any one-time option.

| Plan | Monthly | **Annual (2 months free)** | Invoices/mo | Users | Highlights |
|------|---------|----------------------------|-------------|-------|-----------|
| **Free** | ₹0 | ₹0 | 20 | 1 | GST reports, WhatsApp share |
| **Basic** | ₹299/mo | **₹2,990/yr** | Unlimited | 3 | + Godowns, Budgets, TDS |
| **Premium** | ₹999/mo | **₹9,990/yr** | Unlimited | 25 | + E-Invoice, E-Way Bill, Bank recon, Recurring, Audit, Multi-user |

### Add-ons (optional, recurring)
- Extra users beyond plan: **₹99/user/mo**.
- E-Invoice/E-Way API credits (when live NIC/GSP integration ships): metered.
- Priority support / onboarding: **₹499/mo**.

### Billing rules
- Plans auto-renew (monthly or annually) until cancelled.
- Server-side **feature gating**; limit breaches return HTTP 402 + upgrade prompt.
- Paid plan expiry → automatic downgrade to Free (no data loss).
- 30-day free trial of Premium for new cloud signups (no card for trial).
- Refunds: pro-rated within 7 days of a charge (policy).

> **Why not one-time?** One-time licenses can't sustain ongoing GST-rule updates,
> security patches, hosting and support. Recurring revenue keeps every customer on
> the latest compliant version and aligns our incentives with their success.

---

## 20. Revenue Model & Projections

**Model:** SaaS MRR/ARR (Monthly/Annual Recurring Revenue).

**Illustrative Year-1 scenario** (cloud, blended):

| Metric | Assumption |
|--------|-----------|
| Paying customers (end of Y1) | 500 |
| Mix | 70% Basic (₹299) + 30% Premium (₹999) |
| Blended ARPU | ≈ ₹509 / mo |
| **MRR (end Y1)** | ≈ **₹2.5 L** |
| **ARR (end Y1)** | ≈ **₹30.5 L** |
| Monthly churn target | < 4% |

Levers: free→paid conversion, annual-plan adoption (cash-flow + lower churn),
add-on attach rate, and reseller/pendrive distribution for offline-first markets.

---

## 21. Competitive Analysis

| Capability | GST Books | Tally Prime | Busy |
|------------|-----------|-------------|------|
| Pricing model | **Subscription** (₹0 / ₹299 / ₹999 mo) | One-time + AMC | One-time + AMC |
| Entry cost | Free to start | ₹18,000+ | ₹15,000+ |
| Always up to date (auto) | ✅ | ❌ (AMC) | ❌ (AMC) |
| Runs from pendrive (no install) | ✅ | ❌ | ❌ |
| Modern web UI + dark mode | ✅ | ❌ | ❌ |
| POS + camera barcode | ✅ | Partial | Partial |
| GSTR-1 JSON export | ✅ | ✅ | ✅ |
| E-Invoice / E-Way | ✅ (simulated→API) | ✅ | ✅ |
| WhatsApp/UPI QR on invoice | ✅ | Partial | Partial |
| Cloud + local from one app | ✅ | ❌ | Partial |

---

## 22. Analytics & Telemetry

> Cloud edition only; pendrive edition stays fully offline/private by default.

**Key events to track:** `signup`, `company_created`, `first_invoice`,
`invoice_created`, `pos_sale`, `quotation_converted`, `payment_recorded`,
`gstr1_exported`, `einvoice_generated`, `plan_limit_hit`, `upgrade_clicked`,
`plan_activated`, `csv_imported`.

**Funnels:** signup → first invoice → 10th invoice → upgrade.
**Dashboards:** activation rate, North Star (invoices/active company), MRR, churn.

---

## 23. Testing & QA Strategy

| Layer | Approach |
|-------|----------|
| Unit | GST calc (`calcLineGST`), numbering, number-to-words |
| Integration | API routes (auth, invoices, payments, gating) |
| E2E | Login → create invoice → record payment → GSTR-1 export |
| Portable | Boot standalone server from USB-style folder; login + invoice (✅ verified) |
| Build gate | `next build` must pass with zero type/lint errors before release |
| Manual QA | Cross-browser POS camera; print/PDF layout; dark mode |

---

## 24. Internationalization & Accessibility

- **i18n:** English now; Hindi UI on roadmap (`next-intl`). All currency in INR
  with Indian grouping and amount-in-words.
- **a11y:** keyboard-navigable forms, focus states, sufficient contrast in light
  & dark themes; target WCAG 2.1 AA for core flows.

---

## 25. Support, SLA & Onboarding

- **Onboarding:** demo company + seed data; sample CSV templates; in-app prompts.
- **Docs:** `README.md`, `docs/USB-SETUP.md` (Hinglish step-by-step).
- **Support tiers:** community (Free); email (Basic); priority add-on (Premium).
- **SLA (cloud):** 99.5% uptime target; P1 response < 1 business day.

---

## 26. Stakeholders & RACI

| Activity | Product Owner | Engineering | QA | Support |
|----------|:-------------:|:-----------:|:--:|:-------:|
| Requirements (PRD) | **R/A** | C | C | I |
| Implementation | A | **R** | C | I |
| Release sign-off | A | R | **R** | I |
| Customer onboarding | C | I | I | **R/A** |

(R=Responsible, A=Accountable, C=Consulted, I=Informed)

---

## 27. Risks, Assumptions & Dependencies

| # | Risk / Assumption | Mitigation |
|---|-------------------|-----------|
| R1 | Portable Node.js must be on the pendrive | One-time documented step; engines pre-bundled |
| R2 | SQLite single-writer (no concurrent multi-PC on same file) | Cloud/Postgres edition for multi-user |
| R3 | E-Invoice/E-Way currently simulated | Swap to NIC/GSP API (roadmap); flow wired |
| R4 | Antivirus may flag node.exe | Whitelist official Node.js; documented |
| R5 | Pendrive loss = data loss | Backup guidance; encrypted-backup roadmap |
| R6 | Subscription churn | Annual plans, onboarding, continuous value |
| A1 | Users have a modern browser + camera for POS | Manual barcode entry fallback |

---

## 28. Release Plan & Milestones

| Milestone | Contents | Status |
|-----------|----------|--------|
| **M1 — Core MVP** | Auth, parties, items, invoices, purchases, payments, reports, PDF | ✅ Done |
| **M2 — Advanced accounting** | Quotations, credit/debit notes, expenses, godowns, bank recon, budgets, recurring, audit, RBAC | ✅ Done |
| **M3 — Monetization & compliance** | Plans + gating, E-Invoice, E-Way, TDS, billing page | ✅ Done |
| **M4 — Free power-ups** | PWA + dark mode, UPI QR, POS barcode, CSV import | ✅ Done |
| **M5 — Portable + PRD** | Standalone build, USB packaging, launchers, full PRD | ✅ Done |
| **M6 — Integrations & growth** | Real NIC/GSP e-invoice, Razorpay subscriptions + webhooks, Hindi UI, encrypted backup, Tally import | 🔜 Planned |

---

## 29. Open Questions

1. Payment gateway for recurring billing: Razorpay Subscriptions vs Stripe Billing?
2. Should the pendrive edition enforce plan limits, or stay fully unlocked (license-key based)?
3. Multi-company switching UI — include in Basic or Premium?
4. Data sync between pendrive and cloud — offer optional encrypted sync?
5. Annual plan discount depth — 2 months free vs 20% off?

---

## 30. Glossary

| Term | Meaning |
|------|---------|
| **PRD** | Product Requirements Document |
| **GSTIN** | GST Identification Number (15-char) |
| **HSN** | Harmonized System of Nomenclature (tax code) |
| **CGST/SGST/IGST** | Central / State / Integrated GST |
| **IRN** | Invoice Reference Number (E-Invoice) |
| **E-Way Bill** | Electronic waybill for goods > ₹50,000 |
| **TDS** | Tax Deducted at Source |
| **B2B / B2C** | Business-to-Business / Business-to-Consumer |
| **MRR / ARR** | Monthly / Annual Recurring Revenue |
| **ARPU** | Average Revenue Per User |
| **Churn** | % of paying customers lost per period |
| **PWA** | Progressive Web App (installable, offline-capable) |
| **RBAC** | Role-Based Access Control |

---

## 31. Change Log

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Jun 2026 | Initial PRD (overview, USB model, features) |
| 2.0 | Jun 2026 | Full PRD: personas, user stories, data model, API, competitive analysis |
| **3.0** | **Jun 2026** | **Subscription-only pricing (removed one-time); added state machines, GST edge cases, revenue projections, analytics, QA, i18n/a11y, support/SLA, RACI, open questions, change log** |

---

*This PRD reflects the current shipped product and its near-term roadmap.
For setup, see `README.md` and `docs/USB-SETUP.md`.*
