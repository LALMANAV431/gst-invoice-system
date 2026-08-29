# Deployment

## Local development

```bash
npm install
cp .env.example .env          # set JWT_SECRET
npm run db:setup              # schema + demo data
npm run dev                   # http://localhost:3000
```

Login: `demo@gst.com` / `demo1234`.

## Docker

```bash
cp .env.example .env          # set JWT_SECRET
docker compose up --build
docker compose --profile setup run --rm migrate   # first run only
```

- App: <http://localhost:3000>
- Health: <http://localhost:3000/api/health>

### How the image is built

Three stages, relying on `output: "standalone"` in `next.config.js`:

1. **deps** — `npm ci`. `prisma/` is copied *before* install because the `postinstall`
   hook runs `prisma generate` and fails without the schema.
2. **builder** — `npm run build`. Uses placeholder `DATABASE_URL` and `JWT_SECRET`; no
   database is contacted at build time. `JWT_SECRET` must be set because `src/lib/auth.ts`
   deliberately throws when it is missing in production, and that guard would otherwise
   break the build.
3. **runner** — copies only the standalone server, static assets and the Prisma client.
   Runs as non-root (`nextjs`, UID 1001).

Two things worth knowing, both found by testing the image:

- **`output: "standalone"` does not emit `node_modules/.bin`.** `npx prisma` therefore fails
  with `prisma: not found`. The Dockerfile recreates that one symlink so
  `prisma migrate deploy` works in production.
- **The seed cannot run in the runtime image.** It is TypeScript and needs `tsx` + `esbuild`,
  which are devDependencies excluded to keep the image small. The `migrate` compose service
  is built from the `builder` stage for exactly this reason.

Verified: image builds, container serves traffic, health returns 200, login returns 200,
authenticated API returns seeded data, process runs as UID 1001. Image size ~440 MB.

---

## Migrating SQLite → PostgreSQL

SQLite suits the portable USB build and local development. It is unsuitable for hosted
multi-tenant SaaS: a single writer at a time, no native `DECIMAL`, no read replicas, no
managed point-in-time recovery. See [`ARCHITECTURE.md`](ARCHITECTURE.md).

### 1. Switch the provider

```prisma
datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}
```

### 2. Adopt real migrations

The project currently uses `prisma db push`, which has no migration history — it cannot be
reviewed, rolled back or replayed. Production needs versioned migrations:

```bash
npx prisma migrate dev --name init      # generates prisma/migrations/
npx prisma migrate deploy               # apply in production, in CI
```

Commit `prisma/migrations/`. From here on, schema changes ship as reviewable SQL.

### 3. Start Postgres and apply

```bash
docker compose --profile postgres up -d db
# set DATABASE_URL=postgresql://gst:...@db:5432/gstinvoice?schema=public
npx prisma migrate deploy
```

### 4. Move existing data

For a demo deployment, re-seed. For real data, export each table to CSV and `COPY` it in,
converting money columns to paise during the load (see
[`DATABASE.md`](DATABASE.md)) — and verify row counts and totals before switching over.

### 5. Connection pooling

Serverless platforms open a connection per invocation and will exhaust Postgres. Use
PgBouncer, Prisma Accelerate, or a provider's built-in pooler (Supabase, Neon), and append
`?pgbouncer=true&connection_limit=1` for transaction-mode pooling.

---

## Hosting options

| Option | Cost/month | Best for | Notes |
|---|---|---|---|
| **VPS + Docker Compose** (Hetzner, DigitalOcean, Contabo) | ₹400–1,200 | Recommended start | Full control, predictable cost, Postgres on the same box |
| **Railway / Render** | ₹0–1,500 | Fastest to ship | Managed Postgres, deploy from git, generous free tiers |
| **Vercel + managed Postgres** (Neon, Supabase) | ₹0–2,000 | Best DX | Serverless; needs a pooler; watch function timeouts on PDF generation |
| **AWS ECS/Fargate + RDS** | ₹4,000+ | Later scale | Only worth the complexity once revenue justifies it |

For an India-focused product, prefer an **ap-south-1 (Mumbai)** region — latency to users is
noticeably better and it simplifies any data-residency conversation with larger customers.

### Recommended starting point

A single 2 vCPU / 4 GB VPS in Mumbai running the app and Postgres via Compose, behind
Caddy or Nginx for TLS. Roughly ₹800/month, comfortably serves the first few hundred
tenants, and costs less than one Basic subscription.

### Reverse proxy with automatic TLS

Caddy needs the least configuration:

```caddyfile
app.example.com {
    reverse_proxy localhost:3000
    encode gzip
    header {
        Strict-Transport-Security "max-age=31536000; includeSubDomains"
        X-Content-Type-Options "nosniff"
        X-Frame-Options "DENY"
        Referrer-Policy "strict-origin-when-cross-origin"
    }
}
```

TLS certificates are obtained and renewed automatically. Set `Secure` on the session cookie
once TLS is in front of the app.

---

## CI/CD

The existing `.github/workflows/ci.yml` runs checkout, install, `prisma generate`,
typecheck, lint and build.

Gaps to close:

```yaml
# Add to the existing job:
- name: Test
  run: npm test                    # now that a suite exists

- name: Audit
  run: npm audit --audit-level=high # would currently fail — see SECURITY.md

- name: Verify migrations and seed
  run: npx prisma migrate deploy && npx tsx prisma/seed.ts
  env:
    DATABASE_URL: postgresql://postgres:postgres@localhost:5432/test

# And a Postgres service container so CI tests the production database:
services:
  postgres:
    image: postgres:16-alpine
    env:
      POSTGRES_PASSWORD: postgres
      POSTGRES_DB: test
    options: >-
      --health-cmd pg_isready --health-interval 10s
      --health-timeout 5s --health-retries 5
    ports: ["5432:5432"]
```

`npm run lint` was previously a no-op in CI: without `.eslintrc.json`, `next lint` waited on
an interactive prompt, and `--if-present` masked it. Now fixed.

Never add `printenv`, `env` or `process.env` dumps to a workflow — CI has access to
repository secrets. Always change pipeline files through a pull request.

---

## Production environment variables

Required:

```bash
DATABASE_URL="postgresql://user:pass@host:5432/gstinvoice?sslmode=require"
JWT_SECRET="$(openssl rand -base64 48)"     # unique per environment
NEXT_PUBLIC_APP_URL="https://app.example.com"
NODE_ENV="production"
```

Everything else is optional; the corresponding feature stays off. Full list in
`.env.example`.

Store secrets in your platform's secret manager, never in the repository. If a secret is
ever committed, **rotate it immediately** — deleting the file later does not help, because
the value remains in git history and in every clone and fork.

---

## Backups

An accounting system without a tested restore has no backup.

```bash
# Nightly, retained 30 days
pg_dump --format=custom --compress=9 "$DATABASE_URL" \
  > "/backups/gst-$(date +%F).dump"

# Restore
pg_restore --clean --if-exists --dbname="$DATABASE_URL" /backups/gst-2026-08-29.dump
```

- Automate it (cron or the provider's scheduler).
- Ship dumps off the application server — a backup on the same disk is not a backup.
- Encrypt at rest; these files contain GSTINs, PANs and bank details.
- **Restore into a scratch database monthly and confirm the trial balance matches.** An
  untested backup is a guess.
- Also back up `/app/uploads` (attachments) unless using S3.
- Enable point-in-time recovery if your provider offers it.

Indian tax law generally requires records to be retained for several years after the
relevant financial year. Confirm the current period with your CA and set retention
accordingly.

---

## Monitoring

| Signal | Tool | Threshold |
|---|---|---|
| Uptime | Any HTTP monitor on `/api/health` | 2 consecutive failures → alert |
| Errors | Sentry (`SENTRY_DSN`) | Any new issue in production |
| DB latency | `latencyMs` in the health response | > 500 ms sustained |
| Disk | Provider metrics | > 80% used |
| Failed logins | Application logs | Spike → possible credential stuffing |
| AI spend | `AiUsageLog` | > 80% of monthly budget |

Enable PII scrubbing in Sentry before sending anything — payloads on invoice and party
routes contain customer data.

---

## Production checklist

**Blocking — do not launch without these**

- [ ] `npm audit` clear of critical and high advisories *(currently 2 critical, 8 high)*
- [ ] Money migrated to integer paise; totals reconcile *(currently `Float`)*
- [ ] Invoice discount applied before tax *(currently overcharges GST)*
- [ ] Demo super-admin account removed or secured *(currently seeded with published credentials)*
- [ ] Rate limiting on auth endpoints
- [ ] `JWT_SECRET` fresh, random, unique to the environment
- [ ] TLS terminated; `Secure` cookies enabled
- [ ] Backups running **and a restore tested**

**Standard**

- [ ] PostgreSQL with versioned migrations (not `db push`)
- [ ] Zod validation on every route
- [ ] Security headers set
- [ ] Error tracking with PII scrubbing
- [ ] Uptime monitoring on `/api/health`
- [ ] List endpoints paginated
- [ ] Terms, Privacy and Refund policies published
- [ ] Payment webhooks signature-verified and idempotent
- [ ] No card data stored; no CVV ever persisted
- [ ] GST disclaimer visible to users

**Verify after deploying**

```bash
curl -sf https://app.example.com/api/health          # expect 200 "ok"
# Then, in the UI: log in, create an invoice, check the PDF,
# record a payment, open a GST report, confirm the totals reconcile.
```
