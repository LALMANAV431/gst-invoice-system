# Inventory Valuation

How this application decides what your stock is worth, and why.

Everything here is implemented in `src/lib/inventory.ts` (pure arithmetic, 60
tests) and `src/server/services/inventory.service.ts` (loads movements, persists
documents). No figure below is stored: all of it is recomputed from the stock
movement ledger on request, so a report can never disagree with the transactions
behind it.

---

## The defect this replaces

Before this work, closing stock was valued as:

```ts
// src/app/(app)/reports/page.tsx
const stockValue = items.reduce((s, i) => s + i.currentStock * i.purchasePricePaise, 0);
```

That is the item's **current purchase price** multiplied by quantity. It is not
a recognised valuation method, and it has a specific, damaging consequence:

> Raise the purchase price of an item you already hold, and the reported value of
> yesterday's stock changes. Profit moves between periods with no transaction
> behind it.

AS 2 / Ind AS 2 (*Valuation of Inventories*) require cost to be assigned by a
cost formula — **FIFO** or **weighted average** — applied consistently.

---

## The stock ledger is the source of truth

Every quantity change writes one `StockMovement` row. There are no exceptions:
all nine former call sites now go through `recordStockMovement()` in
`src/server/stock.ts`, which writes the movement and updates `Item.currentStock`
together.

| Field | Meaning |
|---|---|
| `type` | `IN` or `OUT` |
| `quantity` | Always positive; `type` carries the sign |
| `valuePaise` | Total cost of a **receipt**. Authoritative. |
| `ratePaise` | Per-unit cost, for display |
| `sourceType` | `OPENING`, `PURCHASE`, `SALE`, `GRN`, `ADJUSTMENT`, `COUNT`, `TRANSFER`, `SALES_RETURN`, `PURCHASE_RETURN`, `DELIVERY_CHALLAN` |
| `sourceId` | Id of the document that caused it |

**Issues carry no cost.** `valuePaise` stays `0` on an `OUT` row. The whole point
of the valuation engine is to work out what an issue cost; storing the sale price
there would let a report read revenue as cost.

### Cost of a purchase

Per AS 2, the cost of purchased inventory is the price paid, less trade discount,
**excluding taxes recoverable from the authorities**:

```ts
// src/server/stock.ts
purchaseCostPaise(line, gstScheme)
```

- **Regular dealer** — claims input tax credit, so GST is recoverable and is *not*
  a cost of the goods. Cost = taxable value net of discount.
- **Composition dealer** — cannot claim ITC, so the tax *is* part of what the
  stock cost. Cost = taxable value + CGST + SGST + IGST + cess.

Getting this backwards misstates both closing stock and gross profit by the whole
tax amount, so the scheme is a required argument rather than a default.

### Opening stock

Opening stock is written as a real `StockMovement` with `sourceType = "OPENING"`,
valued at `Item.openingRatePaise`. That rate is a separate column from
`purchasePricePaise` deliberately: re-pricing an item must not retrospectively
revalue stock you already held.

For legacy items that predate this (no `OPENING` movement but a non-zero
`openingStock`), the engine synthesises an opening position. The check is per
item, so an item that *does* have a real opening movement is never
double-counted.

---

## The conservation invariant

For both methods, including every negative-stock and rounding path:

```
openingValue + inValue === cogsPaise + closingValuePaise
```

Not approximately. Exactly, in integer paise. `valuationConserves()` asserts it,
and the test suite checks it against 200 randomised movement streams with awkward
fractional quantities and deliberate over-issues.

Every rounding decision exists to protect that equality. The key one:

> When a FIFO layer is fully consumed, take its **entire remaining value** rather
> than recomputing `quantity x rate`. Recomputing is what lets fractions escape.

Live proof from the demo data — the same goods, both methods:

| | Closing stock | COGS | Total |
|---|---|---|---|
| FIFO | ₹5,51,585.00 | ₹60,760.00 | ₹6,12,345.00 |
| Weighted average | ₹5,51,365.65 | ₹60,979.35 | ₹6,12,345.00 |

The split between asset and expense differs by ₹219.35. The total does not move
by a single paisa.

---

## FIFO

Layers are held in receipt order. An issue consumes the oldest first.

```
10 @ ₹100  then  10 @ ₹150,  issue 10
  -> COGS ₹1,000   (the old lot)
  -> closing 10 @ ₹150 = ₹1,500
```

FIFO also produces the **layers** that stock ageing needs. A company valuing at
weighted average still gets ageing, because a parallel FIFO pass is run for that
purpose: how long goods have sat is a fact about the goods, independent of how
their cost was assigned.

## Weighted average

The **moving (perpetual)** average: every receipt re-averages the whole holding,
every issue leaves at the average current at that moment.

```
10 @ ₹100  then  10 @ ₹150   -> 20 @ ₹125
```

This is what Tally calls *Avg. Cost*. It is **not** the periodic weighted average
(total purchases ÷ total units for a whole period), which weights later purchases
differently. Issue order matters:

```
in 10 @ ₹100, issue 10, in 10 @ ₹150
  -> COGS ₹1,000  (not ₹1,250 — the ₹150 lot did not exist yet)
```

---

## Negative stock

Real businesses sell before recording the purchase. The engine handles it rather
than refusing or silently costing at zero.

1. Available layers are consumed.
2. The shortfall is costed at the best rate known (the item's purchase price, or
   the last receipt rate), so **COGS is not understated**.
3. The position is held as a trailing layer with negative quantity and negative
   value, and `negativeStockQuantity` is reported so screens can disclose it.
4. The next receipt **cancels the negative position first** — those units were
   already issued and expensed.
5. Any difference between the guessed cost and the real one becomes
   `costVariancePaise`, recognised in COGS. A cost correction on goods that have
   already gone belongs in cost of sales, not in the value of stock on hand.

Conservation still holds exactly through all five steps.

---

## Lower of cost and net realisable value

AS 2 requires stock to be carried at the **lower** of cost and net realisable
value. The valuation report flags every line where cost exceeds what the goods
would currently fetch (`belowCost`), showing cost and realisable value
side by side.

It **flags rather than revalues**. A write-down is a judgement the business must
make and record, not something software should apply silently.

---

## Why adjustments do not post to the ledger

The books use **periodic inventory**: a purchase is charged to the `Purchases`
expense ledger when the goods arrive, rather than capitalised to a
`Stock-in-Hand` asset. Consequently:

> Goods written off on a stock adjustment have **already been expensed**. Posting
> a second entry would double-count the loss.

So `StockAdjustment`, `PhysicalCount`, delivery challans and GRNs all change
**quantities only**. Live verification asserts that zero journal entries have
`sourceType = "StockAdjustment"`, and that the trial balance still balances after
five adjustments.

The closing-stock figure reaches the P&L through the year-end closing entry, not
through individual movements.

---

## Changing the valuation method

`PUT /api/company` refuses a change to `stockValuationMethod` unless the request
includes `acknowledgeRestatement: true`, returning `409 VALUATION_RESTATEMENT`.

The reason: valuation is *derived*, not stored. Switching method does not only
affect future stock — it **restates every historical valuation**, and with it the
gross profit of periods that may already have been reported. AS 2 requires a
change of accounting policy to be deliberate and disclosed, so the API makes the
user say so out loud. The change is written to the audit log.

---

## Stock corrections

### Adjustments

`StockAdjustment` covers every quantity change that no invoice or purchase
explains. **The reason code fixes the direction**, so a client cannot file a
"damage" that increases stock:

| Reduces stock | Increases stock |
|---|---|
| `DAMAGE`, `EXPIRY`, `THEFT`, `SAMPLE`, `CONSUMPTION`, `SHORTAGE` | `EXCESS`, `PRODUCTION`, `RETURN_TO_STOCK`, `OPENING` |

Only a posted physical count may mix directions in one document, because one
count sheet legitimately finds both shortages and excesses.

### Physical counts

Creating a count sheet **freezes the book quantity** onto every line, and
pre-fills the counted quantity with it.

- Frozen, because comparing a count taken this morning against a book figure
  recomputed this evening would silently absorb the day's trading into the
  variance.
- Pre-filled, because a sheet defaulting to zero would write off the entire
  warehouse the moment somebody posted it half-finished.

Posting converts the variances into **one** `StockAdjustment`. Variances reach
stock only through an adjustment, so there is a single audited path for "stock
changed without a trading document". A posted sheet is immutable; a count that
agrees is still recorded as evidence, with no adjustment created.

---

## Ageing, dead stock and expiry

**Ageing** buckets the remaining FIFO layers by receipt date: 0-30, 31-60, 61-90,
91-180, over 180 days. The buckets sum exactly to the closing stock value.

**Dead stock** is stock held with no issue for `Company.deadStockDays` (default
90). For an item that has never sold, the clock runs from **when the stock
arrived** — the oldest remaining FIFO layer — not from `Item.createdAt`.

> This was a real defect caught by live verification. `createdAt` is when the
> database row was written, which for an item imported from a spreadsheet is
> today. A seeded item holding stock dated 120 days earlier reported as 0 days
> idle. The report now says 120.

**Expiry** classifies batches holding stock: `EXPIRED`, `EXPIRING_30`,
`EXPIRING_90`, `OK`, `NO_EXPIRY`. Expiry is judged on the **date**, not the
instant — a batch expiring today is not expired until tomorrow, which is how a
date printed on a pack is read. Only batches with a positive quantity are
reported: a fully sold batch cannot expire on your shelf, and listing it would
bury the ones needing action.

---

## Reports

| Endpoint | Shows |
|---|---|
| `GET /api/reports/inventory` | Closing stock and COGS per item, with flags |
| `GET /api/reports/inventory?view=ageing` | Age buckets, company and per item |
| `GET /api/reports/inventory?view=dead` | Items not moving, by value |
| `GET /api/reports/inventory?view=expiry` | Batches at or near expiry |
| `GET /api/reports/inventory?view=ledger&itemId=` | Full movement history with running cost |

The ledger view is the drill-down behind a valuation figure — the answer to *"why
is my closing stock this number"*:

```
date         dir  ref                   qty       value        rate   bal.qty    bal.value
2026-05-01   IN   Opening                25   312500.00    12500.00        25    312500.00
2026-06-15   OUT  INV/26-27/0004          1    12500.00    12500.00        24    300000.00
2026-08-04   IN   PUR/26-27/0001         10   125000.00    12500.00        34    425000.00
2026-08-09   OUT  INV/26-27/0001          2    25000.00    12500.00        32    400000.00
```

---

## Ledger drift

`ItemValuation.ledgerDriftQuantity` is the difference between the denormalised
`Item.currentStock` and the balance the movement ledger implies. **It should
always be zero.** A non-zero value means some code path changed stock without
recording a movement.

It is surfaced on the valuation screen rather than hidden, because that is how
such a bug gets found instead of quietly distorting every valuation. The seed
asserts it is zero for every item, so `npm run db:seed` fails loudly if a new
code path forgets to record a movement.

---

## Known limitations

- **Sales returns are valued at an estimated cost**, not the exact FIFO layer the
  original issue consumed. The estimate is the weighted average of costed
  receipts (`estimateCostRate`), which stays inside the range of prices actually
  paid. Layer-exact return costing needs per-issue layer tracking; see
  `docs/ROADMAP.md`.
- **Valuation replays all movements per request.** One query loads them and
  grouping happens in memory, which is fine for a few hundred items. A tenant
  with a very long history needs a materialised period-opening snapshot rather
  than a loop of queries.
- **Godown-level valuation is partial.** Movements record `godownId`, but
  `Item.godownId` is a single field, so per-godown quantities are not yet a
  first-class balance.
- **Batch-level costing is not layered.** Batches carry quantity and expiry;
  their value is reported at the item's purchase price rather than per-batch FIFO.
