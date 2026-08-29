<!--
Delete sections that genuinely do not apply. Do not delete a section because filling it in
is inconvenient — the checklists below exist because each item has been wrong here at least
once.
-->

## What this changes

<!-- The problem, then the change. One or two paragraphs. -->

## Why

<!--
Why the previous behaviour was wrong, or why this is needed. If you fixed a calculation,
state the wrong number and the right one:

  Rs 1,000 discount on a Rs 10,000 invoice at 18% produced tax of Rs 1,800.
  Correct is Rs 1,620 — s.15(3) CGST Act requires the discount before tax.
-->

## How I verified it

<!--
Actual evidence, not "tested locally". Paste output. For example:

  npm test                -> 300 passed
  npm run db:seed         -> debits = credits = Rs 831117.30
  GET /api/reports/inventory?view=valuation
                          -> FIFO stock 551585.00, COGS 60760.00, drift 0 on all items
-->

```
```

## Deliberately not done

<!--
Anything you considered and rejected, with the reason. This is one of the most useful parts
of a PR here — it stops the next person rediscovering a dead end, and it tells the reviewer
where the boundaries of the change are.
-->

---

## Checklist

```
[ ] npm run typecheck            zero errors
[ ] npm run lint                 clean
[ ] npm test                     all pass
[ ] npm run build                succeeds
[ ] npm run db:seed              succeeds, balance assertions pass
[ ] npm run docs:openapi:check   up to date
```

### Correctness

- [ ] Every new monetary value is **integer paise**, in a field named `...Paise`
- [ ] No float arithmetic on money; conversion happens once, at the presentation boundary
- [ ] Quantities compared with an epsilon, not `===`
- [ ] Totals are computed server-side, never accepted from the client
- [ ] If tax logic changed, `docs/GST_COMPLIANCE_NOTES.md` still describes what the code does

### Tenant safety

- [ ] `companyId` comes from the session, never from a request body
- [ ] Every query is scoped by `companyId` (`findFirst`, not `findUnique` by id)
- [ ] Another tenant's id returns **404**, not 403
- [ ] `writeGuard()` on mutations, or a comment explaining the exemption

### Data integrity

- [ ] Multi-table writes are in one `$transaction`, with `tx` passed throughout
- [ ] Document numbers allocated inside that transaction
- [ ] Stock changes go through `recordStockMovement()`
- [ ] Schema change: seed wipe list extended in dependency order

### Interfaces

- [ ] New endpoints described in `src/lib/openapi.ts` (the test enforces this)
- [ ] New user-visible strings added to **both** `en.ts` and `hi.ts`
- [ ] GST/accounting terms left in English in the Hindi dictionary
- [ ] Seed data demonstrates the feature, including its unhappy path

### Documentation

- [ ] `CHANGELOG.md` updated under Unreleased
- [ ] Comments explain **why**, not what
- [ ] Anything deferred is recorded in `docs/ROADMAP.md` with the reasoning

### Security

- [ ] No real secrets, GSTINs, PANs, Aadhaar numbers, bank details or personal data
- [ ] New dependencies justified (or none added)
- [ ] `npm audit --audit-level=high` no worse than before
- [ ] Auth, permissions or payment paths touched → say so explicitly here:

<!-- If you changed anything security-relevant, describe it. Do not leave it implicit. -->
