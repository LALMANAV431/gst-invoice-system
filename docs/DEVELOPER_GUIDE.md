# Developer Guide

How to work on this codebase without breaking the parts that are load-bearing.

Read [`ARCHITECTURE.md`](ARCHITECTURE.md) for the shape of the system and
[`AUDIT.md`](AUDIT.md) for the defects that shaped it. This document is about
day-to-day work: setup, conventions, where the traps are.

---

## Setup

```bash
node --version            # 20.x. 18 will not build.
npm ci
cp .env.example .env      # SQLite + a dev JWT_SECRET is enough
npm run db:setup          # prisma db push && seed
npm run dev
```

Sign in with `demo@gst.com` / `demo1234`.

There is deliberately **no seeded super-admin**. Create one explicitly:

```bash
npm run db:seed:admin -- --email you@example.com --password '<long-random>'
```

### Commands

| Command | Purpose |
|---|---|
| `npm run dev` | Dev server |
| `npm test` | Vitest, single run |
| `npm run test:watch` | Vitest, watch |
| `npm run typecheck` | `tsc --noEmit` |
| `npm run lint` | ESLint |
| `npm run build` | Production build |
| `npm run db:push` | Apply schema to the database |
| `npm run db:seed` | Reset and reseed demo data |
| `npm run docs:openapi` | Regenerate `docs/openapi.json` |
| `npm run docs:openapi:check` | Fail if that file is stale |

Before pushing: `npm run typecheck && npm run lint && npm test && npm run build`.

---

## Layout

```
src/
  lib/            Pure domain logic. No Prisma, no Next.js, no I/O.
    money.ts        Integer paise arithmetic
    gst.ts          GST computation, GSTIN validation
    accounting.ts   Double-entry posting rules
    inventory.ts    FIFO / weighted-average valuation
    totp.ts         TOTP (RFC 6238)
    i18n/           Typed translation dictionaries
    openapi.ts      API description, kept honest by a test
  server/         Persistence and orchestration. Prisma lives here.
    numbering.ts    Atomic document numbers, period locks
    ledger.ts       Journal posting, statements
    stock.ts        The only place stock changes
    services/       Per-document orchestration
    ai/ payments/ notify/
  app/
    api/            Route handlers. Thin: parse, authorise, delegate.
    (app)/          Authenticated pages
    admin/          Platform super-admin
  components/     Shared UI
prisma/
  schema.prisma   Single source of truth for the data model
  seed.ts         Demo data. Runs through the real engines.
```

**The `lib` / `server` split is the important one.** Anything in `lib/` is a pure function of
its inputs, so its behaviour can be pinned by a test without a database. That is why the GST
engine has 36 tests and the valuation engine has 60. If you find yourself importing `db` into
`lib/`, the logic is in the wrong place.

---

## Non-negotiables

### 1. Money is integer paise

```ts
import { toPaise, addPaise, mulPaise, percentOf, splitPaise } from "@/lib/money";
```

- Every stored and transported amount is an integer number of paise, in a field named
  `...Paise`.
- Never `+`, `-` or `*` on a rupee float. `100 x (3 x 33.33)` accumulates to
  `9998.999999999984`. That is money, gone.
- `toPaise()` parses strings digit-wise, because `parseFloat("0.145") * 100` is
  `14.499999999999998`.
- Round **once**, at the point tax is computed, half-up.
- `splitPaise(total, 2)` for a CGST/SGST split — the halves always sum back exactly.

The helpers **throw** on a fractional input. That is intentional: a unit mistake fails loudly
in development instead of quietly losing paise in production.

Quantities are the exception. They are floats, because trade units are fractional (2.5 kg).
Compare them with an epsilon, never `===`.

### 2. `companyId` comes from the session, never from the request

```ts
const ctx = await getCurrentUserAndCompany();
if (!ctx?.company) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

// Every query is scoped. findFirst with companyId, not findUnique by id.
const invoice = await db.invoice.findFirst({
  where: { id: params.id, companyId: ctx.company.id },
});
```

`findUnique({ where: { id } })` on a tenant-owned row is a cross-tenant read. Two real bugs
of exactly this shape have been found in this codebase — see
[Traps](#traps-that-have-actually-bitten).

Return **404** for another tenant's resource, not 403. A 403 confirms the id exists.

### 3. Validate with Zod before touching the database

```ts
const schema = z.object({ partyId: z.string().min(1), lines: z.array(lineSchema).min(1) });
const parsed = schema.safeParse(await req.json().catch(() => null));
if (!parsed.success) {
  return NextResponse.json({ error: parsed.error.issues[0]?.message }, { status: 400 });
}
```

`.catch(() => null)` matters: a malformed body should be a 400, not an unhandled 500.

### 4. `writeGuard()` on every mutation

```ts
const blocked = writeGuard(ctx);
if (blocked) return blocked;
```

Blocks read-only roles and suspended companies. Skip it only with a comment saying why —
language and notification-dismissal endpoints do, deliberately.

### 5. One transaction per document

Number allocation, the document, its stock movements and its ledger posting all land or none
do:

```ts
await db.$transaction(async (tx) => {
  const { number } = await allocateDocumentNumber(tx, { ... }); // tx, not db
  const invoice = await tx.invoice.create({ ... });
  await recordStockMovement(tx, { ... });
  await postJournalEntry(tx, companyId, posting);
});
```

Pass `tx` everywhere inside. Passing the global `db` puts that write outside the transaction
and reintroduces the numbering race the counter exists to prevent.

### 6. Totals are computed, never accepted

Take lines from the client; compute taxable values, tax, round-off and totals server-side via
`computeDocument()`. A client-supplied total is ignored. This is why the API cannot book an
invoice whose tax does not follow from its lines.

### 7. Stock changes only through `recordStockMovement()`

```ts
import { recordStockMovement } from "@/server/stock";
```

It writes the movement row and updates the cached quantity together. Doing the two by hand is
how they drift apart — and inventory value is derived from those rows, so drift means every
valuation is wrong. Nine call sites used to do it by hand; none do now.

### 8. Adjustments do not post to the ledger

The books use **periodic inventory**: a purchase is charged to `Purchases` on receipt, not
capitalised as an asset. So goods written off have already been expensed, and posting again
double-counts the loss. Stock adjustments, counts, challans and GRNs change quantities only.

If you think you need a ledger entry for a stock movement, re-read
[`INVENTORY_VALUATION.md`](INVENTORY_VALUATION.md) first.

---

## Adding an endpoint

1. Write the handler in `src/app/api/.../route.ts`. Keep it thin: parse, authorise, delegate
   to `src/server/`.
2. Put the logic in `src/server/services/` (needs the database) or `src/lib/` (does not).
3. **Describe it in `src/lib/openapi.ts`.** `npm test` fails until you do — see below.
4. `npm run docs:openapi` and commit the regenerated JSON.
5. Test the pure parts. Add a live check to a verification script for the wiring.

### The OpenAPI spec cannot drift

`src/lib/openapi.test.ts` walks `src/app/api`, derives each route's path and exported HTTP
verbs from the files, and fails if:

- a route is missing from the spec, **or**
- the spec describes a route or method that does not exist, **or**
- an operation has no summary, no tag, no 2xx, or no 401/403 (unless it is on the short list
  of deliberately public endpoints), **or**
- a `$ref` dangles, or a schema is defined and never used.

If you genuinely should not document an endpoint, add it to `UNDOCUMENTED_ROUTES` with a
reason. The test requires the reason to be a real sentence.

The spec is TypeScript rather than YAML precisely so this is possible, and so enumerations are
imported from the modules that define them instead of being retyped.

---

## Testing

285+ tests, all in `*.test.ts` beside the code, run by Vitest.

The suite covers the **pure domain layer** thoroughly and the HTTP layer not at all. That is a
deliberate trade, and it is the biggest known gap — see
[`ROADMAP.md`](ROADMAP.md).

### What a good test looks like here

Name the behaviour and the reason, not the function:

```ts
it("applies a discount before tax, not after", () => {
  // Rs 1,000 off Rs 10,000 at 18%: tax must be on 9,000, not on 10,000.
  // The old code taxed the full amount and then discounted, overcharging Rs 180.
  expect(result.taxTotalPaise).toBe(toPaise(1620));
});
```

### Invariants beat examples

Where an invariant exists, assert the invariant against randomised input. The valuation engine
does this:

```ts
// openingValue + inValue === cogs + closingValue, exactly, in paise
expect(valuationConserves(result)).toBe(true);
```

200 randomised movement streams with awkward fractional quantities and deliberate over-issues.
That single property is worth more than fifty hand-picked cases, because it holds through the
rounding and negative-stock paths where hand-picked cases run out of imagination.

### Validate against published vectors where they exist

`totp.ts` is checked against the five RFC 6238 test vectors. If you implement something
standardised, find its vectors.

### The seed is a test

`prisma/seed.ts` posts through the real engines and then **asserts**:

- debits equal credits, and
- every item's cached quantity equals its movement-register balance.

So `npm run db:seed` fails loudly if a posting rule or a stock path breaks. Never pipe its
output to `/dev/null` — that once hid a broken seed for a whole session, because an empty
database reached a passing-looking check.

**If you add a table with a foreign key, extend the wipe list at the top of the seed**, in
dependency order. Forgetting produces an opaque `P2003`.

### Demonstrable demo data

If a feature cannot be seen in the seeded data, it looks broken. Two examples that were
fixed:

- The financial year was hardcoded while transactions were dated relative to today, so the
  year contained no data and period locking had nothing to guard.
- Every item was purchased at its opening cost, so FIFO and weighted average produced
  identical numbers and the whole valuation feature looked inert.

When you add a feature, add the data that shows it working — including the unhappy path
(an overdue invoice, an expired batch, an item below cost).

---

## Traps that have actually bitten

Each of these was a real bug found in this repository.

### TDZ inside `$transaction`

```ts
const note = await db.$transaction(async (tx) => {
  const created = await tx.creditNote.create({ ... });
  await recordStockMovement(tx, { sourceId: note.id });   // ReferenceError
});
```

`note` is in its temporal dead zone inside its own initialiser. This crashed **every** credit
note. Reference the inner variable (`created.id`). TypeScript does not catch it.

### `findUnique` by id on tenant data

`DELETE /api/items` deleted by id alone, so any signed-in user could delete another company's
item by guessing an id. Always `findFirst` with `companyId` first.

### Changing cached state without a movement

Editing an item's opening stock adjusted the cached quantity and wrote no stock movement,
putting quantity out of agreement with the register that valuation reads. Everything that
changes stock goes through `recordStockMovement()`.

### `createdAt` is not "when this happened"

Dead stock was measured from `Item.createdAt`, which is when the **row** was written. An item
imported today holding six-month-old stock reported as 0 days idle. Use the date of the
business event — here, the oldest remaining FIFO layer.

Caught by live verification, not by a test, because the test supplied both dates and the code
picked the wrong one consistently.

### Unit mismatch between two sources of the same field

`PlanConfig.price` was declared as rupees and set to `299`, while the database override put
paise in the same field, and every screen formatted it as paise. Correct once an override
existed; **₹2.99 on a fresh install**. Name money fields for their unit and pin them with a
test.

### PII redaction with a shared counter

A global counter produced `[PHONE_2]` with no `[PHONE_1]`, so rehydration could not map values
back. Counters must be per label.

### `.toFixed(2)` on paise

GSTR-1 JSON applied `.toFixed(2)` to a paise integer, overstating every figure a hundredfold.
Convert at the presentation boundary, once, with `toRupees()`.

### Prisma does not support `/** */`

Only `//` and `///` in `schema.prisma`. A block comment is a parse error.

### `output: "standalone"` omits `node_modules/.bin`

So `npx prisma` fails in the slim Docker image. The Dockerfile recreates the symlink, and the
migrate compose service uses the builder stage because seeding needs `tsx`.

---

## i18n

```ts
// Server component
const { t } = getTranslator(normaliseLocale(ctx.user.locale));
// Client component
const { t } = useT();
```

`en.ts` is the source of truth and defines `TranslationKey`. `hi.ts` is typed as
`Dictionary`, so **a missing Hindi key is a compile error**. There is no runtime fallback: a
half-translated screen is worse than an untranslated one, and silent fallback is how you ship
one.

**GST and accounting terms stay English in the Hindi dictionary** — CGST, SGST, IGST, HSN,
GSTIN, TDS, Cess, FIFO. Translating them would be correct Hindi and a usability regression;
these are the words on the form. A test asserts they are not translated, and that everything
else is.

Never hardcode a user-visible string in a component.

---

## Working in this sandbox

Notes for anyone using the same environment:

- **Each tool call gets a fresh PID namespace**, so a background dev server does not survive
  between calls. Live verification has to start the server, run the checks and shut down
  inside **one** invocation. See `/projects/sandbox/verify-*.sh`.
- Node needs selecting first: `export NVM_DIR="/root/.nvm" && . "$NVM_DIR/nvm.sh" && nvm use 20`.
- `DATABASE_URL` and `JWT_SECRET` must be exported for CLI work.

---

## Before you open a pull request

- [ ] `npm run typecheck` — zero errors
- [ ] `npm run lint` — clean
- [ ] `npm test` — all pass
- [ ] `npm run build` — succeeds
- [ ] `npm run db:seed` — succeeds, and the balance assertions pass
- [ ] `npm run docs:openapi:check` — up to date
- [ ] New endpoints described in `src/lib/openapi.ts`
- [ ] New money fields are integer paise and named `...Paise`
- [ ] New queries scoped by `companyId`
- [ ] Anything non-obvious has a comment saying **why**, not what

See [`CONTRIBUTING.md`](../CONTRIBUTING.md) for review expectations.
