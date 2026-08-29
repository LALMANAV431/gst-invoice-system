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

## What is already in place

| Control | Implementation |
|---|---|
| Password storage | bcrypt with a cost factor of 10 |
| Session transport | JWT in an `httpOnly`, `SameSite=Lax`, path-scoped cookie |
| Production secret enforcement | `src/lib/auth.ts` throws at boot if `JWT_SECRET` is unset or left at the dev default |
| Tenant isolation | Every tenant query is scoped by `companyId` resolved from the session, never from client input |
| Role enforcement | `writeGuard()` blocks `VIEWER` roles and suspended companies on mutations |
| Suspension | Suspended companies are rejected at the API layer, not merely hidden in the UI |
| Audit trail | `AuditLog` records actor, action, entity and changes for sensitive operations |
| SQL injection | All access goes through Prisma's parameterised query builder |
| Secrets in git | None committed. Only clearly-labelled dev/CI placeholders |
| Container hardening | Docker image runs as non-root `nextjs` (UID 1001) |
| Health endpoint | Returns no version strings, connection details or environment values |

---

## Known issues

These are open. They are listed here deliberately rather than left for a customer to
discover. Severity reflects impact on a real multi-tenant deployment.

### Critical — fix before any production deployment

**1. Dependency vulnerabilities (2 critical, 8 high)**
`npm audit` reports 12 advisories. The critical ones are in Next.js 14.2.18: denial of
service via Server Actions, SSRF through middleware redirect handling, cache poisoning,
and content injection in the image optimiser. `jspdf` pulls a vulnerable `dompurify` with
multiple XSS bypasses.
*Fix:* upgrade Next.js within the 14.2.x line, then `npm audit fix`. Upgrading `jspdf` to
4.x is a breaking change and needs the PDF templates retested.

**2. The demo account is a platform super-admin**
`prisma/seed.ts` creates `demo@gst.com / demo1234` with `isSuperAdmin: true`. Anyone who
seeds a public deployment hands over full platform control, including tenant
impersonation, with published credentials.
*Fix:* seed the demo user as a tenant admin only. Create super-admins through a separate,
explicitly-invoked script that requires a strong password.

### High

**3. No rate limiting on any endpoint**
`/api/auth/login`, `/api/auth/register` and password reset accept unlimited attempts,
allowing credential stuffing and brute force. There is no `middleware.ts`.
*Fix:* add a rate limiter keyed on IP plus email. `RATE_LIMIT_LOGIN_PER_MINUTE` and
`RATE_LIMIT_API_PER_MINUTE` are already defined in `.env.example`. Use Redis when running
more than one instance — an in-process counter does not work across containers.

**4. Request bodies are largely unvalidated**
Only 2 of 49 API routes use Zod (`auth/login`, `auth/register`). The rest destructure
`await req.json()` and pass values to Prisma after loose `parseFloat` coercion. Malformed
or hostile payloads can create records with `NaN` amounts or unexpected types.
*Fix:* a Zod schema per route, validated before any database call.

**5. No CSRF protection on state-changing routes**
Sessions ride on a cookie and `SameSite=Lax` blocks cross-site *form* POSTs, but it does
not protect against every cross-origin vector, and there is no origin check or CSRF token.
*Fix:* verify `Origin`/`Referer` against the configured app URL in middleware for all
non-GET requests.

**6. Financial amounts stored as floating point**
93 `Float` columns hold money. This is a correctness and integrity issue as much as a
security one: totals do not reconcile exactly, so tampering is harder to detect and audit.
*Fix:* migrate to integer paise using `src/lib/money.ts`. See `docs/ROADMAP.md`.

### Medium

**7. Sessions cannot be revoked**
JWTs are valid for 30 days and are validated by signature alone. There is no server-side
session store, so logout only clears the cookie — a captured token keeps working, and
deleting a user does not invalidate their token.
*Fix:* persist a session/token version per user and check it on each request, or shorten
expiry and add refresh-token rotation.

**8. Invoice numbering has a race condition**
`nextInvoiceNumber()` reads the latest number and increments it *outside* the enclosing
transaction. Concurrent creation produces duplicates. `@@unique([companyId, number])`
prevents corruption but surfaces as an unhandled 500.
*Fix:* allocate numbers from a per-company counter row inside the same transaction.
Gap-free sequential numbering is a GST requirement, so this also matters for compliance.

**9. Uploads are not validated**
No MIME type allow-list, size cap or filename sanitisation is enforced on attachments.
*Fix:* validate type and size server-side, store under generated names, never serve from a
path derived from user input.

**10. Impersonation is under-constrained**
`/api/admin/impersonate` lets a super-admin assume any user. It is audit-logged, but has no
time limit, no reason field and no notification to the tenant.
*Fix:* require a reason, expire the impersonated session, and surface it in the tenant's
own audit log.

**11. Cookie is not `Secure`**
The session cookie omits the `Secure` flag, so it can be sent over plain HTTP.
*Fix:* set `secure: true` whenever `NODE_ENV === "production"`.

**12. No security headers**
No CSP, `X-Frame-Options`, `X-Content-Type-Options` or HSTS.
*Fix:* add them via `headers()` in `next.config.js` or middleware.

---

## Handling sensitive data

This application stores GSTINs, PANs, bank account details, addresses and phone numbers —
personal and financial data under India's Digital Personal Data Protection Act, 2023.

**Rules for contributors:**

- Never commit real GSTINs, PANs, Aadhaar numbers, bank details or API keys. Seed data must
  use synthetic values. (The seed GSTINs were corrected to be checksum-valid *fictional*
  numbers.)
- Never log full request bodies on invoice, party, payment or auth routes.
- Never send tenant data to a third-party AI provider unless the tenant has opted in.
  `AI_REDACT_PII=true` in `.env.example` is the default for this reason, and
  `AI_PROVIDER=mock` means no data leaves the machine at all.
- Keep secrets in environment variables only. Never in code, never in the repository.

**If a secret is ever committed:** rotate it immediately — assume it is compromised the
moment it reaches GitHub. Removing the file in a later commit does **not** help, because
the value stays in git history and in any fork or clone. Rotate first, then purge history
with `git filter-repo` if needed.

---

## Production checklist

- [ ] `JWT_SECRET` is a fresh 32+ byte random value, unique to this environment
- [ ] `npm audit` shows no critical or high advisories
- [ ] Demo/seed accounts removed or given strong unique passwords
- [ ] No account has `isSuperAdmin` unless it is genuinely a platform operator
- [ ] TLS terminated in front of the app; `Secure` cookies enabled
- [ ] Rate limiting active on auth endpoints
- [ ] Security headers set
- [ ] Database backups running, with a **restore actually tested**
- [ ] Error tracking configured, with PII scrubbing on
- [ ] Payment gateway webhooks verify their signature and are idempotent
- [ ] Card details never stored — tokenise via the gateway, never persist a CVV
