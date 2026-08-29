/**
 * Edge middleware: security headers, CSRF origin checks and API rate limiting.
 *
 * The application previously had no middleware at all, which left three gaps:
 *
 *   1. No security headers - no CSP, no clickjacking protection, no HSTS.
 *   2. No CSRF defence beyond the cookie's SameSite=Lax. Lax blocks cross-site
 *      form POSTs but is not a complete defence, and there was no origin check.
 *   3. No rate limiting, so login accepted unlimited attempts.
 *
 * Authentication itself is NOT enforced here. JWT verification needs the Node
 * crypto APIs that the Edge runtime does not provide, and duplicating auth in
 * two places invites the two copies to disagree. Route handlers remain the
 * authority via `getCurrentUserAndCompany()`; this layer is defence in depth.
 */

import { NextRequest, NextResponse } from "next/server";
import { API_LIMIT, rateLimit } from "@/lib/rate-limit";

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Content Security Policy.
 *
 * `'unsafe-inline'` and `'unsafe-eval'` are required for scripts because
 * Next.js injects inline bootstrap scripts and React refresh uses eval in
 * development. Tightening this to a nonce-based policy is worthwhile but is a
 * behavioural change to every page, so it is deliberately not bundled here.
 */
function contentSecurityPolicy(isDev: boolean): string {
  return [
    "default-src 'self'",
    `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
    "style-src 'self' 'unsafe-inline'",
    // data: for inline QR codes and logos; blob: for generated PDFs.
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    "connect-src 'self'",
    // The barcode scanner renders a camera stream into a blob URL.
    "media-src 'self' blob:",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    "upgrade-insecure-requests",
  ].join("; ");
}

function applySecurityHeaders(res: NextResponse, isDev: boolean): NextResponse {
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("X-DNS-Prefetch-Control", "off");
  res.headers.set(
    "Permissions-Policy",
    // The POS barcode scanner needs the camera; nothing else is granted.
    "camera=(self), microphone=(), geolocation=(), payment=()"
  );
  res.headers.set("Content-Security-Policy", contentSecurityPolicy(isDev));

  // HSTS only over HTTPS: sending it over plain HTTP in local development would
  // pin localhost to HTTPS in the browser and break the dev server.
  if (!isDev) {
    res.headers.set(
      "Strict-Transport-Security",
      "max-age=31536000; includeSubDomains"
    );
  }
  return res;
}

/**
 * Verify a state-changing request originated from this site.
 *
 * Checks Origin, falling back to Referer. A request with neither header is
 * allowed through, because non-browser clients (curl, server-to-server) legitimately
 * omit both and cannot be the target of a CSRF attack - CSRF requires a browser
 * that automatically attaches the session cookie.
 */
function isSameOrigin(req: NextRequest): boolean {
  const origin = req.headers.get("origin");
  const referer = req.headers.get("referer");
  if (!origin && !referer) return true;

  const host = req.headers.get("host");
  if (!host) return false;

  const candidate = origin ?? referer!;
  try {
    const url = new URL(candidate);
    return url.host === host;
  } catch {
    return false;
  }
}

export function middleware(req: NextRequest) {
  const isDev = process.env.NODE_ENV !== "production";
  const { pathname } = req.nextUrl;
  const isApi = pathname.startsWith("/api/");

  // Health checks must stay reachable for probes: never rate limit or
  // origin-check them, or a load balancer will mark a healthy app as down.
  if (pathname === "/api/health") {
    return applySecurityHeaders(NextResponse.next(), isDev);
  }

  if (isApi && !SAFE_METHODS.has(req.method)) {
    if (!isSameOrigin(req)) {
      return applySecurityHeaders(
        NextResponse.json(
          { error: "Request blocked: cross-origin write requests are not allowed." },
          { status: 403 }
        ),
        isDev
      );
    }
  }

  // Login and registration are limited in their route handlers, keyed on both
  // IP and email so one address cannot lock out every account. This is the
  // broader per-IP ceiling for everything else.
  if (isApi && !pathname.startsWith("/api/auth/")) {
    const ip =
      req.headers.get("x-forwarded-for")?.split(",")[0].trim() ??
      req.headers.get("x-real-ip") ??
      "unknown";

    const result = rateLimit(`api:${ip}`, API_LIMIT, 60_000);
    if (!result.allowed) {
      const res = NextResponse.json(
        { error: "Too many requests. Please slow down and try again shortly." },
        { status: 429 }
      );
      res.headers.set("Retry-After", String(result.retryAfter));
      res.headers.set("X-RateLimit-Limit", String(result.limit));
      res.headers.set("X-RateLimit-Remaining", "0");
      return applySecurityHeaders(res, isDev);
    }
  }

  return applySecurityHeaders(NextResponse.next(), isDev);
}

export const config = {
  // Skip Next.js internals and static assets: they need no checks and matching
  // them would add latency to every asset request.
  matcher: ["/((?!_next/static|_next/image|favicon.ico|icon.svg|sw.js|manifest.webmanifest|offline.html).*)"],
};
