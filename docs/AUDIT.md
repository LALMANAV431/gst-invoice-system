# Repository Audit

Audit of `LALMANAV431/gst-invoice-system`, performed against commit `24979a8` on branch
`feature/advanced-tally-busy-features`.

Every finding below was reproduced by running the code. Where a defect involves numbers,
the actual observed output is quoted.

---

## Section 1 — Overview

### The headline finding: the application is not on `main`

| Branch | Contents |
|---|---|
| `main` | `README.md` only — 1 commit, 34 lines, no code |
| `feature/advanced-tally-busy-features` | The entire application — 166 files, 11 commits |

The feature branch is **10 commits ahead of `main` and 0 behind**, so it fast-forwards
cleanly. Anyone cloning this repository today gets a README describing a WordPress plugin
and zero source code.

Compounding it, the `main` README was **factually wrong about the whole stack**: it
described a "WordPress Plugin & Theme" requiring "WordPress 5.0+, PHP 7.4+, MySQL 5.6+"
with installation instructions for `/wp-content/themes/`. The actual application is
Next.js + TypeScript + Prisma. No PHP, MySQL or WordPress is involved anywhere.

**Fix:** merge the code into `main` and replace the README. Both are done in this change.

### Actual stack

| Layer | Technology |
|---|---|
| Framework | Next.js 14.2.18, App Router, React Server Components |
| Language | TypeScript 5 (strict) |
| UI | Tailwind CSS 3.4, Lucide, Framer Motion 11, Recharts 2 |
| Database | Prisma 5.22 ORM, SQLite |
| Auth | `jsonwebtoken` JWT in an `httpOnly` cookie, `bcryptjs` |
| PDF | jsPDF 2.5 + jspdf-autotable 3.8 |
| Other | Zod, Papaparse (CSV), html5-qrcode (barcode), react-hot-toast |

**Scale:** 27 Prisma models, 49 API route handlers, 80 build-time routes,
~50 page components.

### Does it work?

Yes. This is a genuinely functional application, not a skeleton. Verified end to end:

```
npm ci                  -> OK (566 packages)
npx tsc --noEmit        -> exit 0, no type errors
npm run build           -> OK, 80 routes compiled
npm run db:setup        -> OK, schema pushed + demo data seeded
npx next start          -> OK
POST /api/auth/login    -> 200 {"ok":true}
GET  /api/parties       -> 200, correctly scoped to the tenant
GET  /api/items         -> 200, correctly scoped to the tenant
```

Docker was also verified: image builds, container serves traffic, health check returns
200, login works, API returns seeded data, process runs as non-root (UID 1001).

### Repository hygiene

| File | Status |
|---|---|
| `README.md` | Present but described the wrong technology — **rewritten** |
| `.gitignore` | Good. Correctly excludes `.env`, `node_modules`, `prisma/dev.db` |
| `.env.example` | Present but minimal (2 variables) — **expanded to ~40, documented** |
| `.github/workflows/ci.yml` | Present. Checkout, install, generate, typecheck, lint, build |
| `PRD.md` | Present, detailed |
| `.eslintrc.json` | **Missing** — this broke `npm run lint` — **added** |
| `Dockerfile` / `docker-compose.yml` | **Missing** — **added** |
| `LICENSE` | **Missing** — guidance added to README; needs an owner decision |
| `SECURITY.md` | **Missing** — **added** |
| `CONTRIBUTING.md` | **Missing** — folded into README |
| Test config / any tests | **Missing** — Vitest + 56 tests **added** |
| `middleware.ts` | Missing — needed for rate limiting and security headers |

**Secrets:** none committed. The only secret-shaped strings are a clearly-labelled CI
placeholder in `ci.yml` and the `DEFAULT_DEV_SECRET` fallback in `src/lib/auth.ts`. That
fallback is correctly guarded — `auth.ts` throws at boot if `JWT_SECRET` is missing in
production. This is good practice and was already right.

---

## Section 2 — Correctness findings

This is the part that matters most, because this is accounting software. Where a system
loses money silently, "it builds and runs" is not evidence of correctness.

### C1 — Money is stored and computed as floating point (critical)

`prisma/schema.prisma` uses **93 `Float` fields** for monetary values and **0 `Decimal`**.
Reproduced against the real `calcLineGST` from `src/lib/utils.ts`:

```
100 lines of (qty 3 x rate 33.33), accumulated as the route does:
  subTotal  = 9998.999999999984
  expected  = 9999
```

`src/app/api/invoices/route.ts` accumulates `subTotal += r.taxableAmount` on raw floats and
only rounds at the end, so the error compounds across lines. On a long invoice, or when
aggregated into a report, totals stop reconciling.

**Root cause:** IEEE-754 doubles cannot represent most decimal fractions exactly. `0.1 +
0.2 !== 0.3`. Sprinkling `.toFixed(2)` hides individual errors but does not prevent
accumulation.

**Fix:** store and compute in integer paise. Implemented in `src/lib/money.ts`.

### C2 — Invoice-level discount is applied after tax (critical, GST non-compliance)

`src/app/api/invoices/route.ts`:

```ts
const grandTotal = +(subTotal + taxTotal - invDiscount + invRoundOff - tdsAmount).toFixed(2);
```

The discount is subtracted from the post-tax total, so GST is charged on the
**pre-discount** value. Reproduced:

```
Rs 10,000 line @ 18%, Rs 1,000 invoice discount
  as coded -> taxable 10000, tax 1800, grand 10800
  correct  -> taxable  9000, tax 1620, grand 10620
  GST OVERCHARGED BY Rs 180
```

Under CGST Act s.15(3), a discount recorded on the face of the invoice **reduces the
taxable value**. Charging tax on the undiscounted amount overcollects GST from the customer
and overstates output tax liability on GSTR-1.

**Fix:** apportion the invoice discount across lines pro-rata to taxable value, subtract
it, *then* compute tax. Implemented in `computeGstInvoice()` in `src/lib/gst.ts`.

### C3 — No compensation cess support (high)

`calcLineGST` takes `{ quantity, rate, discount, gstRate, isInterState }`. There is no cess
parameter, and no cess column on `InvoiceItem`. Any 28%+cess item — tobacco, aerated
drinks, motor vehicles, coal — is **undercharged silently**, leaving the seller liable for
the shortfall.

**Fix:** `cessRate` (percentage) and `cessPerUnit` (flat, for tobacco) in `src/lib/gst.ts`.

### C4 — No distinction between exempt, nil-rated, non-GST and zero-rated (high)

All are currently representable only as "0%". They are legally distinct and are reported in
different GSTR-1 tables:

| Supply | Tax | ITC to supplier | GSTR-1 |
|---|---|---|---|
| Zero-rated (export/SEZ) | 0% | **Preserved** | Table 6A |
| Exempt | None | Blocked | Table 8 |
| Nil-rated | 0% by tariff | Blocked | Table 8 |
| Non-GST (e.g. alcohol) | Outside GST | N/A | Table 8 |

Collapsing these produces wrong returns and wrongly claimed or forfeited input tax credit.

**Fix:** explicit `SupplyType` union in `src/lib/gst.ts`, preserved onto each line.

### C5 — TDS is netted into the invoice total (high)

```ts
const grandTotal = +(subTotal + taxTotal - invDiscount + invRoundOff - tdsAmount).toFixed(2);
```

TDS is withheld by the **customer** when they pay. It does not reduce what the invoice is
for. Netting it understates the invoice's face value, the receivable, and the GST-bearing
amount, and it will not match the customer's books or Form 26AS.

```
Rs 10,000 @ 18% with 10% TDS
  as coded -> grandTotal 10800   (wrong: invoice is for 11800)
  correct  -> grandTotal 11800, TDS 1000 tracked separately, expected receipt 10800
```

**Fix:** `computeGstInvoice()` returns `grandTotalPaise` (face value) plus separate
`tdsPaise` and `expectedReceiptPaise`.

### C6 — CGST/SGST split drifts on odd paise (medium)

```ts
const cgst = +(taxAmount / 2).toFixed(2);
const sgst = +(taxAmount - cgst).toFixed(2);
```

Observed: a ₹105.05 line at 5% gives tax of ₹5.25 → `cgst 2.63`, `sgst 2.62`. The asymmetry
itself is unavoidable, but here it is implicit and unverified.

**Fix:** `splitPaise()` distributes remainder paise deterministically and is tested to
reconcile exactly for every amount and part count.

### C7 — Seed data contained invalid GSTINs (medium)

All three seeded GSTINs failed checksum validation:

| Seeded | Correct | |
|---|---|---|
| `27ABCDE1234F1Z5` | `27ABCDE1234F1Z0` | invalid |
| `27AAACS1234B1Z5` | `27AAACS1234B1Z0` | invalid |
| `29AAACR9876H1Z2` | `29AAACR9876H1ZP` | invalid |

A GSTIN's 15th character is a mod-36 checksum over the first 14. These pass a regex but
fail arithmetic validation — so the demo data could never be used to test real validation.

The checksum implementation added in `src/lib/gst.ts` was verified against two
independently published valid GSTINs (`27AAPFU0939F1ZV`, `24AAACC1206D1ZM`); it reproduces
both check characters. **Fixed** — seed values corrected to checksum-valid fictional
numbers.

### C8 — Invoice numbering race condition (medium, GST relevance)

`src/lib/numbering.ts` reads the last number and increments it. The call happens *before*
and *outside* the `db.$transaction` in the invoice route. Two concurrent requests read the
same value. `@@unique([companyId, number])` prevents duplicates reaching the database, so
the failure mode is an unhandled 500 rather than corruption — better, but still a bug. GST
requires a consecutive, gap-free series per financial year.

**Fix:** allocate from a per-company counter row inside the same transaction.

### C9 — No double-entry accounting (high, for the stated goal)

There are no `Ledger`, `LedgerGroup` or `JournalEntry` models. Reports present are day
book, GSTR-1, party ledger and outstanding. **Absent:** chart of accounts, journal
vouchers, trial balance, profit & loss, balance sheet, cash flow.

Without double entry there is no arithmetic guarantee that the books balance, and the
product cannot substitute for Tally or Busy as the README claimed. This is the largest
functional gap and is scheduled in `docs/ROADMAP.md` Phase 2.

---

## Section 3 — Security findings

Full detail and remediation in [`SECURITY.md`](../SECURITY.md). Summary:

| # | Severity | Finding |
|---|---|---|
| S1 | Critical | 12 dependency advisories, 2 critical (Next.js DoS/SSRF/cache poisoning; dompurify XSS via jspdf) |
| S2 | Critical | Seeded demo account `demo@gst.com / demo1234` has `isSuperAdmin: true` |
| S3 | High | No rate limiting on any route, including login and register |
| S4 | High | Zod validation on 2 of 49 routes; the rest trust `req.json()` |
| S5 | High | No CSRF origin check on state-changing routes |
| S6 | Medium | JWTs valid 30 days with no server-side revocation; logout only clears the cookie |
| S7 | Medium | No upload MIME/size validation |
| S8 | Medium | Impersonation has no expiry, reason or tenant notification |
| S9 | Medium | Session cookie lacks `Secure` |
| S10 | Medium | No CSP or other security headers |

**Done well, and worth keeping:** tenant scoping is consistently derived from the session
rather than from client input — every tenant query filters on `companyId` from
`getCurrentUserAndCompany()`. That is the single most important control in a multi-tenant
system and it was implemented correctly throughout. Suspension and `VIEWER` read-only
enforcement are checked server-side in `writeGuard()`, not just hidden in the UI.

---

## Section 4 — Tooling findings

### T1 — `npm run lint` hung the terminal (high)

With no `.eslintrc.json`, `next lint` dropped into its interactive setup prompt:

```
? How would you like to configure ESLint?
> Strict (recommended)
  Base
  Cancel
```

It waits for keyboard input forever. CI invokes `npm run lint --if-present`, so the lint
step was silently useless. **Fixed** — `.eslintrc.json` added; lint now exits 0 clean.

### T2 — Zero tests (high)

No test runner, no test files, no coverage — in an application that computes tax.
**Fixed** — Vitest added with 56 tests covering the money and GST engines, each written to
assert against independently-verifiable expected values.

### T3 — CI gaps (medium)

`ci.yml` runs typecheck, lint and build. It does not run tests, `npm audit`, or verify that
migrations and seeding work. It has no service container, so it cannot test against
PostgreSQL.

---

## Section 5 — Immediate repair checklist

Ordered by risk. Items marked **done** are included in this change.

| # | Item | Status |
|---|---|---|
| 1 | Get the application onto `main` | **done** (this PR) |
| 2 | Replace the incorrect README | **done** |
| 3 | Fix `npm run lint` hanging | **done** |
| 4 | Add a correct money engine (integer paise) | **done** — `src/lib/money.ts` |
| 5 | Add a correct GST engine (discount ordering, cess, supply types, TDS) | **done** — `src/lib/gst.ts` |
| 6 | Add a test suite for the above | **done** — 56 tests |
| 7 | Fix invalid seed GSTINs | **done** |
| 8 | Add Docker + compose + health check | **done** |
| 9 | Document every environment variable | **done** |
| 10 | Document the security posture honestly | **done** — `SECURITY.md` |
| 11 | **Wire the new engines into the invoice/purchase/credit-note routes** | Phase 1 |
| 12 | **Migrate 93 `Float` columns to integer paise** | Phase 1 |
| 13 | **Upgrade Next.js; clear critical advisories** | Phase 1 |
| 14 | **Stop seeding a super-admin demo account** | Phase 1 |
| 15 | **Add rate limiting + Zod on all routes** | Phase 1 |
| 16 | **Fix the invoice numbering race** | Phase 1 |
| 17 | Migrate SQLite → PostgreSQL | Phase 1 |
| 18 | Build the double-entry ledger, trial balance, P&L, balance sheet | Phase 2 |

---

## Scope note

Items 11–12 were deliberately **not** attempted here. Rewiring money handling touches 27
models and 49 routes and requires a data migration; done partially it would leave the
system in a worse state than either endpoint — some totals in paise, others in floats, none
reconciling. The engine and its tests land first so the migration that follows has a
verified foundation and a clear diff.

`src/lib/utils.ts` `calcLineGST` is therefore still in use and still has defects C2–C6.
It is left in place, untouched, until the migration replaces its call sites.
