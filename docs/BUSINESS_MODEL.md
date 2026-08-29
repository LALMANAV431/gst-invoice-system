# Business Model

> Commercial planning, not financial advice. Figures are illustrative starting points to be
> tested against real customers. Validate tax treatment and pricing with your CA.

## The opportunity

India has roughly 14 million GST-registered businesses. Most either use nothing (paper,
Excel, WhatsApp photos of bills) or Tally, which is capable but expensive, desktop-first,
and hard for a non-accountant to learn.

**The gap:** a shopkeeper who needs GST invoices, stock tracking and a profit figure, on a
phone, in Hindi, for less than a few hundred rupees a month.

### Positioning

| Product | Price | Weakness this product exploits |
|---|---|---|
| Tally Prime | ~₹18,000 one-time + AMC | Desktop-bound, steep learning curve, no mobile |
| Busy | ~₹10,000+ | Same, Windows-centric |
| Marg | ~₹8,000+ | Dated UX |
| Zoho Books | ~₹749–2,999/mo | Good, but priced and designed for larger SMBs |
| Vyapar | ~₹300–500/mo | Closest competitor; weaker on accounting depth |
| QuickBooks | — | Withdrew from India |

**Position:** Vyapar's simplicity and price with Tally's accounting depth, mobile-first and
bilingual.

**Do not** replicate any competitor's code, UI, or proprietary report layouts. Compete on
price, usability and language coverage.

---

## Pricing

Anchored on what a small shopkeeper will actually pay without hesitating. The current
implementation (`src/lib/plan.ts`) has Free / ₹299 / ₹999; this extends it.

| Plan | Monthly | Annual (2 months free) | Users | Invoices/mo | Highlights |
|---|---|---|---|---|---|
| **Free** | ₹0 | — | 1 | 20 | GST invoices, PDF, basic reports. Permanent, not a trial |
| **Starter** | ₹149 | ₹1,490 | 2 | 200 | Inventory, WhatsApp share, payment tracking |
| **Business** | ₹299 | ₹2,990 | 5 | Unlimited | POS, barcode, multi-godown, full accounting reports |
| **Pro** | ₹599 | ₹5,990 | 10 | Unlimited | Multi-branch, AI, customer portal, payment gateway, API |
| **CA / Accountant** | ₹999 | ₹9,990 | 5 staff | Unlimited | Up to 25 client companies, consolidated dashboard, bulk filing exports |
| **Enterprise / White-label** | From ₹2,999 | Custom | Custom | Unlimited | Own branding, custom domain, SLA, dedicated support |

### Why these numbers

- **Free is permanent, not a 14-day trial.** Acquisition cost in this market is high and
  trust is low. A shopkeeper who has kept two years of invoices in the free plan will not
  move to a competitor, and converts when they hire a second person or cross the invoice cap.
- **₹149 is the "yes without thinking" price** — under a day's margin for most shops.
- **₹299 is the volume tier** and matches the price already implemented.
- **Annual = 10 months for 12.** Improves cash flow and cuts churn substantially.
- **The CA plan is the highest-leverage tier.** One accountant brings 20–50 businesses.
  Priced per-firm, not per-client, so it is obviously good value to them.

### Limits that should gate upgrades

Gate on things that grow with a real business: users, monthly invoices, branches, godowns,
AI credits, API access, white-labelling. **Never gate data export or invoice history** —
holding a customer's own books hostage destroys trust and invites chargebacks.

---

## Revenue streams

**1. Subscriptions** — the core. Predictable and the basis of valuation.

**2. Add-ons** — margin without new customers:

| Add-on | Price | Notes |
|---|---|---|
| Extra user | ₹49/user/mo | |
| Extra branch | ₹99/branch/mo | |
| AI credit pack | ₹99 / 500 operations | Must price above token cost — meter via `AiUsageLog` |
| WhatsApp pack | ₹199 / 1,000 messages | Resold above the Meta per-message rate |
| API access | ₹299/mo | |
| White-label + custom domain | ₹1,999/mo | |
| Priority support | ₹499/mo | |

**3. Services** — high margin, and they make customers permanent:

- Data migration from Tally/Busy/Excel: ₹2,000–10,000 one-time. The single biggest barrier
  to switching; charging to remove it is good for both sides.
- Onboarding and training: ₹1,000–5,000.
- Custom reports or integrations: ₹5,000+.

**4. Partner channel:**

- **CA/accountant partners** — 20–30% recurring commission. Accountants choose the software
  their clients use; this is the cheapest distribution available.
- **Resellers / white-label** — licence fee plus per-tenant margin.
- **Referrals** — one month free for both parties.

---

## Unit economics

Illustrative, for the recommended ₹800/month VPS:

| | Free | Starter ₹149 | Business ₹299 | Pro ₹599 |
|---|---|---|---|---|
| Infra cost/tenant | ₹2 | ₹4 | ₹8 | ₹15 |
| AI cost/tenant | ₹0 | ₹0 | ₹0 | ₹25–60 |
| Payment gateway (~2%) | ₹0 | ₹3 | ₹6 | ₹12 |
| Support (amortised) | ₹0 | ₹10 | ₹20 | ₹40 |
| **Gross margin** | **−₹2** | **~₹132 (89%)** | **~₹265 (89%)** | **~₹470 (78%)** |

Software margins are high; the risks are elsewhere:

- **AI is the only cost that can outrun revenue.** An unmetered assistant on a ₹299 plan can
  cost more than the subscription. Hence: `mock` by default, hard per-tenant budgets checked
  *before* the call, response caching, small models, and AI confined to Pro and above.
- **Free-tier abuse.** Cap invoices, users and storage. Free users cost ~₹2/month, which is
  affordable marketing.
- **Support is the real cost driver** at this price point. Every support ticket eliminated by
  better UX or documentation is worth more than a price rise. Hindi in-app help and short
  videos pay for themselves.

### Break-even

At ₹800/month infrastructure, roughly **6 Business subscribers** cover hosting. Realistic
first-year target: 200–500 paying tenants, ₹60,000–1,50,000 MRR, with the CA channel doing
most of the work.

---

## Growth

**Phase 1 — first 100 customers (manual).** Visit shops. Offer to set up their first ten
invoices personally. Onboard over WhatsApp. Do this yourself; it is the only way to learn
which features actually matter. Target one dense segment first — kirana or mobile shops in
one city — so word of mouth compounds.

**Phase 2 — the CA channel (leverage).** Recruit 10–20 accountants with a free CA plan and
recurring commission. Give them a genuinely useful multi-client dashboard and bulk export.
One CA can deliver more tenants than a month of cold outreach.

**Phase 3 — content and SEO (compounding).** Rank for "GST invoice format", "GST return
kaise bhare", "Tally alternative". Hindi content is under-served. Free tools — a GST
calculator, an invoice-format generator, a GSTIN checksum validator — attract exactly the
right traffic and cost nothing to run.

**Phase 4 — product-led.** "Made with GST Invoice System" on free-plan PDFs. Customer portal
exposure — every invoice recipient sees the product. Referral rewards.

**Retention beats acquisition.** Annual plans, data import that actually works, responsive
Hindi support, and never holding data hostage. A shopkeeper with two years of history in the
system does not switch.

---

## Legal and compliance

Publish before taking payment:

- [ ] Terms of Service
- [ ] Privacy Policy — DPDP Act 2023: purpose, retention, user rights, grievance officer
- [ ] Refund and Cancellation Policy — required by payment gateways
- [ ] Cookie Policy
- [ ] GST disclaimer — the software assists; the user's CA is responsible for filings

Operating requirements:

- **GST on subscriptions.** SaaS is taxable at 18%. Charge it, issue compliant tax invoices
  for your own subscriptions (the product can do this), and file. Registration is mandatory
  above the threshold and immediately for inter-state supply.
- **Payment gateway.** Razorpay or PayU; both need business KYC. Never store card details or
  a CVV — tokenise via the gateway. Verify webhook signatures and make handlers idempotent.
- **DPDP Act 2023.** Provide data export and deletion, obtain consent for optional
  processing (including AI), report breaches. Data export is already partly implemented.
- **No GST portal scraping.** Use official APIs via a registered GSP only. Scraping breaches
  the portal's terms and cannot be a dependency of a commercial product.
- **Licensing.** No `LICENSE` file exists, so the code is "all rights reserved" by default —
  which suits a commercial SaaS. All dependencies are MIT/ISC/Apache-2.0, so a proprietary
  licence is compatible. Decide deliberately; see the README.

---

## Metrics to track from day one

| Metric | Why |
|---|---|
| MRR / ARR | The headline number |
| Free → paid conversion | Tests whether the free tier is calibrated |
| Churn (logo and revenue) | Above 5%/month means the product is not sticky |
| Activation: % who create a real invoice within 24h | The best predictor of retention |
| Invoices created per tenant per month | Real usage, not logins |
| CAC by channel | Direct vs CA vs SEO — invest where it is cheapest |
| AI cost per tenant | The only cost that can go non-linear |
| Support tickets per 100 tenants | Directly determines whether the price works |

`AuditLog` and `AiUsageLog` already provide most of the raw data; the super-admin dashboard
is the natural home for these.
