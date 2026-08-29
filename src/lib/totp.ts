/**
 * Time-based one-time passwords (RFC 6238), for two-factor authentication.
 *
 * WHY NO LIBRARY
 * --------------
 * TOTP is HMAC-SHA1 over a time counter plus base32 encoding — around 80 lines.
 * A dependency for that is more supply-chain surface than the algorithm is
 * complexity, and this way the security-critical parts (constant-time comparison,
 * replay window, secret generation) are visible and testable rather than assumed.
 *
 * SHA-1 is correct here and is not a weakness: RFC 6238 specifies HMAC-SHA1, and
 * every authenticator app (Google Authenticator, Authy, 1Password) implements
 * that. HMAC-SHA1 is not affected by the SHA-1 collision attacks, which concern
 * digital signatures rather than message authentication.
 */

import crypto from "node:crypto";

const BASE32_ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";

/** Standard 30-second step. */
export const TOTP_STEP_SECONDS = 30;
/** Six digits, as every authenticator app expects. */
export const TOTP_DIGITS = 6;
/**
 * How many steps either side of "now" are accepted.
 *
 * One step (±30s) tolerates clock drift and the time a user takes to type the
 * code. Widening this would make replay easier, so it stays at one.
 */
export const TOTP_WINDOW = 1;

// ---------------------------------------------------------------------------
// Base32 (RFC 4648, no padding) — the encoding authenticator apps expect
// ---------------------------------------------------------------------------

export function base32Encode(buffer: Buffer): string {
  let bits = 0;
  let value = 0;
  let output = "";

  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      output += BASE32_ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) {
    output += BASE32_ALPHABET[(value << (5 - bits)) & 31];
  }
  return output;
}

export function base32Decode(input: string): Buffer {
  // Users retype secrets by hand, so normalise case, strip padding and spaces.
  const cleaned = input.toUpperCase().replace(/=+$/, "").replace(/\s+/g, "");

  let bits = 0;
  let value = 0;
  const bytes: number[] = [];

  for (const char of cleaned) {
    const index = BASE32_ALPHABET.indexOf(char);
    if (index === -1) throw new Error("Invalid base32 character in secret");

    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      bytes.push((value >>> (bits - 8)) & 0xff);
      bits -= 8;
    }
  }
  return Buffer.from(bytes);
}

// ---------------------------------------------------------------------------
// Secret generation
// ---------------------------------------------------------------------------

/**
 * Generate a TOTP secret.
 *
 * 20 bytes (160 bits) is the RFC 6238 recommendation for HMAC-SHA1 and encodes to
 * 32 base32 characters, which is what authenticator apps expect to scan.
 */
export function generateTotpSecret(): string {
  return base32Encode(crypto.randomBytes(20));
}

/**
 * Build the `otpauth://` URI that a QR code encodes.
 *
 * The issuer appears twice by design: once as a label prefix for apps that only
 * read the label, and once as a parameter for apps that read parameters.
 */
export function totpUri(opts: {
  secret: string;
  accountName: string;
  issuer: string;
}): string {
  const label = encodeURIComponent(`${opts.issuer}:${opts.accountName}`);
  const params = new URLSearchParams({
    secret: opts.secret,
    issuer: opts.issuer,
    algorithm: "SHA1",
    digits: String(TOTP_DIGITS),
    period: String(TOTP_STEP_SECONDS),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Code generation and verification
// ---------------------------------------------------------------------------

/** Generate the code for a specific counter value. Exposed for testing. */
export function generateTotpForCounter(secret: string, counter: number): string {
  const key = base32Decode(secret);

  // 8-byte big-endian counter.
  const buffer = Buffer.alloc(8);
  // Split across two 32-bit writes: a JS bitwise shift is 32-bit, so
  // `counter >>> 32` would always be 0 and every code would collide.
  buffer.writeUInt32BE(Math.floor(counter / 0x100000000), 0);
  buffer.writeUInt32BE(counter % 0x100000000, 4);

  const digest = crypto.createHmac("sha1", key).update(buffer).digest();

  // Dynamic truncation, RFC 4226 section 5.3.
  const offset = digest[digest.length - 1] & 0x0f;
  const binary =
    ((digest[offset] & 0x7f) << 24) |
    ((digest[offset + 1] & 0xff) << 16) |
    ((digest[offset + 2] & 0xff) << 8) |
    (digest[offset + 3] & 0xff);

  return String(binary % 10 ** TOTP_DIGITS).padStart(TOTP_DIGITS, "0");
}

/** Current code for a secret. */
export function generateTotp(secret: string, now: number = Date.now()): string {
  return generateTotpForCounter(secret, Math.floor(now / 1000 / TOTP_STEP_SECONDS));
}

/**
 * Verify a code against a secret.
 *
 * Returns the matched counter so the caller can store it and reject a REPLAY of
 * the same code within its validity window. Returning a bare boolean would leave
 * a 30-second window in which a shoulder-surfed code works twice.
 *
 * Comparison is constant-time: a fast `===` on a 6-digit code leaks position
 * information through timing, and 6 digits is a small enough space that it matters.
 */
export function verifyTotp(
  secret: string,
  code: string,
  opts: { now?: number; lastUsedCounter?: number | null } = {}
): { valid: boolean; counter?: number; reason?: "FORMAT" | "MISMATCH" | "REPLAY" } {
  const cleaned = code.replace(/\s+/g, "");
  if (!new RegExp(`^\\d{${TOTP_DIGITS}}$`).test(cleaned)) {
    return { valid: false, reason: "FORMAT" };
  }

  const now = opts.now ?? Date.now();
  const currentCounter = Math.floor(now / 1000 / TOTP_STEP_SECONDS);

  for (let drift = -TOTP_WINDOW; drift <= TOTP_WINDOW; drift++) {
    const counter = currentCounter + drift;
    if (counter < 0) continue;

    const expected = generateTotpForCounter(secret, counter);
    if (!timingSafeEqualStrings(expected, cleaned)) continue;

    // Correct code, but already used — reject rather than accept a replay.
    if (opts.lastUsedCounter != null && counter <= opts.lastUsedCounter) {
      return { valid: false, reason: "REPLAY" };
    }
    return { valid: true, counter };
  }

  return { valid: false, reason: "MISMATCH" };
}

function timingSafeEqualStrings(a: string, b: string): boolean {
  const bufA = Buffer.from(a, "utf8");
  const bufB = Buffer.from(b, "utf8");
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------------------------------
// Recovery codes
// ---------------------------------------------------------------------------

/**
 * Generate single-use recovery codes.
 *
 * Without these, a lost or wiped phone locks the owner out of their own books
 * permanently — which for an accounting system is worse than the risk 2FA removes.
 */
export function generateRecoveryCodes(count = 8): string[] {
  return Array.from({ length: count }, () => {
    // Grouped for legibility when written down.
    const raw = crypto.randomBytes(5).toString("hex").toUpperCase();
    return `${raw.slice(0, 5)}-${raw.slice(5, 10)}`;
  });
}

/**
 * Hash recovery codes for storage.
 *
 * SHA-256 rather than bcrypt: these are high-entropy random values, not
 * user-chosen passwords, so there is no dictionary to slow down, and a fast hash
 * keeps verification cheap. Normalised first so case and dashes do not matter
 * when someone types one in.
 */
export function hashRecoveryCode(code: string): string {
  const normalised = code.toUpperCase().replace(/[\s-]/g, "");
  return crypto.createHash("sha256").update(normalised).digest("hex");
}

/** Check a code against stored hashes, returning which one matched. */
export function findRecoveryCodeMatch(
  code: string,
  storedHashes: string[]
): { matched: true; hash: string } | { matched: false } {
  const candidate = hashRecoveryCode(code);
  for (const hash of storedHashes) {
    if (timingSafeEqualStrings(hash, candidate)) return { matched: true, hash };
  }
  return { matched: false };
}
