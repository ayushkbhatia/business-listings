import { describe, expect, it } from "vitest";
import { dir, isLocale } from "./locales";
import { en } from "./en";
import { hasMessage, messageKeys, t } from "./t";

describe("t", () => {
  it("returns the string for a key", () => {
    expect(t("action.save")).toBe("Save");
  });

  it("interpolates named parameters", () => {
    expect(t("error.required", { field: "Trade licence" })).toBe("Trade licence is required");
  });

  it("selects the plural form from count", () => {
    expect(t("count.products", { count: 1 })).toBe("1 product");
    expect(t("count.products", { count: 218 })).toBe("218 products");
    expect(t("count.products", { count: 0 })).toBe("0 products");
  });

  it("interpolates alongside a plural", () => {
    expect(t("count.suppliers_in_area", { count: 218, area: "Al Quoz" })).toBe(
      "218 suppliers in Al Quoz",
    );
    expect(t("count.suppliers_in_area", { count: 1, area: "Al Quoz" })).toBe(
      "1 supplier in Al Quoz",
    );
  });

  it("throws on an unknown key outside production", () => {
    // @ts-expect-error the key type is the point — this must not compile either
    expect(() => t("nope.not.a.key")).toThrow(/Unknown key/);
  });

  it("throws when a parameter the template needs is missing", () => {
    expect(() => t("error.required", {})).toThrow(/Missing parameter "field"/);
  });

  it("throws when a pluralised key is called without a count", () => {
    expect(() => t("count.products")).toThrow(/needs a numeric "count"/);
  });
});

describe("the catalogue itself", () => {
  it("carries no exclamation marks", () => {
    for (const [key, value] of Object.entries(en)) {
      const strings = typeof value === "string" ? [value] : Object.values(value);
      for (const s of strings) expect(s, key).not.toContain("!");
    }
  });

  it("uses none of the banned words", () => {
    const banned = /\b(just|simply|easily)\b/i;
    for (const [key, value] of Object.entries(en)) {
      const strings = typeof value === "string" ? [value] : Object.values(value);
      for (const s of strings) expect(s, key).not.toMatch(banned);
    }
  });

  it("uses none of the banned vocabulary from the CLAUDE.md table", () => {
    // "order" is allowed inside "made to order" and "indent order" — those
    // describe the seller's own process, not a platform order entity.
    const banned = /\b(cart|checkout|payout|commission|GMV|refund)\b/i;
    for (const [key, value] of Object.entries(en)) {
      const strings = typeof value === "string" ? [value] : Object.values(value);
      for (const s of strings) expect(s, key).not.toMatch(banned);
    }
  });

  it("has no key whose value is empty", () => {
    for (const [key, value] of Object.entries(en)) {
      const strings = typeof value === "string" ? [value] : Object.values(value);
      for (const s of strings) expect(s.trim(), key).not.toBe("");
    }
  });

  it("exposes its keys for the localisation screen", () => {
    expect(messageKeys()).toContain("action.save");
    expect(hasMessage("action.save")).toBe(true);
    expect(hasMessage("action.nonexistent")).toBe(false);
  });
});

describe("direction", () => {
  it("is ltr for english and rtl for arabic, so no layout may hardcode it", () => {
    expect(dir("en")).toBe("ltr");
    expect(dir("ar")).toBe("rtl");
    expect(dir("ar-AE")).toBe("rtl");
    expect(dir()).toBe("ltr");
  });

  it("recognises the locales it actually ships", () => {
    expect(isLocale("en")).toBe(true);
    expect(isLocale("ar")).toBe(false);
  });
});
