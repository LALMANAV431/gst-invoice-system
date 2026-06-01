# 📘 Product Requirements Document (PRD)
## GST Books — Portable GST Billing & Accounting System

**Version:** 1.0
**Last updated:** June 2026
**Owner:** LALMANAV431
**Status:** Live (MVP + advanced modules shipped)

---

## 1. Overview

**GST Books** is a GST-compliant billing, inventory and accounting application
for Indian businesses — a modern, low-cost alternative to Tally ERP and Busy.

It is built as a **web application** (Next.js + SQLite) but ships in a
**portable "pendrive" edition**: the entire app runs directly from a USB drive
using a bundled portable Node.js runtime. No installation, no admin rights, and
all data stays on the pendrive.

> One codebase → runs as a cloud SaaS **and** as a portable USB app.

---

## 2. Goals & Non-Goals

### Goals
- Let a shopkeeper/accountant carry their full books on a pendrive and run them
  on any Windows PC by double-clicking one file.
- Be GST-compliant: CGST/SGST/IGST, HSN, GSTR-1, E-Invoice, E-Way Bill.
- Match the core day-to-day features of Tally/Busy at a fraction of the price.
- Keep data 100% local and private (on the pendrive), with easy backup.

### Non-Goals (v1)
- Not a native `.exe` (it is a portable web server + browser UI).
- No real-time multi-PC concurrent editing of the *same* pendrive DB.
- No direct government portal auto-filing (JSON export is provided instead).

---

## 3. Target Users (Personas)

| Persona | Need |
|---------|------|
| **Retail shopkeeper** | Fast counter billing (POS + barcode), GST invoices, stock |
| **Small distributor/wholesaler** | Purchases, parties ledger, outstanding, multi-godown |
| **Accountant / CA** | Reports, GSTR-1, ledgers, audit trail across client books |
| **Service business / freelancer** | Quotations, invoices, expenses, payment tracking |

---

## 4. Deployment Models

### 4.1 Portable USB (primary for this PRD)
- App is built in **Next.js standalone** mode → a self-contained `server.js`.
- A **portable Node.js** runtime is placed on the pendrive (`node/node.exe`).
- A **launcher** (`START-GST-Books.bat`) sets environment variables, ensures the
  database exists in `Data\gstbooks.db`, starts the server on `localhost:3000`,
  and opens the browser.
- **Database**: embedded **SQLite** file on the pendrive (`Data\gstbooks.db`).
- **No installation / no admin rights** required.

```
PENDRIVE (E:\GSTBooks-Portable)
├── START-GST-Books.bat      ← double-click to run (Windows)
├── start-mac-linux.sh       ← macOS / Linux
├── README.txt
├── node/                    ← portable Node.js (node.exe)
├── app/                     ← standalone Next.js server + assets + Prisma engines
│   ├── server.js
│   ├── .next/static/
│   ├── public/
│   └── prisma/ (schema + seed.db)
└── Data/
    └── gstbooks.db          ← YOUR data (auto-created on first run)
```

### 4.2 Cloud SaaS (secondary)
- Same codebase deploys to Vercel/any Node host with Postgres for multi-user.

---

## 5. Functional Requirements (shipped)

### 5.1 Masters
- **Parties** (customers/vendors): GSTIN, address, opening balance, CSV import.
- **Items/Inventory**: HSN, barcode, units, sale/purchase price, GST rate,
  opening & live stock, low-stock alerts, CSV import.
- **Godowns/Warehouses** + inter-godown **stock transfer**.

### 5.2 Transactions / Vouchers
- **Sales Invoices** (auto CGST/SGST/IGST, discount, round-off, **TDS**).
- **Purchases** (vendor bills).
- **Quotations / Estimates** → 1-click **convert to invoice**.
- **Credit Notes** (sales return) & **Debit Notes** (purchase return) with
  automatic stock reversal.
- **Payments** (received/paid) with auto invoice status (Paid/Partial/Unpaid).
- **Expenses** with category + GST.
- **POS quick-billing** screen with **camera barcode scanner**.

### 5.3 GST & Compliance
- Intra-state (CGST+SGST) vs inter-state (IGST) auto-detection by state code.
- **GSTR-1 summary** (B2B / B2C / HSN) with **portal-style JSON export**.
- **E-Invoice (IRN + signed QR + AckNo)** generation.
- **E-Way Bill** generation with ₹50,000 threshold check.
- **HSN-wise summary**, GST computation, ITC view.

### 5.4 Reports
- Dashboard (KPIs, sales/purchase trend, top items).
- Day Book, Party Ledger (running balance), Outstanding & Aging (30/60/90),
  Profit & Loss, Sales/Purchase registers, Stock report & valuation.

### 5.5 Banking & Money
- **Bank reconciliation** (CSV statement import + match).
- **UPI QR** on invoices (scan-to-pay), bank details on invoice.

### 5.6 Platform
- **Auth** (JWT, bcrypt) + **multi-user roles** (Admin/Accountant/Operator/Viewer).
- **Audit trail** of create/update/delete.
- **Recurring invoices**, **Budgets** (per category/month).
- **PDF** invoices, **print**, **WhatsApp/Email share**, **Excel/CSV export**.
- **PWA** (installable, offline page) + **dark mode**.
- **Subscription plans** (Free / Basic / Premium) with feature gating.

---

## 6. Subscription Plans

| Plan | Price | Invoices/mo | Key features |
|------|-------|-------------|--------------|
| **Free** | ₹0 | 20 | GST reports, WhatsApp share |
| **Basic** | ₹299/mo | Unlimited | + Godowns, Budgets, TDS, 3 users |
| **Premium** | ₹999/mo | Unlimited | + E-Invoice, E-Way Bill, Bank recon, Recurring, Audit, 25 users |

> For the portable USB edition, plan limits can be unlocked locally; pricing is
> primarily for the cloud SaaS model.

---

## 7. Non-Functional Requirements

- **Portability:** runs from USB on Windows 10/11 (also macOS/Linux) without install.
- **Performance:** handles thousands of vouchers per company on SQLite smoothly.
- **Privacy:** all data local to the pendrive; nothing leaves the device.
- **Reliability:** ACID transactions (Prisma + SQLite) for stock & ledger updates.
- **Backup:** copy the `Data/` folder to back up everything.
- **Security:** configurable `JWT_SECRET`; per-company data isolation.

---

## 8. Architecture

- **Frontend & Backend:** Next.js 14 (App Router), React, TypeScript, Tailwind.
- **DB/ORM:** SQLite via Prisma (engines bundled for Windows + Linux).
- **Auth:** JWT in httpOnly cookies, bcrypt password hashing.
- **PDF/QR:** jsPDF, qrcode; barcode scan via html5-qrcode; CSV via papaparse.
- **Packaging:** `next build` (standalone) → `scripts/package-portable.mjs`
  assembles the `GSTBooks-Portable/` folder for the pendrive.

---

## 9. How to Build the Pendrive Package (for the seller/developer)

```bash
npm install
npm run db:setup          # creates a seeded prisma/dev.db (becomes seed.db)
npm run package:portable  # builds + assembles ./GSTBooks-Portable
```
Then copy `GSTBooks-Portable/` onto the USB and drop a portable Node.js into its
`node/` folder. See **docs/USB-SETUP.md** for the full step-by-step guide.

---

## 10. Roadmap

- [ ] Real NIC/GSP E-Invoice & E-Way Bill API integration (currently simulated).
- [ ] Razorpay/UPI payment links with auto-reconciliation.
- [ ] Batch/serial + expiry tracking; FIFO/Weighted-Avg valuation.
- [ ] One-click encrypted backup to a second drive / cloud folder.
- [ ] Auto-update checker for the portable build.
- [ ] Tally XML / Busy import.

---

## 11. Success Metrics

- Time to first invoice on a fresh pendrive < 5 minutes.
- 100% of core billing flows work offline from USB.
- Zero data loss across plug-out/plug-in cycles (verified via `Data/` integrity).
