# syntax=docker/dockerfile:1
#
# Multi-stage build for the GST Invoice System.
#
# Relies on `output: "standalone"` in next.config.js, which emits a
# self-contained server bundle with only the runtime deps it actually needs.
# The final image therefore does not carry the full node_modules tree.
#
# Build:  docker build -t gst-invoice-system .
# Run:    docker run --rm -p 3000:3000 --env-file .env gst-invoice-system

# ---------------------------------------------------------------------------
# Stage 1: install dependencies
# ---------------------------------------------------------------------------
FROM node:20-alpine AS deps
WORKDIR /app

# Prisma needs OpenSSL for its query engine.
RUN apk add --no-cache libc6-compat openssl

COPY package.json package-lock.json ./
COPY prisma ./prisma

# `npm ci` triggers the postinstall `prisma generate`, so the schema must be
# copied first (above) or the generate step fails.
RUN npm ci

# ---------------------------------------------------------------------------
# Stage 2: build
# ---------------------------------------------------------------------------
FROM node:20-alpine AS builder
WORKDIR /app

RUN apk add --no-cache libc6-compat openssl

COPY --from=deps /app/node_modules ./node_modules
COPY . .

# A dummy DATABASE_URL is enough for `prisma generate` and the Next.js build;
# no database connection is opened at build time. Real values are injected at
# runtime. JWT_SECRET is set because src/lib/auth.ts intentionally throws when
# it is missing in production - that guard must not break the image build.
ENV DATABASE_URL="file:./build-placeholder.db"
ENV JWT_SECRET="build-time-placeholder-not-used-at-runtime"
ENV NEXT_TELEMETRY_DISABLED=1

RUN npm run build

# ---------------------------------------------------------------------------
# Stage 3: runtime
# ---------------------------------------------------------------------------
FROM node:20-alpine AS runner
WORKDIR /app

RUN apk add --no-cache libc6-compat openssl curl

ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV PORT=3000
ENV HOSTNAME=0.0.0.0

# Run as a non-root user. Note the GID/UID 1001 - the `node` user already
# owns 1000 in this base image.
RUN addgroup --system --gid 1001 nodejs \
 && adduser --system --uid 1001 nextjs

COPY --from=builder /app/public ./public
COPY --from=builder --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=builder --chown=nextjs:nodejs /app/.next/static ./.next/static

# Prisma schema + CLI are kept in the image so schema migrations can be applied
# to the production database from this same container:
#   docker compose exec app npx prisma migrate deploy
COPY --from=builder --chown=nextjs:nodejs /app/prisma ./prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/.prisma ./node_modules/.prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/@prisma ./node_modules/@prisma
COPY --from=builder --chown=nextjs:nodejs /app/node_modules/prisma ./node_modules/prisma

# `output: "standalone"` does not emit node_modules/.bin, so the prisma
# executable would not be on PATH and `npx prisma` fails with "prisma: not
# found". Recreate the one symlink we need.
RUN mkdir -p node_modules/.bin \
 && ln -sf ../prisma/build/index.js node_modules/.bin/prisma \
 && chmod +x node_modules/prisma/build/index.js

# NOTE: the seed script is intentionally NOT runnable here. It is TypeScript and
# needs tsx + esbuild, which are devDependencies excluded from this slim image.
# Seed via the `migrate` service in docker-compose.yml, which uses the builder
# stage and therefore has the full toolchain.

# Writable location for SQLite and uploaded attachments when no S3 bucket is
# configured. Declared as a VOLUME so data survives container replacement.
RUN mkdir -p /app/data /app/uploads && chown -R nextjs:nodejs /app/data /app/uploads
VOLUME ["/app/data", "/app/uploads"]

USER nextjs
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD curl -fsS http://127.0.0.1:3000/api/health || exit 1

CMD ["node", "server.js"]
