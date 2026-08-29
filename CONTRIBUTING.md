# Contributing

Thanks for helping. This is accounting software, so the bar is a little different from most
web projects: a wrong number here becomes a document somebody has to defend to a tax
authority. That shapes everything below.

Start with [`docs/DEVELOPER_GUIDE.md`](docs/DEVELOPER_GUIDE.md) for setup and conventions.

---

## The short version

```bash
npm ci && cp .env.example .env && npm run db:setup && npm run dev
```

Before opening a pull request:

```bash
npm run typecheck && npm run lint && npm test && npm run build && npm run db:seed
npm run docs:openapi:check
```

---

## What we care about most

### 1. Money must be exact

Every amount is an **integer number of paise**, in a field named `...Paise`, and arithmetic
goes through `src/lib/money.ts`. No exceptions, no "just this once for a display value".

If you are tempted to use a float for money, read the top of `money.ts` — it opens with the
reproducible failure that cost this project a schema migration across 93 columns.

Quantities are floats, because trade units are fractional. Compare them with an epsilon.

### 2. Tenant scoping is not optional

`companyId` comes from the session, never from a request body. Every query filters on it.
`findFirst` with `companyId`, not `findUnique` by id.

A cross-tenant read or write is treated as a security bug, not a bug. Two have already been
found in this codebase.

### 3. Explain *why*, not *what*

The code says what it does. A comment should say why it does it that way, especially when the
obvious approach is wrong.

```ts
// Bad — restates the code
// Loop over the lines and add up the tax
```

```ts
// Good — records the decision
// Discount comes off BEFORE tax per s.15(3) CGST Act. Taxing the gross and then
// discounting overcharged GST by Rs 180 on a Rs 1,000 discount at 18%.
```

If you removed a workaround, say what it was protecting against. If you chose the slower
approach, say why the faster one was unsafe.

### 4. Tests should pin behaviour, not implementation

Name the behaviour and, where there was a bug, the bug:

```ts
it("does not treat a batch expiring today as already expired", () => {
  // A date printed on a pack means "use by end of this day".
  expect(expiryStatus(today, now)).toBe("EXPIRING_30");
});
```

**Prefer invariants over examples** where one exists. Randomised property tests found rounding
bugs in the valuation engine that no hand-picked case would have:

```ts
// openingValue + inValue === cogs + closingValue, exactly, in paise
expect(valuationConserves(result)).toBe(true);
```

**Use published test vectors** when implementing anything standardised. `totp.ts` is checked
against RFC 6238's.

### 5. If a feature cannot be demonstrated, it looks broken

Extend `prisma/seed.ts` so your feature is visible in the demo data — including its unhappy
path. Two things shipped looking inert because of this:

- The financial year was hardcoded while data was dated relative to today, so period locking
  had nothing to guard.
- Every item was bought at its opening cost, so FIFO and weighted average produced identical
  numbers.

The seed is also a test: it asserts the books balance and that stock quantities agree with the
movement register. **If you add a table with a foreign key, extend the wipe list** at the top,
in dependency order.

---

## Pull requests

### Size

Small and single-purpose. One reviewable change per PR.

Concretely: do not mix a mechanical refactor with a behaviour change. A reviewer who cannot
tell an added `await` from an altered tax rule will approve both or neither, and both outcomes
are bad. The Next.js 16 upgrade is deliberately deferred for exactly this reason — it makes
`cookies()`, `headers()` and `params` async across every route, and bundling it with GST logic
would make the GST logic unreviewable.

### Description

Use the template. It asks for:

- **What changed and why** — the problem, not just the patch.
- **How you verified it** — actual output, not "tested locally". If you fixed a calculation,
  show the before and after numbers.
- **Anything you deliberately did not do**, and why. This is genuinely valuable; it stops the
  next person rediscovering a dead end.

A good description of a bug fix states the wrong number and the right one.

### Review

Expect questions about correctness, tenant scoping and money units. They are not personal —
those three are where this codebase has actually been wrong.

Reviewers should check:

- [ ] Money is integer paise, converted only at the presentation boundary
- [ ] Queries scoped by `companyId`; another tenant's id returns 404, not 403
- [ ] Multi-table writes are in one `$transaction`, with `tx` passed throughout
- [ ] Totals computed server-side, not accepted from the client
- [ ] `writeGuard()` on mutations, or a comment explaining the exemption
- [ ] Zod validation before any database access
- [ ] Stock changes go through `recordStockMovement()`
- [ ] New endpoints described in `src/lib/openapi.ts` (the test enforces this)
- [ ] New user-visible strings are in **both** dictionaries
- [ ] Comments explain reasoning, not mechanics

---

## Commit messages

Explain the change and its reason. The subject line says what changed; the body says why it
was wrong before.

```
Apply invoice discount before tax, not after

s.15(3) CGST Act requires a discount to reduce the taxable value. The previous
code taxed the gross and then subtracted, overcharging GST by Rs 180 on a
Rs 1,000 discount at 18% — on every discounted invoice ever raised.

Tax on the example is now Rs 1,620, not Rs 1,800.
```

Reference an issue where one exists. Do not force-push a branch under review.

---

## Reporting bugs

Use the bug template. For anything involving a number, please include:

- what the figure was, and what you expected
- the document type and its GST configuration (intra/inter-state, rate, discount, cess,
  reverse charge, composition)
- the stock valuation method, if it is inventory-related

**If a report contains a real GSTIN, PAN, Aadhaar number, bank detail or customer name,
replace it with a placeholder.** The repository must never contain real tax identifiers or
personal data — including in issues, tests, fixtures and seed data.

### Security issues

Do **not** open a public issue. Follow [`SECURITY.md`](SECURITY.md).

---

## Hard rules

1. **No real secrets, GSTINs, PANs, Aadhaar numbers, bank details or personal data** anywhere
   in the repository. Seed data uses synthetic, checksum-valid fictional identifiers.
2. **No floats for money.**
3. **No `companyId` from a request body.**
4. **No new dependency without justification.** `totp.ts` is ~80 lines written by hand because
   the algorithm is less supply-chain surface than a package, and the security-critical parts
   stay visible and testable. Apply the same judgement.
5. **Do not weaken a test to make it pass.** If a test is wrong, fix the test and say why in
   the commit message.
6. **Do not add AI as a hard dependency.** Every AI feature must degrade cleanly to
   unavailable. The application has to work fully with no API key.

---

## Open work

[`docs/ROADMAP.md`](docs/ROADMAP.md) lists what is planned and what was deliberately deferred,
with reasoning. The highest-value gaps today:

- **Integration tests for the HTTP layer, especially cross-tenant isolation.** The pure domain
  layer is well covered; the routes are not. This is the biggest untested risk.
- **Next.js 16 upgrade** — clears the remaining `high` advisories.
- **PostgreSQL** for multi-instance deployment.
- **Ledger reversal on document *edit* paths** (create, delete and cancel are handled).
- **Redis-backed rate limiting**; the in-process limiter does not work across instances.
