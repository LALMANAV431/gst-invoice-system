# Admin Guide

Two different jobs share this name, so they are separated below:

- **[Part 1 — Company administration](#part-1--company-administration)** — you run a
  business on the application and manage your own team, periods and policies.
- **[Part 2 — Platform operation](#part-2--platform-operation)** — you run the SaaS and
  manage tenants, plans and pricing.

If you are the person who deployed this, read both. Also read
[`SECURITY.md`](../SECURITY.md), which lists what is hardened and what is still open.

---

# Part 1 — Company administration

## Roles

Four roles are assignable in Settings → Team. This table is what the code actually enforces,
not an aspiration:

| Role | Documents & reports | Lock/close periods | Data export & erasure | Register webhooks |
|---|---|---|---|---|
| **ADMIN** | Yes | Yes | Yes | Yes |
| **ACCOUNTANT** | Yes | No | No | No |
| **OPERATOR** | Yes | No | No | No |
| **VIEWER** | Read only | No | No | No |

The company **owner** is not a role. It is the user recorded in `Company.ownerId`, created
when the company was registered. They hold whichever role they were given, so give the owner
`ADMIN`.

> **`OPERATOR` and `ACCOUNTANT` are currently identical.** Both can create every document and
> neither can perform the four admin actions. If you pick `OPERATOR` expecting a narrower
> permission than `ACCOUNTANT`, you will not get one. Use `VIEWER` when you need a genuine
> restriction. Splitting these properly is open work — see
> [`ROADMAP.md`](ROADMAP.md).

`VIEWER` is enforced server-side by a write guard on every mutating endpoint, not by hiding
buttons. Two exceptions are deliberate: a viewer can still change their own **language** and
clear their own **notifications**. Neither changes business data, and blocking them would make
the app unusable in Hindi for read-only staff.

**Adding people:** Settings → Team. The user limit is part of your plan (Free 1, Basic 3,
Premium 25).

**Removing people:** removing a member revokes their access immediately. Their past
documents stay — they are your records, and the audit log still names who created what.

## Periods and locking

**Settings → Financial Years.**

| Action | Effect |
|---|---|
| **Lock till** *(date)* | Refuses new or backdated entries on or before that date |
| **Unlock** | Removes the lock. Always audit-logged |
| **Close** | Posts a closing entry moving income and expenses to retained earnings, then locks the year |
| **Reopen** | Unlocks and **deletes the closing entry** |

Lock a period as soon as you have filed its return. This is the single most useful control
here: it stops a well-meaning correction from making your books disagree with a return
already with the government.

Reopening deletes the closing entry on purpose. Leaving it behind would keep income and
expenses zeroed while you post into the year, and your profit and loss would read as empty.

## Policies worth setting deliberately

### Stock valuation method

FIFO or weighted average, in Settings. Both are acceptable under AS 2, which also requires
the choice to be applied **consistently** — which is why it is a company setting and not a
per-item one.

Changing it is refused unless you confirm you understand the consequence, because stock value
is derived from the movement register rather than stored: switching method restates closing
stock and cost of goods sold for **every past period**, including any you have reported. The
change is recorded in the audit log. A change of accounting policy has to be disclosed in
your accounts, so involve your accountant.

### GST scheme

`REGULAR` or `COMPOSITION`. This is not cosmetic:

- A composition dealer issues a **bill of supply** and cannot charge GST.
- A composition dealer cannot claim input credit, so **purchase tax becomes part of stock
  cost**. Set this wrong and both your closing stock and your gross profit are out by the
  whole tax amount.

### Dead stock threshold

Days with no issue before stock is reported as dead. Default 90.

### Document prefixes

Per document type. Changing a prefix does not renumber existing documents; the sequence
continues. Numbers are allocated per financial year and restart at 1 each April.

## Audit log

**Settings → Audit Log** records who did what, when. Create, update, delete and cancel
across documents, plus security events: two-factor enrolment and removal, period unlocking,
valuation policy changes, data export and erasure.

It is append-only from the application. There is no UI to edit or delete an entry.

## Security controls

### Two-factor authentication

Per user, under their own account. Enrolment is two steps: the app issues a secret and QR
code, then you confirm with a live code from your authenticator. **It is not enabled until
you confirm.** A mis-scanned QR code must not be able to lock somebody out of their own
books permanently.

On confirmation you get **eight recovery codes, shown once**. Store them somewhere other
than the phone with the authenticator on it. Each works once and is destroyed on use.

Disabling requires the current password and signs out every session — a hijacked session
must not be able to remove the factor that would have stopped it.

### Sessions

Sessions are revocable server-side. Logging out revokes; so does disabling two-factor. If
you suspect a compromise, change the password — it invalidates existing sessions.

### Data rights (DPDP)

**Export** — Settings → Data. Admin only, three per hour. A complete JSON export of the
company's data. It excludes password hashes, two-factor secrets and recovery code hashes,
and states that its money values are in paise.

**Erasure** — the same screen. Requires your password *and* the exact company name typed
out. If records fall inside the **8-year GST retention window** you get a warning listing
what and how many, and must explicitly acknowledge it.

> This is a genuine conflict, not a technicality. DPDP gives a right to erasure; GST law
> requires records for eight years. The software will not silently pick a side. It tells you
> what you are about to destroy and makes you say you understand.

Erasure is irreversible. Export first.

---

# Part 2 — Platform operation

The super-admin panel is at `/admin`. It is a different privilege level from any company
role: a company OWNER has no access to it.

## Creating the first super-admin

There is deliberately no seeded super-admin account.

```bash
npm run db:seed:admin -- --email you@example.com --password '<a-long-random-password>'
```

`npm run db:seed` creates only the demo **tenant**. An earlier version of the seed created
the published demo login with platform-wide powers; that was a critical hole and the two are
now separate commands.

Give this account two-factor authentication before you do anything else with it.

## Tenants

**Admin → Companies.** Every tenant, its plan, invoice count and status.

| Action | Effect |
|---|---|
| **Suspend** | Blocks all writes with a 403. Reads still work, so the tenant can see why and can export their data |
| **Restore** | Lifts the suspension |
| **Change plan** | Applies immediately |
| **Set plan expiry** | On expiry the tenant silently falls back to Free entitlements |

Suspension is intentionally not a lockout. A tenant in a billing dispute must still be able
to reach their own records — locking them out of their statutory books over an unpaid
invoice is not a position you want to be in.

## Plans and pricing

**Admin → Pricing** overrides the built-in defaults, stored in the database.

Enter prices in **rupees**; they are stored as integer paise.

> Fixed bug worth knowing about: the plan price field used to be declared as rupees in code
> but populated with paise from the database, and every screen formatted it as paise. It was
> right once a pricing override existed and wrong on a fresh install, which advertised the
> Basic plan at **₹2.99** instead of ₹299. The field is now named for its unit and pinned by
> tests. If you have an existing deployment, check Admin → Pricing shows the numbers you
> expect.

Default entitlements:

| | Free | Basic | Premium |
|---|---|---|---|
| Price / month | ₹0 | ₹299 | ₹999 |
| Invoices / month | 20 | Unlimited | Unlimited |
| Users | 1 | 3 | 25 |
| GST reports, WhatsApp share | Yes | Yes | Yes |
| Godowns, budgets, TDS/TCS | — | Yes | Yes |
| Multi-user, bank reconciliation, recurring invoices, audit trail, e-invoice, e-way bill | — | — | Yes |

Entitlements are enforced server-side. A test asserts each tier is a superset of the one
below it, so a more expensive plan can never accidentally offer less.

## Coupons

**Admin → Coupons.** Percentage or flat discount, optionally restricted to one plan, with an
active flag. Validated server-side at checkout.

## Feature flags

**Admin → Flags** hides feature areas across all tenants (`flag_pos`, `flag_orders`,
`flag_ai`, `flag_journal`, `flag_godowns`, `flag_budgets`, `flag_bank`, `flag_expenses`,
`flag_quotations`, `flag_credit_notes`).

These control **navigation visibility**. They are for staging a rollout, not for security —
entitlement checks are separate and server-side.

## Support and broadcasts

**Admin → Tickets** for tenant tickets. **Admin → Broadcast** to send an announcement to
tenants.

## Impersonation

There is an impersonation facility for support. It is powerful and is deliberately left out
of the published API description so it is not advertised as a general capability.

Treat it as a break-glass tool: use it only with the tenant's knowledge, and prefer asking
them for a screenshot or an export first.

## Configuration

Everything optional is off unless configured. The application runs fully with only
`DATABASE_URL` and `JWT_SECRET`. See [`.env.example`](../.env.example) for the full list and
[`DEPLOYMENT.md`](DEPLOYMENT.md) for deployment.

| Area | Unset behaviour |
|---|---|
| **AI** (`AI_ENABLED`, `AI_PROVIDER`) | Off. Endpoints return "unavailable" rather than failing, and the UI explains instead of showing a broken input |
| **Payments** (`RAZORPAY_*`) | Mock gateway. Signature verification still applies, so the security-critical path is exercised |
| **Email** (`SMTP_*`) | Mock. Nothing is sent; the app falls back to WhatsApp share links |
| **E-invoice** (`EINVOICE_*`) | Off. Those endpoints return "not configured" |
| **Redis** (`REDIS_URL`) | In-process rate limiting. Correct for one instance, **not** across several |
| **Storage** (`S3_*`) | Local filesystem. Attachments will not survive a container restart |

### Things that matter in production

- **`JWT_SECRET`** must be long and random (`openssl rand -base64 48`). The app refuses to
  boot in production without it. Changing it signs everybody out.
- **Rate limiting is in-process by default.** Running several containers without `REDIS_URL`
  means each has its own counters and the effective limit is multiplied by your instance
  count.
- **SQLite is the default.** Fine for a single instance and for the portable USB edition. For
  a multi-instance deployment use PostgreSQL — see [`DEPLOYMENT.md`](DEPLOYMENT.md).
- **Local file storage does not survive a redeploy.** Configure S3-compatible storage.

## Monitoring

`GET /api/health` reports application and database status — point your load balancer at it.

Three things worth alerting on:

1. **Trial balance not balancing** for any tenant. The application raises a `CRITICAL`
   in-app notification for this; it means something is wrong at the accounting layer.
2. **Ledger drift** on the stock valuation report. It should always be zero. Non-zero means
   some code path changed stock without recording a movement.
3. **Webhook endpoints auto-disabling.** An outbound webhook switches itself off after 20
   consecutive failures.

## Backups

Back up the database. Everything else can be rebuilt.

- **SQLite** — copy the file, or `sqlite3 dev.db ".backup out.db"` for a consistent snapshot
  while running.
- **PostgreSQL** — `pg_dump`, off-host, and *test a restore*. An untested backup is a hope.

Your tenants' GST records must be retainable for eight years. Their retention obligation
becomes your retention obligation.

## Upgrades

```bash
git pull
npm ci
npx prisma migrate deploy   # or: npx prisma db push
npm run build
```

Read [`CHANGELOG.md`](../CHANGELOG.md) first — it flags migrations and behaviour changes.
Take a backup before any release that migrates the schema.
