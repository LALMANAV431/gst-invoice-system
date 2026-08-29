# GST Compliance Notes

> **Disclaimer.** This document explains how the software computes GST. It is **not tax,
> legal or accounting advice**. GST rates, cess schedules, place-of-supply rules, exemption
> notifications and return formats change frequently. Verify your configuration with a
> practising Chartered Accountant before filing anything. You remain responsible for your
> returns.

All worked examples below are produced by `computeGstInvoice()` in `src/lib/gst.ts` and are
asserted in `src/lib/gst.test.ts`, so they stay accurate as the code changes.

---

## Order of operations

This ordering is the single most important thing on this page. Getting it wrong changes how
much tax you collect.

```
1. Line gross            = unit rate x quantity
2. Less line discount    -> reduces taxable value
3. Less apportioned share of the invoice-level discount
                         -> pro-rata across lines, ALSO before tax
4. = Taxable value
5. Tax                   = taxable x GST rate      (+ cess)
                           intra-state: split into CGST + SGST
                           inter-state: all IGST
6. Plus additional charges (freight, packing) and their own tax
7. = Net total
8. Round to nearest rupee -> round-off adjustment
9. = Grand total (the invoice's face value)
10. TDS reported SEPARATELY - it never reduces the grand total
```

Steps 2 and 3 must precede step 5. Under **CGST Act s.15(3)**, a discount recorded on the
face of the invoice reduces the taxable value. The previous implementation subtracted the
invoice discount *after* tax, overcharging GST on every discounted invoice.

---

## Intra-state supply: CGST + SGST

When the supplier's state and the place of supply are the same, GST splits equally between
the Centre (CGST) and the State (SGST).

```
Supplier: Karnataka (29)      Place of supply: Karnataka (29)
Item: 1 x Rs 1,000 @ 18%

Taxable value            1,000.00
CGST @ 9%                   90.00
SGST @ 9%                   90.00
                        ─────────
Grand total              1,180.00
```

### Odd-paise splits

Half of an odd number of paise is not a whole number, so the halves cannot be equal:

```
Item: 1 x Rs 105.05 @ 5%

Taxable value              105.05
Total GST                    5.25   (525 paise - cannot halve evenly)
CGST                         2.63
SGST                         2.62
                        ─────────
Net                        110.30
Round off                   -0.30
Grand total                110.00
```

`splitPaise()` assigns the remaining paise deterministically and is tested to reconcile
exactly. The requirement is not that the halves are equal — that is arithmetically
impossible — but that `CGST + SGST` always equals the total tax, for every possible amount.

---

## Inter-state supply: IGST

When the supplier's state differs from the place of supply, a single IGST charge applies.

```
Supplier: Karnataka (29)      Place of supply: Maharashtra (27)
Item: 1 x Rs 1,000 @ 18%

Taxable value            1,000.00
IGST @ 18%                 180.00
                        ─────────
Grand total              1,180.00
```

The total tax is identical; only the split and the reporting differ.

### Place of supply

The software compares the supplier's state code with the **place of supply**, not simply the
customer's billing address. For goods these usually coincide. For services they often do
not, and specific rules apply (immovable property, transport, events, telecom, etc.).

When either state code is missing the engine defaults to **intra-state**. This is a
deliberate choice: for a walk-in B2C sale with no recorded address, a same-state sale is the
overwhelmingly likely case, and wrongly charging IGST on a local sale is the more damaging
error.

---

## Discounts

### Line-level

```
Item: 10 x Rs 100 = Rs 1,000, less Rs 200 discount

Taxable value              800.00      (discount applied FIRST)
CGST @ 9%                   72.00
SGST @ 9%                   72.00
                        ─────────
Grand total                944.00
```

### Invoice-level, apportioned before tax

```
Line A: 1 x Rs 1,000 @ 5%
Line B: 1 x Rs 3,000 @ 18%
Invoice discount: Rs 400   (apportioned 1:3 by taxable value)

Line A: 1,000 - 100 =   900.00  @ 5%  ->  tax   45.00
Line B: 3,000 - 300 = 2,700.00  @ 18% ->  tax  486.00
                      ─────────         ─────────
Taxable               3,600.00          531.00
Grand total           4,131.00
```

Apportioning by taxable value ensures the discount reduces tax on the lines it actually
applies to. `apportionByWeight()` guarantees the shares sum to the discount exactly — no
paisa is created or lost.

The discount is capped at the total taxable value, so a data-entry error cannot produce a
negative invoice.

### Post-sale discounts

Discounts agreed **after** the invoice was issued only reduce GST liability if they satisfy
s.15(3)(b) — established by a pre-existing agreement, linked to the specific invoices, and
with the recipient reversing the corresponding ITC. In practice these are handled with a
**credit note**, not by editing the original invoice.

---

## GST-inclusive (MRP / POS) pricing

Retail counters price at MRP with tax already inside. The engine back-computes the taxable
value:

```
taxable = inclusive_price / (1 + (gst_rate + cess_rate) / 100)
```

```
Item: 1 x Rs 118 inclusive @ 18%

Taxable value              100.00
CGST @ 9%                    9.00
SGST @ 9%                    9.00
                        ─────────
Grand total                118.00      (matches the shelf price exactly)
```

Set `pricingMode: "INCLUSIVE"` on the line. The shelf price is preserved exactly, which
matters because the customer can see the printed MRP.

---

## Compensation cess

Cess applies on top of GST on specific goods — tobacco, pan masala, aerated drinks, coal,
motor vehicles. Two forms are supported, and some goods attract both.

**Percentage of taxable value:**

```
Item: 1 x Rs 1,000 @ 28% + 12% cess

Taxable value            1,000.00
CGST @ 14%                 140.00
SGST @ 14%                 140.00
Cess @ 12%                 120.00
                        ─────────
Grand total              1,400.00
```

**Flat amount per unit** (`cessPerUnit`), used for tobacco:

```
Item: 10 x Rs 50 @ 28% + Rs 5/unit cess
Cess = 10 x 5 = Rs 50.00
```

Cess is tracked in its own bucket. It is **not** creditable against GST liability — cess
ITC can only offset cess.

---

## Supply types

Rate alone cannot express the legal nature of a supply. Set `supplyType` explicitly.

| `supplyType` | Meaning | Tax | Supplier's ITC | GSTR-1 |
|---|---|---|---|---|
| `TAXABLE` | Standard supply | Per rate | Available | 4A/5A/etc. |
| `ZERO_RATED` | Export or SEZ | 0% | **Preserved** — refundable | 6A |
| `EXEMPT` | Exempt by notification | None | Blocked | 8 |
| `NIL_RATED` | Nil rate in the tariff | 0% | Blocked | 8 |
| `NON_GST` | Outside GST (e.g. alcohol) | N/A | N/A | 8 |

The distinction between `ZERO_RATED` and `EXEMPT` has real money attached: an exporter keeps
input tax credit and can claim a refund, while an exempt supplier cannot. Treating an export
as exempt forfeits that refund.

Exempt lines still contribute to the taxable value shown on the invoice but attract no tax:

```
Line A: Rs 1,000 @ 18%  TAXABLE  -> tax 180.00
Line B: Rs 1,000 @ 18%  EXEMPT   -> tax   0.00
Invoice value Rs 2,180.00
```

---

## Reverse charge

Under RCM the **recipient** pays the tax directly to the government. The supplier's invoice
shows the taxable value, notes that reverse charge applies, and collects no tax.

```
Item: 1 x Rs 1,000 @ 18%, reverseCharge: true

Taxable value            1,000.00
CGST/SGST/IGST               0.00      (payable by the recipient)
                        ─────────
Grand total              1,000.00
```

The invoice must carry the words "Tax payable on reverse charge basis". The recipient
records the liability and, where eligible, claims matching ITC.

---

## Round off

Invoices are conventionally rounded to the nearest rupee, with the adjustment disclosed.

```
Net total                  110.30
Round off                   -0.30
Grand total                110.00
```

Rounding is **half-up away from zero**, so a credit note reversing an invoice rounds by the
same magnitude in the opposite direction. `Math.round()` was unsuitable here because it
rounds `-2.5` to `-2`, which would leave a credit note out by a paisa against the invoice it
reverses.

The adjustment is returned separately so it can be posted to a Round Off ledger — required
for the books to balance. `netPaise + roundOffPaise === grandTotalPaise` always holds.

---

## TDS and TCS

TDS is **not** a GST concept — it comes from income tax law (s.194C, 194J, 194Q). The
customer withholds a percentage and deposits it against the supplier's PAN.

```
Item: 1 x Rs 10,000 @ 18%, TDS 10%

Taxable value           10,000.00
CGST + SGST              1,800.00
                        ─────────
Grand total             11,800.00      <- the invoice is for this amount
TDS withheld (10%)       1,000.00      <- deducted by the customer on payment
Expected receipt        10,800.00      <- what lands in the bank
```

The previous implementation subtracted TDS from the grand total, making the invoice appear
to be for ₹10,800. That understates the receivable, will not reconcile with the customer's
books, and will not match Form 26AS. TDS is computed on the taxable value (excluding GST)
and is reported alongside the invoice, never inside its face value.

---

## GSTIN validation

A GSTIN is 15 characters:

```
2 9 A A A C R 9 8 7 6 H 1 Z P
└─┬─┘ └────────┬───────┘ │ │ └── checksum (mod-36 over the first 14)
  │            │         │ └──── always 'Z'
  │            │         └────── entity number for that PAN in the state
  │            └──────────────── 10-character PAN
  └───────────────────────────── state code
```

`isValidGstin()` checks the structural pattern **and** the checksum. Regex alone accepts
transposed digits; the checksum catches them. Each of the first 14 characters is mapped to
its index in `0-9A-Z`, multiplied by an alternating weight of 1 and 2, reduced by
`floor(p/36) + p%36`, and summed; the 15th character must bring the total to a multiple
of 36.

The implementation was verified against two independently published valid GSTINs
(`27AAPFU0939F1ZV`, `24AAACC1206D1ZM`), reproducing both check characters.

This audit found **all three seeded GSTINs were checksum-invalid** — they passed a regex but
could never have been real. They have been corrected.

`isValidGstin()` confirms a GSTIN is *well-formed*. It does **not** confirm the GSTIN exists
or is active — that requires the official GST portal API. Do not scrape the portal; use a
sanctioned API through a registered GSP.

---

## Reports and returns

| Report | Status | Notes |
|---|---|---|
| GSTR-1 | Implemented (export) | B2B, B2C, HSN summary |
| Sales / purchase register | Implemented | |
| GSTR-3B | **Not built** | Needs the ITC ledger — Phase 2 |
| GSTR-2B reconciliation | **Not built** | Match purchases against downloaded 2B |
| GSTR-9 | **Not built** | Annual return |
| ITC ledger | **Not built** | Requires double-entry — Phase 2 |
| E-invoice (IRN) | Fields only | Schema fields exist; no IRP integration |
| E-way bill | Fields only | Schema fields exist; no API integration |

`ZERO_RATED` vs `EXEMPT` vs `NIL_RATED` now being distinct at line level is what will make
correct GSTR-1 table placement possible.

---

## Invoice numbering

GST requires a **consecutive series, unique per financial year**, not exceeding 16
characters, using only letters, digits, `/` and `-`.

Known defect: numbers are currently allocated by reading the latest and incrementing,
*outside* the enclosing transaction, so concurrent invoice creation collides. The unique
constraint prevents duplicates from being stored, so the failure surfaces as an error rather
than corrupt data — but gaps caused by failed attempts are themselves a compliance concern.
Scheduled for Phase 1.

---

## Mandatory invoice fields

A compliant tax invoice needs: supplier name, address and GSTIN; invoice number and date;
recipient name, address and GSTIN (or state and place of supply for unregistered
recipients); HSN or SAC per line; description, quantity and unit; taxable value; tax rate
and amount split by CGST/SGST/IGST/cess; place of supply; whether reverse charge applies;
signature or digital signature. B2C invoices above ₹50,000 to unregistered recipients also
require the recipient's name and address.

Thresholds and HSN-digit requirements vary by turnover. Confirm yours with your CA.
