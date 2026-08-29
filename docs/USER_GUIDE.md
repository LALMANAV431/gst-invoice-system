# User Guide

For the business owner, accountant or billing clerk using the application day to day.
Hindi ke liye: har screen par ऊपर-दाईं ओर भाषा टॉगल है — **EN / हिं**.

Everything below describes what the software actually does today. Where a behaviour
might surprise you, the reason is given, because in accounting software a surprise is
usually a number you will have to defend to somebody.

---

## Contents

1. [First 15 minutes](#first-15-minutes)
2. [Everyday billing](#everyday-billing)
3. [What the GST on your invoice is doing](#what-the-gst-on-your-invoice-is-doing)
4. [Purchases and expenses](#purchases-and-expenses)
5. [Getting paid](#getting-paid)
6. [Stock](#stock)
7. [Reports](#reports)
8. [Filing GST](#filing-gst)
9. [Closing a period](#closing-a-period)
10. [Things that will refuse to happen, and why](#things-that-will-refuse-to-happen-and-why)

---

## First 15 minutes

Do these in order. Later steps depend on earlier ones.

### 1. Company details — Settings

| Field | Why it matters |
|---|---|
| **GSTIN** | Checked for a valid check digit. A typo is rejected here rather than by the GST portal a month later. |
| **State** | Decides CGST+SGST versus IGST on every invoice you raise. Get this wrong and every tax split is wrong. |
| **GST scheme** | `REGULAR` or `COMPOSITION`. A composition dealer issues a **bill of supply**, cannot charge GST, and cannot claim input credit. |
| **Financial year** | April–March. Document numbering and every report key off this. |
| **Round invoice totals** | On by default. Rounds the grand total to the nearest rupee and shows the adjustment separately. |
| **Stock valuation method** | FIFO or weighted average. Read [Stock](#stock) before changing it. |

### 2. Number formats — Settings

Prefixes for each document type (`INV`, `PUR`, `PMT`, `QUO`, `CN`, `DN`, `ADJ`, `PC`).
Numbers come out as `INV/26-27/0042` — prefix, financial year, then a gap-free sequence.

You cannot choose the sequence. GST requires a consecutive series with no gaps, so it is
allocated by the system, per financial year, and it restarts at 1 each April.

### 3. Parties — Customers and suppliers

Add a **state code** for anyone GST-registered. It is what decides IGST versus CGST+SGST.
For an unregistered walk-in customer, leave the GSTIN blank.

### 4. Items

| Field | Notes |
|---|---|
| **HSN / SAC** | Required on GST returns. Fill it now; retro-fitting it across 400 items later is miserable. |
| **GST rate** | 0, 5, 12, 18 or 28. |
| **Supply type** | See the table in [What the GST is doing](#what-the-gst-on-your-invoice-is-doing). Exempt, nil-rated and non-GST all charge 0% but are **different things on a return**. |
| **Pricing mode** | `EXCLUSIVE` (rate + GST) or `INCLUSIVE` for MRP goods where the printed price already contains tax. |
| **Opening stock** and **opening cost** | Quantity you already hold and what it cost you. The cost is kept separately from the current purchase price on purpose — see [Stock](#stock). |
| **Reorder level** | Below this, you get a low-stock alert. |
| **Track batches** | Turn on for anything with a shelf life or a lot number. |

You can bulk-import items and parties from CSV. Column names are matched loosely
(`saleprice`, `sellingprice`, `mrp` and `rate` all work).

### 5. Opening balances

If you are moving from another system mid-year, enter what customers owe you and what you
owe suppliers as party opening balances, and your bank and cash balances as ledger opening
balances. Without them the books start from zero and your balance sheet will not tie to
reality.

---

## Everyday billing

### Raising an invoice

**Sales Invoices → New.** Pick a customer, add lines, save.

- You type the **rate in rupees**. It is stored to the paisa.
- **Line discount** goes in the discount column. **Whole-bill discount** goes in the footer
  and is shared across the lines in proportion to their value.
- Either way the discount comes off **before** tax is worked out. That is what section 15(3)
  of the CGST Act requires, and it means a discount reduces the GST you owe.
- The totals are computed by the server, not the browser. You cannot save an invoice whose
  tax does not follow from its lines.

### POS billing

**POS Billing** is a faster path for over-the-counter sales: scan or search, quantities,
take payment, print. Same engine, same numbering, same ledger effect as a normal invoice.

### Quotations

A quotation is not a transaction. It moves no stock and touches no ledger. **Convert** it
when the customer agrees, and *that* is when stock moves and the sale is booked.

### Orders and delivery challans

| Document | Stock | Books |
|---|---|---|
| **Sales order** | No movement | Nothing |
| **Delivery challan** | Goods go **out** | Nothing |
| **Purchase order** | No movement | Nothing |
| **GRN** (goods received note) | Goods come **in** | Nothing |

Orders are promises, so they change nothing. A challan or a GRN moves goods, so it changes
stock. Neither posts to your books — that happens when you convert to an invoice or a
purchase bill.

**Stock is never counted twice.** If a challan already sent the goods out, converting it to
an invoice does not send them out again. A sales order did not move anything, so converting
*it* does.

Deliver part of an order and it becomes `PARTIAL`, showing what is still owed.

A delivery challan needs a **transporter, vehicle number and a reason** (job work, on
approval, branch transfer, replacement). GST requires those when goods move without an
invoice.

### Credit and debit notes

- **Credit note** — a sales return, or you overcharged. Goods come back into stock.
- **Debit note** — a purchase return, or a supplier overcharged you.

Returned goods come back in at what they **cost** you, not at the price on the credit note.
Otherwise every return would inflate your stock value by your own profit margin.

---

## What the GST on your invoice is doing

### Which tax applies

| Your state vs place of supply | Tax |
|---|---|
| Same | **CGST + SGST**, half each |
| Different | **IGST**, the full rate |

Never both. If the split looks wrong, check the state code on the party — that is almost
always the cause.

When the rate produces an odd number of paise, the two halves cannot be equal. On ₹105.05
at 5% you get CGST ₹2.63 and SGST ₹2.62. That is unavoidable arithmetic; what matters is
that the halves always add back to the total exactly, and they do.

### Supply types

| Type | GST | On the return |
|---|---|---|
| **Taxable** | At the rate | Normal outward supply |
| **Exempt** | None | Exempt supplies |
| **Nil rated** | 0% | Nil-rated supplies |
| **Non-GST** | Outside GST | Non-GST supplies |
| **Zero rated** | 0%, credit still claimable | Exports / SEZ |

Three of these charge nothing, and they are still four different boxes on GSTR-1. Pick the
right one.

### Reverse charge

On a reverse-charge supply the **buyer** pays the tax, not you. Tick it and the invoice
shows the tax for information without adding it to what the customer owes you.

### Cess

Some goods (aerated drinks, tobacco, some vehicles) carry compensation cess on top of GST,
as a percentage, a per-unit amount, or both. Set it on the item.

### TDS

Where a customer withholds TDS, enter the rate. The TDS is shown **separately and is not
deducted from the invoice total**. The invoice is still for the full amount; the customer
simply pays you less and deposits the difference. Netting it into the total would understate
your sales and your GST.

### MRP / inclusive pricing

For `INCLUSIVE` items the printed price already contains GST, so the taxable value is worked
back out of it. A ₹40 drink at 28% + 12% cess is ₹28.57 taxable, not ₹40.

---

## Purchases and expenses

**Purchases → New.** Record the supplier's bill, their bill number, and the date.

- **ITC eligible** — tick when you can claim the input tax credit. It drives your GST
  summary, so an incorrect tick misstates what you owe.
- Stock comes in carrying its cost. For a regular dealer that cost **excludes GST**, because
  you recover the GST as input credit — it is not a cost of the goods. For a composition
  dealer it **includes** GST, because you cannot claim it.

**Expenses** are for costs with no stock: rent, salaries, electricity, fuel. Each posts to an
expense ledger, so it lands in your profit and loss.

---

## Getting paid

### Recording money

**Payments → New.** Direction `IN` for money received, `OUT` for money paid. Allocate it
against an invoice or a purchase bill and the outstanding balance updates.

Part payment leaves the invoice `PARTIAL`, showing exactly what remains.

### Payment links

Create a link against an invoice and send it. Your customer sees only the invoice number,
the amount, and who is asking — no internal identifiers, and the link's address cannot be
guessed from another one.

When they pay, the receipt is created automatically. A duplicate notification from the
payment provider cannot create a second receipt.

Without payment-gateway credentials configured, links work in a **mock mode** suitable for
trying the flow out. Nothing real is charged.

### Chasing money

**Reports → Outstanding** lists what you are owed, with ageing.

The bell in the top bar raises an alert as an invoice passes 1, 7, 30 and 60 days overdue —
escalating rather than nagging daily. **Send reminder** on an invoice emails the customer,
or gives you a WhatsApp share link if email is not configured.

---

## Stock

### How stock quantity works

Every change writes one line in a stock register: opening balance, purchase, sale, challan,
GRN, transfer, adjustment, count. Nothing changes stock without leaving a line. That is why
your quantity and your stock value can never disagree.

### What your stock is worth

Choose one method in Settings and stay on it.

- **FIFO** — the oldest goods are treated as sold first.
- **Weighted average** — every purchase re-averages the cost of what you hold.

Both are acceptable; they simply split the same money differently between "stock I still
hold" and "cost of what I sold". Example from the demo data: FIFO shows ₹5,51,585 of stock
and ₹60,760 of cost of sales; weighted average shows ₹5,51,365.65 and ₹60,979.35. The
**total is identical** — only the split moves.

> **Changing the method restates history.** Because stock value is worked out from the
> register rather than stored, switching from FIFO to weighted average changes the closing
> stock and profit of periods you may have already reported. The application will ask you to
> confirm you understand that. Talk to your accountant first; a change of accounting policy
> has to be disclosed.

**Why the opening cost is a separate field.** If stock were valued at today's purchase
price, raising a supplier's price would change what last month's stock was worth, moving
profit between months with no transaction behind it. So the cost you paid is recorded and
kept.

### Stock adjustments

**Stock Adjustments** is for changes no invoice or bill explains: damage, theft, expiry,
free samples, internal use, production output, goods found or missing.

The reason decides the direction. You cannot file a "damage" that increases stock.

> **Adjustments do not change your profit.** This surprises people, so: purchases are charged
> to expenses when the goods arrive. Goods you now write off were **already** counted as a
> cost. Charging them again would double-count the loss. The effect reaches your profit
> through the closing stock figure.

### Counting the shelf

**Stock Count → Start a count.** The sheet freezes what the books say right now and
pre-fills the counted column with it. Enter what you actually counted, save as you go, then
**Post**.

- The book figure is frozen deliberately. If it were recalculated when you posted, a day of
  trading between counting and posting would be silently absorbed into your "difference".
- The counted column starts at the book figure so a half-finished sheet, posted by accident,
  changes nothing. A sheet defaulting to zero would write off your whole warehouse.
- Posting creates one stock adjustment for the differences. Before you post, the screen shows
  the total value of what you are about to write off.
- A posted count cannot be edited. It is your evidence.
- A count where everything agreed is still recorded, with no adjustment.

### Batches and expiry

Turn on **Track batches** for an item, then record a batch number with manufacture and
expiry dates. **Reports → Batch Expiry** shows what has expired and what expires within 30
and 90 days, with the value at risk.

Only batches you still hold are listed — a batch you have sold cannot expire on your shelf.
A batch expiring today is not treated as expired until tomorrow, the same way you would read
a date printed on a pack.

### Godowns

Multiple storage locations, with transfers between them. A transfer moves goods at the same
cost in both directions: moving stock between your own shelves must not create or destroy
value.

### Stock flags worth acting on

| Flag | Meaning |
|---|---|
| **Below cost** | You are holding stock that cost more than you can currently sell it for. Accounting standards require the lower of the two, so this needs a write-down decision — the software flags it and leaves the judgement to you. |
| **Negative stock** | You sold something before recording the purchase. The cost is an estimate until you enter the bill. |
| **Ledger drift** | Quantity disagrees with the stock register. This should never appear. If it does, report it. |
| **Dead stock** | Held with nothing sold for 90 days (configurable). Measured from when the **goods** arrived, not when you created the item. |

---

## Reports

| Report | Answers |
|---|---|
| **Day Book** | Everything that happened on a date |
| **Party Ledger** | A customer's or supplier's statement of account |
| **Outstanding** | Who owes you, how overdue |
| **Trial Balance** | Proves the books balance — debits equal credits |
| **Profit & Loss** | Income against expenses |
| **Balance Sheet** | What you own, owe and are worth |
| **Cash & Bank Book** | Every cash and bank movement with a running balance |
| **Cash Flow** | Where cash actually came from and went, split into operating, investing and financing |
| **GST Summary** | Output tax against input credit — what you owe this period |
| **GSTR-1** | B2B, B2C and HSN summaries, plus a JSON file for the portal |
| **Stock Valuation** | Closing stock at cost, and cost of goods sold |
| **Stock Ageing** | How long what you hold has been sitting |
| **Dead Stock** | Money tied up in goods that are not moving |
| **Batch Expiry** | What is expiring, and what it is worth |

Every report is worked out from your transactions when you open it. Nothing is cached, so a
report cannot disagree with the documents behind it.

**Trial Balance is your health check.** If debits do not equal credits, something is wrong
and everything else is suspect. It should always balance.

---

## Filing GST

1. **Reports → GST Summary** for the period. Output tax, input credit, net payable.
2. Check **ITC eligible** is right on your purchases. It decides what you can claim.
3. **Reports → GSTR-1**. Review B2B, B2C and HSN, then download the JSON.
4. Upload to the GST portal and reconcile there.
5. Once filed, **lock the period** (see below) so the numbers behind the return cannot move.

This software prepares your figures. It does not file for you, and it is not a substitute
for your accountant.

---

## Closing a period

### Locking

Once you have filed a return, lock everything up to that date. Backdated entries into a
locked period are refused. Without this, an innocent correction can silently make your books
disagree with a return you have already filed.

Unlocking is possible and is always recorded in the audit log.

### Closing a year

At year end, **close the financial year**. This posts one entry moving every income and
expense balance into retained earnings, so the new year starts clean and last year's profit
appears in your balance sheet.

You can reopen a closed year if you must. Reopening also removes the closing entry —
otherwise your income and expenses would stay at zero.

---

## Things that will refuse to happen, and why

| You try to | What happens | Why |
|---|---|---|
| Save an invoice with a bad GSTIN | Rejected | Cheaper to catch here than at the portal |
| Delete an issued invoice | Allowed, but cancel instead | GST needs a gap-free number series; cancelling keeps the number and the audit trail |
| Delete an invoice that has payments | Refused | Delete the payments first, or raise a credit note |
| Delete an item with stock history | Refused | Deleting it would destroy the history behind past stock valuations. Set stock to zero and stop using it |
| Post into a locked period | Refused | The numbers behind a filed return must not move |
| Post an unbalanced journal | Refused, with the exact difference | Debits must equal credits, always |
| Edit a posted stock count | Refused | A posted count is evidence |
| Post a stock count twice | Refused | It would write off the difference twice |
| Change stock valuation method | Asks you to confirm | It restates every past period |
| Erase all company data | Asks you to confirm | GST requires records for 8 years; you may be deleting something you are obliged to keep |
| Exceed your plan's limits | Refused, with an upgrade prompt | — |

---

## Getting help

- **Help & Support** in the app raises a ticket.
- **Reports → Day Book** and **Settings → Audit Log** answer most "who changed this?"
  questions yourself.
- If a number looks wrong, start at **Trial Balance**. If it balances, the problem is a
  classification; if it does not, stop and report it.

Related reading: [`GST_COMPLIANCE_NOTES.md`](GST_COMPLIANCE_NOTES.md) for the exact tax
rules implemented, and [`INVENTORY_VALUATION.md`](INVENTORY_VALUATION.md) for how stock
value is calculated.
