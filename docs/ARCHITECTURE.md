# Architecture

## Guiding decisions

**Keep the existing stack.** Next.js 14 + TypeScript + Prisma is a sound choice for this
product and the code is competently structured. A rewrite would discard a working feature
surface for no benefit. Every recommendation below is evolutionary.

**Correctness before features.** This is accounting software. A missing report is an
inconvenience; a wrong total is a liability. The money and GST engines are therefore the
foundation everything else builds on.

**Degrade gracefully.** Every optional integration — AI, WhatsApp, payment gateway, e-invoice,
S3, Redis — must be absent-by-default and the application must remain fully usable without
it. A shopkeeper with no API keys gets a working invoicing system.

---

## Current architecture

```
Browser (PWA)
  │
  ├─ React Server Components ─────► Server-side data fetching via Prisma
  │                                  (pages under src/app/(app)/)
  └─ Client components ───────────► fetch() ──► Route Handlers
                                                 (src/app/api/**/route.ts)
                                                         │
                                    ┌────────────────────┼────────────────────┐
                                    │                    │                    │
                              src/lib/auth.ts      src/lib/guard.ts     src/lib/plan.ts
                              (session/JWT)        (RBAC + suspension)  (plan limits)
                                    │
                                    ▼
                              src/lib/db.ts ──► Prisma ──► SQLite
```

Requests carry a JWT in an `httpOnly` cookie. `getCurrentUserAndCompany()` resolves the
user and their active company from that token; **the tenant is never taken from client
input**. Every tenant-scoped query filters on the resulting `companyId`.

### What is right about this and should not change

- **Tenant resolution from the session.** The single most important control in multi-tenant
  SaaS, implemented consistently.
- **Server-side authorisation.** `writeGuard()` enforces suspension and read-only roles at
  the API layer, so a crafted request cannot bypass what the UI hides.
- **RSC for read paths.** Reports and lists render on the server, keeping the client bundle
  small — which matters for shopkeepers on low-end Android phones.
- **`output: "standalone"`.** Enables both a small Docker image and the portable USB build.

---

## Target architecture

The change is to insert an explicit **domain layer** between route handlers and Prisma.
Today, business logic lives inside route handlers — GST computation, stock movement and
numbering are all inline in `api/invoices/route.ts`. That makes the logic impossible to
unit test without HTTP, and means purchases, credit notes and POS each re-implement the
same rules slightly differently.

```
Route Handler          thin: parse, validate (Zod), authorise, delegate, respond
      │
      ▼
Service layer          src/server/services/
      │                invoice.service.ts, payment.service.ts, ledger.service.ts …
      │                owns transactions; the only place business rules live
      ▼
Domain (pure)          src/lib/money.ts, src/lib/gst.ts
      │                no I/O, no framework — trivially unit testable
      ▼
Data access            src/server/repositories/  (Prisma, tenant-scoped)
      │
      ▼
PostgreSQL
```

Why this shape:

- **Pure domain functions are testable.** `computeGstInvoice()` needs no database and no
  HTTP, which is why 56 tests run in under half a second.
- **One place for rules.** Invoice, credit note, POS and recurring invoice all call the same
  engine, so they cannot disagree about tax.
- **Transactions belong in services.** Creating an invoice must atomically write the
  invoice, its lines, stock movements, ledger postings and the number allocation. That
  boundary is a service, not a route.

### Recommended folder layout

```
src/
├── app/
│   ├── (app)/              Authenticated tenant pages
│   ├── admin/              Platform super-admin pages
│   ├── api/                Route handlers (thin)
│   └── (marketing)/        Landing, pricing, legal  [to add]
├── components/             Shared UI
├── lib/                    Pure, framework-free domain logic
│   ├── money.ts            Integer-paise arithmetic          [added]
│   ├── gst.ts              GST computation, GSTIN validation  [added]
│   ├── accounting.ts       Double-entry posting rules         [Phase 2]
│   └── validation/         Shared Zod schemas                 [Phase 1]
├── server/
│   ├── services/           Business operations, transactions  [Phase 1]
│   ├── repositories/       Tenant-scoped data access          [Phase 1]
│   ├── ai/                 Provider abstraction               [Phase 4]
│   └── jobs/               Background jobs                    [Phase 3]
└── middleware.ts           Rate limiting, security headers, CSRF  [Phase 1]
```

---

## Database: move to PostgreSQL

SQLite is excellent for the portable USB edition and for local development. It is the wrong
choice for hosted multi-tenant SaaS:

| Concern | SQLite | PostgreSQL |
|---|---|---|
| Concurrent writes | One writer at a time; readers block on write locks | MVCC, many concurrent writers |
| Exact decimals | No native `DECIMAL` | `NUMERIC(p,s)` |
| Horizontal scaling | Impossible — a file on one disk | Read replicas, connection pooling |
| Managed backups / PITR | Manual file copying | Standard on every provider |
| Row-level security | None | Available as defence-in-depth for tenant isolation |

**Recommendation:** keep the SQLite schema for the portable build, run PostgreSQL for the
hosted product. Migration steps are in [`DEPLOYMENT.md`](DEPLOYMENT.md).

### Money representation

Two defensible options:

| Approach | Pros | Cons |
|---|---|---|
| **Integer paise** (`BigInt`/`Int`) | Exact; no library; fast; language-agnostic | Must convert at the presentation boundary |
| **`Decimal`** (`NUMERIC(18,4)`) | Reads naturally in SQL; DB-enforced precision | Prisma returns `Decimal.js` objects; easy to leak into JS floats accidentally |

**Chosen: integer paise.** It is the harder option to get wrong. A `Float` and a `Decimal`
look identical in TypeScript until the arithmetic diverges, whereas a paise integer that
picks up a fractional part fails loudly — `src/lib/money.ts` throws on any non-integer
input. Given that this codebase already lost money to exactly that class of silent error,
failing loudly is the right trade.

Convention: suffix every paise column and field with `Paise` (`grandTotalPaise`), so a
float creeping in is visible in review.

---

## AI service design

AI must be **optional, cheap and safe**. The design principle: the application never
depends on AI being configured.

```
Route handler
    │
    ▼
AiService (src/server/ai/)
    │
    ├─ enabled? ──── AI_ENABLED=false ──► return { available: false }; UI hides the feature
    │
    ├─ within budget? ── over ──► 429 with a clear message; never silently overspend
    │
    ├─ redact PII (AI_REDACT_PII=true) ──► strip party names, GSTINs, PANs, phones
    │
    ├─ cache hit? ──► return cached; identical questions cost nothing twice
    │
    └─► Provider ──┬─ MockProvider     (default; deterministic, no key, no spend)
                   ├─ OpenAIProvider
                   ├─ GeminiProvider
                   ├─ AnthropicProvider
                   └─ LocalProvider    (Ollama etc., zero marginal cost)
```

**Mock is the default.** `AI_PROVIDER=mock` returns deterministic canned responses, so
developers and CI exercise every AI code path without an API key or a bill, and tests stay
reproducible.

**Cost controls**, because AI spend is the one variable cost that can outrun ₹299/month
revenue:
- Per-tenant monthly token budget enforced before the call, not after.
- Response caching keyed on tenant + normalised prompt.
- `AI_MAX_TOKENS_PER_REQUEST` cap.
- Small models by default (`gpt-4o-mini`).
- Every call written to an `AiUsageLog` with token counts, so cost is attributable per
  tenant and per feature.

**Safety rules:**
- AI never writes to the ledger. It *proposes*; a human approves. An AI-suggested journal
  entry is a draft until a user confirms it.
- PII redaction on by default. A tenant's customer list is their asset, not training data.
- Tenant data is never mixed between tenants in a prompt or a cache key.
- Structured output (JSON schema) for OCR and categorisation, so a malformed response is a
  validation failure rather than a corrupt record.

**Highest-value features first:** invoice OCR for purchase-bill entry (removes the most
tedious data entry), then natural-language reporting ("aaj kitni sale hui?"), then expense
categorisation, then forecasting.

---

## Background jobs

Several operations should not run inside a request: PDF generation for bulk exports,
scheduled reports, payment reminders, recurring invoice generation, GSTR aggregation,
backups.

Recommendation: start with **PostgreSQL-backed queue** (`pg-boss`) rather than Redis +
BullMQ. It needs no extra infrastructure, and at the scale where a dedicated queue pays for
itself, revenue will support it. Defer Redis until it is genuinely needed for rate limiting
across multiple instances.

---

## Internationalisation

Hindi and English are a core requirement, not an afterthought — the target user is a
shopkeeper who may not read English comfortably.

Recommendation: `next-intl` with `messages/en.json` and `messages/hi.json`, locale stored on
the user record so it persists across devices. Keep **GST terminology in English**
(`CGST`, `SGST`, `HSN`, `GSTIN`) even in Hindi copy — that is what appears on statutory
documents and what accountants actually say.

Number and currency formatting must use the Indian grouping system (`1,00,000`, not
`100,000`). `Intl.NumberFormat("en-IN")` handles this and is already used in
`formatINR`/`formatPaise`.

---

## Performance

Targets appropriate to the audience — low-end Android phones on patchy mobile data:

| Operation | Target |
|---|---|
| Invoice list, first contentful paint | < 1.5 s on 3G |
| Create invoice (API round trip) | < 300 ms p95 |
| PDF generation | < 1 s |
| Report query | < 500 ms p95 |
| POS barcode scan → line added | < 100 ms |

Approach: server-render read paths (already done); index every `(companyId, date)` access
pattern (already done); paginate lists — currently `GET /api/invoices` returns **all**
invoices for a company with `include: { party: true }`, which will not survive a tenant with
50,000 invoices; cache computed report aggregates rather than recomputing per request;
generate PDFs in a background job for bulk exports.
