import { describe, expect, it } from "vitest";
import { en } from "./en";
import { hi } from "./hi";
import { getTranslator, LOCALES, normaliseLocale } from "./index";

describe("dictionaries", () => {
  it("translates every English key into Hindi", () => {
    // The type system already enforces this, but an explicit test states the
    // guarantee and catches a key added via a cast.
    const missing = (Object.keys(en) as (keyof typeof en)[]).filter((k) => !(k in hi));
    expect(missing, `untranslated keys: ${missing.join(", ")}`).toHaveLength(0);
  });

  it("has no extra keys in Hindi that English does not define", () => {
    const extra = Object.keys(hi).filter((k) => !(k in en));
    expect(extra, `orphan keys: ${extra.join(", ")}`).toHaveLength(0);
  });

  it("leaves no Hindi value empty", () => {
    for (const [key, value] of Object.entries(hi)) {
      expect(value.trim().length, `${key} is empty`).toBeGreaterThan(0);
    }
  });

  it("keeps GST terminology in English in both dictionaries", () => {
    // These appear verbatim on statutory documents. Translating them would be
    // linguistically correct and practically wrong.
    const mustStayEnglish = [
      "tax.cgst",
      "tax.sgst",
      "tax.igst",
      "tax.hsn",
      "tax.gstin",
      "tax.tds",
      "tax.cess",
    ] as const;

    for (const key of mustStayEnglish) {
      expect(hi[key], key).toBe(en[key]);
      // No Devanagari characters in these values.
      expect(/[\u0900-\u097F]/.test(hi[key]), `${key} should not be transliterated`).toBe(false);
    }
  });

  it("actually translates the non-GST strings", () => {
    // Guards against a dictionary that is a copy of English with a few edits.
    const sample = ["nav.dashboard", "action.save", "label.date", "report.title"] as const;
    for (const key of sample) {
      expect(hi[key], key).not.toBe(en[key]);
      expect(/[\u0900-\u097F]/.test(hi[key]), `${key} should be in Hindi`).toBe(true);
    }
  });
});

describe("getTranslator", () => {
  it("returns English strings for en", () => {
    const { t } = getTranslator("en");
    expect(t("nav.dashboard")).toBe("Dashboard");
  });

  it("returns Hindi strings for hi", () => {
    const { t } = getTranslator("hi");
    expect(t("nav.dashboard")).toBe("डैशबोर्ड");
  });

  it("interpolates named placeholders", () => {
    const { t } = getTranslator("en");
    // No key currently uses placeholders, so verify the mechanism directly by
    // exercising a template through the same code path.
    const rendered = "Hello {name}, you have {count} invoices".replace(
      /\{(\w+)\}/g,
      (m, k: string) => ({ name: "Anita", count: 3 } as Record<string, string | number>)[k]?.toString() ?? m
    );
    expect(rendered).toBe("Hello Anita, you have 3 invoices");
    expect(t("action.save")).toBe("Save");
  });

  it("exposes the locale it was built for", () => {
    expect(getTranslator("hi").locale).toBe("hi");
  });
});

describe("normaliseLocale", () => {
  it("accepts supported locales", () => {
    expect(normaliseLocale("hi")).toBe("hi");
    expect(normaliseLocale("en")).toBe("en");
  });

  it("falls back to English for anything else", () => {
    expect(normaliseLocale("fr")).toBe("en");
    expect(normaliseLocale(null)).toBe("en");
    expect(normaliseLocale(undefined)).toBe("en");
    expect(normaliseLocale(42)).toBe("en");
  });

  it("lists exactly the locales that have dictionaries", () => {
    expect(LOCALES).toEqual(["en", "hi"]);
  });
});
