# Security

## Reporting a vulnerability

Do **not** open a public GitHub issue for security problems. Report privately to the
repository owner via GitHub's [private vulnerability reporting](https://docs.github.com/en/code-security/security-advisories/guidance-on-reporting-and-writing-information-about-vulnerabilities/privately-reporting-a-security-vulnerability)
(Security tab → Report a vulnerability).

Please include reproduction steps, affected version or commit, and impact. Expect an
acknowledgement within 5 working days.

Because this application stores financial records, GSTINs and PANs for multiple tenants,
treat any cross-tenant data access as critical severity.

---

## What is in place

| Control | Implementation |
|---|---|
| Password storage | bcrypt, cost factor 10 |
| Session transport | JWT in an `httpOnly`, `SameSite=Lax`, `Secure` (production) cookie |
| **Session revocation** | `User.tokenVersion` is checked on every request; bumping it invalidates all existing tokens |
| Production secret enforcement | `src/lib/auth.ts` throws at boot if `JWT_SECRET` is unset or left at the dev default |
| Tenant isolation | Every tenant query is scoped by `companyId` from the session, never from client input |
| Role enforcement | `writeGuard()` blocks `VIEWER` roles and suspended companies on all mutations |
| **Rate limiting** | Login limited per IP+email *and* per IP; all other API routes limited per IP |
| **CSRF** | Origin/Referer verified against `Host` on every non-GET API request |
| **Security headers** | CSP, `X-Frame-Options: DENY`, `X-Content-Type-Options`, `Referrer-Policy`, `Permissions-Policy`, HSTS in production |
| **Input validation** | Zod schemas on every write route |
| **Period locking** | `FinancialYear.lockedTill` / `isClosed` reject edits to filed periods |
| **Ledger integrity** | `assertBalanced()` refuses to store a journal entry where debits ≠ credits |
| Audit trail | `AuditLog` records actor, action, entity and changes |
| SQL injection | All access via Prisma's parameterised queries |
| Secrets in git | None. Only clearly-labelled dev/CI placeholders |
| Container hardening | Docker image runs as non-root `nextjs` (UID 1001) |
| Health endpoint | Exposes no version strings, connection details or environment values |
| Demo account | Tenant admin only — **not** a platform super-admin |

---

## Known issues

Open items, listed here rather than left for a customer to discover.

### High

**1. Five open `high` dependency advisories, all requiring Next.js 16**

`npm audit` reports 5 high-severity advisories: `next`, `postcss`, `eslint-config-next`,
`@next/eslint-plugin-next`, `glob`. All are fixed only by upgrading to Next.js 16.3.x.

Down from **16 advisories including 2 critical**. Cleared so far: Next.js 14.2.18 → 14.2.35
(DoS, SSRF, cache poisoning, content injection), `jspdf` 2.x → 4.x (12 advisories including
PDF injection and path traversal), `vitest` 2.x → 4.x (critical), plus `nanoid`, `js-yaml`
and `brace-expansion`.

*Why not upgraded here:* Next.js 14 → 16 makes the request APIs asynchronous — `cookies()`,
`headers()` and route `params` all become Promises. That touches every one of the 50+ route
handlers and pages. Bundling it with the accounting work would make both unreviewable and
risk silent regressions in tax calculation. It is the first item in
[`docs/ROADMAP.md`](docs/ROADMAP.md).

*Exposure in the meantime:* the critical advisories are cleared. The remaining `next` items
are denial-of-service and cache-poisoning classes, mitigated in part by running behind a
reverse proxy with its own rate limiting.

**2. Rate limiting is in-process, not distributed**

`src/lib/rate-limit.ts` uses an in-memory fixed-window counter. Correct for a single
instance; with N containers the effective limit is N× the configured value, because each
keeps its own counters.

*Fix:* set `REDIS_URL` and swap the store before scaling horizontally.
`isDistributed()` returns `false` so this cannot be forgotten silently.

### Medium

**3. Uploads are not validated**
No MIME allow-list, size cap or filename sanitisation on attachments.
*Fix:* validate type and size server-side, store under generated names, never serve from a
path derived from user input.

**4. Impersonation is under-constrained**
`/api/admin/impersonate` lets a super-admin assume any user. It is audit-logged, but has no
time limit, no reason field, and no notification to the affected tenant.
*Fix:* require a reason, expire the impersonated session, surface it in the tenant's own
audit log.

**5. CSP allows `unsafe-inline` for scripts**
Required by the inline bootstrap scripts Next.js injects. This weakens the XSS protection
CSP would otherwise give.
*Fix:* move to a nonce-based policy. It changes every page's script handling, so it belongs
in its own change.

**6. No 2FA**
Password-only authentication for accounts that hold financial records.
*Fix:* TOTP, at minimum for tenant admins and super-admins.

**7. Document edit paths do not all reverse their ledger entry**
Create and delete are handled: creating posts an entry, deleting removes it. Some edit
paths update the document without reposting, which can leave the ledger disagreeing with the
document.
*Fix:* implement edit as reverse-and-repost inside one transaction for every document type.
`deletePostingsFor()` already exists for this.

---

## Handling sensitive data

This application stores GSTINs, PANs, bank details, addresses and phone numbers — personal
and financial data under India's Digital Personal Data Protection Act, 2023.

**Rules for contributors:**

- Never commit real GSTINs, PANs, Aadhaar numbers, bank details or API keys. Seed data must
  use synthetic values. (The seed GSTINs are checksum-valid but fictional.)
- Never log full request bodies on invoice, party, payment or auth routes.
- Never send tenant data to a third-party AI provider unless the tenant has opted in.
  `AI_REDACT_PII=true` and `AI_PROVIDER=mock` are the defaults for this reason.
- Keep secrets in environment variables only.

**If a secret is ever committed:** rotate it immediately — assume it is compromised the
moment it reaches GitHub. Removing the file in a later commit does **not** help; the value
stays in git history and in every clone and fork. Rotate first, then purge history with
`git filter-repo` if needed.

---

## Production checklist

**Blocking**

- [ ] Upgrade to Next.js 16 and clear the 5 remaining `high` advisories
- [ ] `JWT_SECRET` is a fresh 32+ byte random value, unique to this environment
- [ ] Demo/seed accounts removed or given strong unique passwords
- [ ] No account has `isSuperAdmin` unless it is genuinely a platform operator
- [ ] TLS terminated in front of the app
- [ ] Redis-backed rate limiting if running more than one instance
- [ ] Database backups running, with a **restore actually tested**

**Standard**

- [ ] PostgreSQL with versioned migrations (not `db push`)
- [ ] Error tracking configured, with PII scrubbing on
- [ ] Upload validation implemented
- [ ] Payment gateway webhooks verify their signature and are idempotent
- [ ] Card details never stored — tokenise via the gateway, never persist a CVV
- [ ] `/reports/trial-balance` shows "Books balance" against production data

**Verify after deploying**

```bash
curl -sf https://app.example.com/api/health          # expect 200 "ok"
curl -sI https://app.example.com/login | grep -i content-security-policy
```

Then in the UI: log in, create an invoice with a bill-level discount, confirm GST is charged
on the discounted value, record a payment, and check that the trial balance still reports
"Books balance".
