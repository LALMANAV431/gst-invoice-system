import { describe, expect, it } from "vitest";
import {
  base32Decode,
  base32Encode,
  findRecoveryCodeMatch,
  generateRecoveryCodes,
  generateTotp,
  generateTotpForCounter,
  generateTotpSecret,
  hashRecoveryCode,
  totpUri,
  TOTP_STEP_SECONDS,
  verifyTotp,
} from "./totp";

describe("base32", () => {
  it("round-trips arbitrary bytes", () => {
    for (const input of ["", "a", "ab", "abc", "abcd", "abcde", "hello world"]) {
      const buf = Buffer.from(input, "utf8");
      expect(base32Decode(base32Encode(buf)).toString("utf8")).toBe(input);
    }
  });

  it("produces only RFC 4648 alphabet characters", () => {
    const encoded = base32Encode(Buffer.from([0, 255, 128, 64, 32]));
    expect(encoded).toMatch(/^[A-Z2-7]+$/);
  });

  it("tolerates lowercase, spaces and padding when decoding", () => {
    // Users retype secrets by hand.
    const secret = base32Encode(Buffer.from("secretkey"));
    const messy = secret.toLowerCase().match(/.{1,4}/g)!.join(" ") + "==";
    expect(base32Decode(messy).toString("utf8")).toBe("secretkey");
  });

  it("rejects invalid characters", () => {
    // 0, 1 and 8 are deliberately absent from the alphabet.
    expect(() => base32Decode("ABC1")).toThrow(/Invalid base32/);
  });
});

describe("RFC 6238 test vectors", () => {
  // The RFC's SHA-1 vectors use the ASCII secret "12345678901234567890".
  const secret = base32Encode(Buffer.from("12345678901234567890", "utf8"));

  it("matches the published vectors", () => {
    // Each entry is [unix time, expected 6-digit code].
    const vectors: [number, string][] = [
      [59, "287082"],
      [1111111109, "081804"],
      [1111111111, "050471"],
      [1234567890, "005924"],
      [2000000000, "279037"],
    ];

    for (const [time, expected] of vectors) {
      const counter = Math.floor(time / TOTP_STEP_SECONDS);
      expect(generateTotpForCounter(secret, counter), `t=${time}`).toBe(expected);
    }
  });

  it("handles a counter above 2^32 without collapsing", () => {
    // A single 32-bit shift would make the high word always zero, so every code
    // beyond 2^32 steps would collide.
    const a = generateTotpForCounter(secret, 0x100000000 + 5);
    const b = generateTotpForCounter(secret, 5);
    expect(a).not.toBe(b);
  });
});

describe("generateTotp", () => {
  const secret = generateTotpSecret();

  it("produces six digits", () => {
    expect(generateTotp(secret)).toMatch(/^\d{6}$/);
  });

  it("is stable within a 30-second step", () => {
    const base = 1_700_000_000_000;
    const step = base - (base % (TOTP_STEP_SECONDS * 1000));
    expect(generateTotp(secret, step)).toBe(generateTotp(secret, step + 29_000));
  });

  it("changes on the next step", () => {
    const base = 1_700_000_000_000;
    const step = base - (base % (TOTP_STEP_SECONDS * 1000));
    expect(generateTotp(secret, step)).not.toBe(
      generateTotp(secret, step + TOTP_STEP_SECONDS * 1000)
    );
  });

  it("differs between secrets", () => {
    expect(generateTotp(generateTotpSecret(), 1_700_000_000_000)).not.toBe(
      generateTotp(generateTotpSecret(), 1_700_000_000_000)
    );
  });
});

describe("verifyTotp", () => {
  const secret = generateTotpSecret();
  const now = 1_700_000_000_000;

  it("accepts the current code", () => {
    const result = verifyTotp(secret, generateTotp(secret, now), { now });
    expect(result.valid).toBe(true);
    expect(result.counter).toBe(Math.floor(now / 1000 / TOTP_STEP_SECONDS));
  });

  it("accepts a code from the previous step, for clock drift and typing time", () => {
    const previous = generateTotp(secret, now - TOTP_STEP_SECONDS * 1000);
    expect(verifyTotp(secret, previous, { now }).valid).toBe(true);
  });

  it("accepts a code from the next step, for a fast clock", () => {
    const next = generateTotp(secret, now + TOTP_STEP_SECONDS * 1000);
    expect(verifyTotp(secret, next, { now }).valid).toBe(true);
  });

  it("rejects a code two steps away", () => {
    const stale = generateTotp(secret, now - 2 * TOTP_STEP_SECONDS * 1000);
    const result = verifyTotp(secret, stale, { now });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("MISMATCH");
  });

  it("rejects a wrong code", () => {
    expect(verifyTotp(secret, "000000", { now }).valid).toBe(false);
  });

  it("rejects malformed input with a FORMAT reason", () => {
    for (const bad of ["", "12345", "1234567", "abcdef", "12 34 5"]) {
      const result = verifyTotp(secret, bad, { now });
      expect(result.valid, bad).toBe(false);
      expect(result.reason, bad).toBe("FORMAT");
    }
  });

  it("tolerates spaces inside an otherwise valid code", () => {
    const code = generateTotp(secret, now);
    const spaced = `${code.slice(0, 3)} ${code.slice(3)}`;
    expect(verifyTotp(secret, spaced, { now }).valid).toBe(true);
  });

  it("rejects a REPLAY of an already-used code", () => {
    // Without this, a shoulder-surfed code works for its whole 30-second window.
    const code = generateTotp(secret, now);
    const first = verifyTotp(secret, code, { now });
    expect(first.valid).toBe(true);

    const replay = verifyTotp(secret, code, { now, lastUsedCounter: first.counter });
    expect(replay.valid).toBe(false);
    expect(replay.reason).toBe("REPLAY");
  });

  it("rejects an older counter once a newer one has been used", () => {
    const currentCounter = Math.floor(now / 1000 / TOTP_STEP_SECONDS);
    const previous = generateTotp(secret, now - TOTP_STEP_SECONDS * 1000);
    const result = verifyTotp(secret, previous, { now, lastUsedCounter: currentCounter });
    expect(result.valid).toBe(false);
    expect(result.reason).toBe("REPLAY");
  });

  it("accepts the next code after one has been used", () => {
    const currentCounter = Math.floor(now / 1000 / TOTP_STEP_SECONDS);
    const later = now + TOTP_STEP_SECONDS * 1000;
    const result = verifyTotp(secret, generateTotp(secret, later), {
      now: later,
      lastUsedCounter: currentCounter,
    });
    expect(result.valid).toBe(true);
  });
});

describe("generateTotpSecret", () => {
  it("is 32 base32 characters (160 bits, per RFC 6238)", () => {
    const secret = generateTotpSecret();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    expect(base32Decode(secret)).toHaveLength(20);
  });

  it("never repeats", () => {
    const secrets = new Set(Array.from({ length: 300 }, () => generateTotpSecret()));
    expect(secrets.size).toBe(300);
  });
});

describe("totpUri", () => {
  it("builds a scannable otpauth URI", () => {
    const uri = totpUri({
      secret: "JBSWY3DPEHPK3PXP",
      accountName: "demo@gst.com",
      issuer: "GST Invoice",
    });
    expect(uri.startsWith("otpauth://totp/")).toBe(true);
    expect(uri).toContain("secret=JBSWY3DPEHPK3PXP");
    expect(uri).toContain("algorithm=SHA1");
    expect(uri).toContain("digits=6");
    expect(uri).toContain("period=30");
    // Issuer appears in the label and as a parameter, for apps that read either.
    expect(uri).toContain("issuer=GST+Invoice");
    expect(uri).toContain(encodeURIComponent("GST Invoice:demo@gst.com"));
  });
});

describe("recovery codes", () => {
  it("generates the requested number in a legible grouped format", () => {
    const codes = generateRecoveryCodes(8);
    expect(codes).toHaveLength(8);
    for (const code of codes) {
      expect(code).toMatch(/^[0-9A-F]{5}-[0-9A-F]{5}$/);
    }
  });

  it("never repeats within a set", () => {
    const codes = generateRecoveryCodes(50);
    expect(new Set(codes).size).toBe(50);
  });

  it("hashes consistently, ignoring case, dashes and spacing", () => {
    // Someone reading a code off paper will not reproduce the formatting.
    const base = hashRecoveryCode("ABCDE-12345");
    expect(hashRecoveryCode("abcde-12345")).toBe(base);
    expect(hashRecoveryCode("ABCDE12345")).toBe(base);
    expect(hashRecoveryCode(" abcde 12345 ")).toBe(base);
  });

  it("does not store the code itself", () => {
    const code = "ABCDE-12345";
    const hash = hashRecoveryCode(code);
    expect(hash).not.toContain("ABCDE");
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
  });

  it("finds a matching stored hash", () => {
    const codes = generateRecoveryCodes(4);
    const hashes = codes.map(hashRecoveryCode);

    const result = findRecoveryCodeMatch(codes[2], hashes);
    expect(result.matched).toBe(true);
    if (result.matched) expect(result.hash).toBe(hashes[2]);
  });

  it("rejects a code that is not in the set", () => {
    const hashes = generateRecoveryCodes(4).map(hashRecoveryCode);
    expect(findRecoveryCodeMatch("FFFFF-FFFFF", hashes).matched).toBe(false);
  });

  it("rejects everything against an empty set", () => {
    expect(findRecoveryCodeMatch("ABCDE-12345", []).matched).toBe(false);
  });
});
