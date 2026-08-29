# API Reference

Route handlers under `src/app/api/`. 49 endpoints plus the health check.

## Conventions

**Authentication.** A JWT in an `httpOnly` cookie named `gst_session`. Obtain it from
`POST /api/auth/login`; browsers send it automatically.

**Tenant scoping.** The active company is resolved server-side from the session by
`getCurrentUserAndCompany()`. There is no `companyId` parameter on any endpoint and there
must never be one — accepting a tenant identifier from the client would allow cross-tenant
access.

**Authorisation.** Mutations pass through `writeGuard()`, which returns 403 for `VIEWER`
roles and for suspended companies.

**Status codes.**

| Code | Meaning |
|---|---|
| 200 | Success |
| 400 | Validation failure |
| 401 | No or invalid session |
| 402 | Plan limit reached — response includes `code: "PLAN_LIMIT"` and `upgrade: true` |
| 403 | Authenticated but not permitted, or company suspended |
| 404 | Not found, or not visible to this tenant |
| 429 | Rate limited *(planned — not yet implemented)* |
| 500 | Server error |
| 503 | Health check: database unreachable |

**Errors** return `{ "error": "message" }`.

---

## Health

### `GET /api/health`

Unauthenticated. Verifies the database is genuinely reachable, not just that the process is
alive. Returns no version strings or connection details.

```json
{ "status": "ok", "database": "connected", "latencyMs": 1, "timestamp": "2026-08-29T06:16:16.024Z" }
```

`503` with `"status": "degraded"` when the database cannot be reached.

---

## Auth

| Method | Path | Purpose |
|---|---|---|
| `POST` | `/api/auth/register` | Create a user and their first company |
| `POST` | `/api/auth/login` | Authenticate, set the session cookie |
| `POST` | `/api/auth/logout` | Clear the session cookie |

```http
POST /api/auth/login
{ "email": "demo@gst.com", "password": "demo1234" }
→ 200 { "ok": true }   + Set-Cookie: gst_session=...
```

These two routes are the only ones currently using Zod validation.

> **Note.** Logout clears the cookie but cannot invalidate the JWT — it remains
> cryptographically valid for its full 30-day lifetime. See `SECURITY.md` item 7.

---

## Company

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/company` | Current company profile |
| `PUT` | `/api/company` | Update profile, GSTIN, bank details, invoice prefix |
| `GET` | `/api/company/plan` | Active plan, limits and usage |

---

## Parties (customers and suppliers)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/parties` | List |
| `POST` | `/api/parties` | Create |
| `GET` | `/api/parties/[id]` | Detail |
| `PUT` | `/api/parties/[id]` | Update |
| `DELETE` | `/api/parties/[id]` | Delete |
| `POST` | `/api/parties/import` | Bulk import from CSV |

`type` is `CUSTOMER` or `VENDOR`. `stateCode` drives the intra/inter-state decision, so it
must be populated for GST to be correct.

---

## Items

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/items` | List |
| `POST` | `/api/items` | Create |
| `GET`/`PUT`/`DELETE` | `/api/items/[id]` | Detail / update / delete |
| `POST` | `/api/items/import` | Bulk import from CSV |

Carries `hsn`, `gstRate`, `salePrice`, `purchasePrice`, `currentStock`, `lowStockAlert`,
`barcode`.

---

## Sales

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/invoices` | List with parties |
| `POST` | `/api/invoices` | Create — computes GST, decrements stock, enforces plan limits |
| `GET`/`PUT`/`DELETE` | `/api/invoices/[id]` | Detail / update / delete |
| `POST` | `/api/invoices/[id]/einvoice` | Store IRN fields |
| `POST` | `/api/invoices/[id]/eway-bill` | Store e-way bill fields |
| `GET`/`POST` | `/api/quotations` | List / create |
| `GET`/`PUT`/`DELETE` | `/api/quotations/[id]` | Detail / update / delete |
| `POST` | `/api/quotations/[id]/convert` | Convert to an invoice |
| `GET`/`POST` | `/api/credit-notes` | List / create |
| `GET`/`PUT`/`DELETE` | `/api/credit-notes/[id]` | Detail / update / delete |
| `GET`/`POST` | `/api/recurring-invoices` | List / create |

```http
POST /api/invoices
{
  "partyId": "cmt...",
  "date": "2026-08-29",
  "dueDate": "2026-09-28",
  "items": [
    { "itemId": "cmt...", "itemName": "Boat Headphones 250",
      "hsn": "8518", "quantity": 2, "unit": "NOS",
      "rate": 1499, "discount": 0, "gstRate": 18 }
  ],
  "discount": 0,
  "roundOff": 0,
  "tdsRate": 0
}
```

Within one transaction this creates the invoice and its lines, decrements `Item.currentStock`
and writes an `OUT` `StockMovement` per line. Returns `402` with `code: "PLAN_LIMIT"` when the
monthly invoice cap is reached.

> **Known defects on this endpoint** (see `docs/AUDIT.md`): the invoice-level `discount` is
> applied *after* tax, overcharging GST; `tdsRate` is netted into `grandTotal`; there is no
> cess or supply-type support; the invoice number is allocated outside the transaction and
> races under concurrency. `GET /api/invoices` returns **all** invoices unpaginated.

E-invoice and e-way bill endpoints persist IRN/ack/QR fields only. There is no IRP
integration — the values must come from elsewhere.

---

## Purchases

| Method | Path | Purpose |
|---|---|---|
| `GET`/`POST` | `/api/purchases` | List / create — increments stock |
| `GET`/`PUT`/`DELETE` | `/api/purchases/[id]` | Detail / update / delete |

---

## Payments

| Method | Path | Purpose |
|---|---|---|
| `GET`/`POST` | `/api/payments` | List / create, allocated against an invoice |
| `GET`/`PUT`/`DELETE` | `/api/payments/[id]` | Detail / update / delete |

Creating a payment updates the linked invoice's `amountPaid` and moves `status` between
`UNPAID`, `PARTIAL` and `PAID`.

---

## Expenses, inventory, banking

| Method | Path | Purpose |
|---|---|---|
| `GET`/`POST` | `/api/expenses` | List / create |
| `GET`/`PUT`/`DELETE` | `/api/expenses/[id]` | Detail / update / delete |
| `GET`/`POST` | `/api/godowns` | Warehouses |
| `GET`/`POST` | `/api/stock-transfers` | Transfer stock between godowns |
| `GET`/`POST` | `/api/bank-reconciliation` | Bank transactions |
| `POST` | `/api/bank-reconciliation/match` | Match a transaction to a document |
| `GET`/`POST` | `/api/budgets` | Budget by category and period |
| `GET` | `/api/export` | Export tenant data |

---

## Team

| Method | Path | Purpose |
|---|---|---|
| `GET`/`POST` | `/api/team` | List / invite members |
| `PUT`/`DELETE` | `/api/team/[id]` | Change role / remove |

Roles: `ADMIN`, `ACCOUNTANT`, `OPERATOR`, `VIEWER`. `VIEWER` is read-only, enforced by
`writeGuard()`.

---

## Support and coupons

| Method | Path | Purpose |
|---|---|---|
| `GET`/`POST` | `/api/support` | Tenant support tickets |
| `POST` | `/api/coupons/validate` | Validate a coupon code |

---

## Platform admin

All require `isSuperAdmin`, verified by `getSuperAdmin()`.

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/api/admin/companies` | All tenants |
| `PUT` | `/api/admin/companies/[id]` | Suspend, change plan, adjust limits |
| `GET`/`POST` | `/api/admin/coupons` | Manage coupons |
| `PUT`/`DELETE` | `/api/admin/coupons/[id]` | Update / delete |
| `GET`/`PUT` | `/api/admin/plans` | Plan configuration |
| `GET`/`PUT` | `/api/admin/site-settings` | Platform settings and feature flags |
| `GET`/`POST` | `/api/admin/tickets` | All tenants' tickets |
| `PUT` | `/api/admin/tickets/[id]` | Respond, change status |
| `POST` | `/api/admin/broadcast` | Announcement to all tenants |
| `GET` | `/api/admin/export` | Platform-wide export |
| `POST` | `/api/admin/impersonate` | Assume a user's session |
| `POST` | `/api/admin/impersonate/stop` | End impersonation |

> Impersonation is audit-logged but has no expiry, no required reason and no notification to
> the tenant. See `SECURITY.md` item 10.

---

## Planned endpoints

Not yet implemented. Listed so the surface is designed rather than accreted.

**Accounting (Phase 2)**

```
GET  /api/ledgers                      Chart of accounts
POST /api/journal-entries              Manual journal voucher
GET  /api/reports/trial-balance
GET  /api/reports/profit-loss?from=&to=
GET  /api/reports/balance-sheet?asOn=
GET  /api/reports/cash-flow?from=&to=
```

**GST (Phase 2)**

```
GET  /api/reports/gstr3b?month=
POST /api/reports/gstr2b/reconcile     Upload 2B, match against purchases
GET  /api/reports/itc-summary
```

**Billing (Phase 3)**

```
POST /api/billing/subscribe
POST /api/billing/webhook/razorpay     Signature-verified, idempotent
GET  /api/billing/invoices
```

**AI (Phase 4)** — every endpoint returns `{ available: false }` when `AI_ENABLED=false`.

```
POST /api/ai/ocr/bill                  Extract fields from a purchase bill image
POST /api/ai/assistant                 Natural-language query, Hindi or English
POST /api/ai/categorise                Suggest an expense head
GET  /api/ai/usage                     Token spend against the tenant's budget
```

**Inventory** — see `docs/INVENTORY_VALUATION.md` for the costing rules.

```
GET  /api/reports/inventory                    Closing stock + COGS per item, with flags
GET  /api/reports/inventory?view=ageing        Age buckets (0-30/31-60/61-90/91-180/180+)
GET  /api/reports/inventory?view=dead          Items holding stock that is not moving
GET  /api/reports/inventory?view=expiry        Batches expired or nearing expiry
GET  /api/reports/inventory?view=ledger&itemId=   Movement history with running cost

GET  /api/stock-adjustments                    Paginated, plus the reason catalogue
POST /api/stock-adjustments                    Reason fixes the direction, not the request

GET  /api/physical-counts                      Paginated, with a variance-line count
POST /api/physical-counts                      Freezes the book quantity onto every line
GET  /api/physical-counts/:id                  Sheet + summary of the effect of posting
PATCH /api/physical-counts/:id                 Record counted quantities (DRAFT only)
POST /api/physical-counts/:id/post             Variances -> one stock adjustment
DELETE /api/physical-counts/:id                Cancels a draft; refuses a posted sheet

GET  /api/batches                              ?itemId= &inStock=true
POST /api/batches                              Batch/lot with mfg + expiry dates
```

Notes:

- All money is integer paise. Quantities are floats, because real units are
  fractional (2.5 kg).
- `PUT /api/company` returns `409 VALUATION_RESTATEMENT` if `stockValuationMethod`
  changes without `acknowledgeRestatement: true`. Valuation is derived, so a
  change restates every past period.
- Adjustments and counts change quantities only; they never post to the ledger.
  Purchases are already expensed on receipt (periodic inventory).

---

---

## Conventions for new endpoints

1. **Validate with Zod before touching the database.** Currently only 2 of 49 routes do.
2. **Never accept `companyId`** — resolve it from the session.
3. **Call `writeGuard()` on every mutation.**
4. **Wrap multi-table writes in `db.$transaction`**, including document-number allocation.
5. **Paginate list endpoints.** Default 50, cap 200.
6. **Return money as integer paise** in fields suffixed `Paise`; format at the UI boundary.
7. **Audit-log sensitive mutations** via `logAudit()`.
8. **Make webhooks idempotent** and verify their signature before processing.
