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
    const banned = /\b(cart|checkout|payout|GMV|refund)\b/i;
    for (const [key, value] of Object.entries(en)) {
      const strings = typeof value === "string" ? [value] : Object.values(value);
      for (const s of strings) expect(s, key).not.toMatch(banned);
    }
  });

  /*
     "Commission" is banned as a claim, not as a word.

     The list above carried a bare `commission` for four handoffs, which was
     wider than the rule it was standing in for: CLAUDE.md's banned list is
     cart, basket, checkout, buy, purchase, payout, refund, dispatch, POD and
     GMV, and `pnpm check:vocabulary` — the version CI runs — has never banned
     it. The word only became reachable when board 1l shipped, because the
     load-bearing commercial claim on the pricing page is the *absence* of one:
     "no setup fee, no commission, no pay-per-lead", which is literally true and
     is the sharpest line the product has against every incumbent directory.

     So the negated form is allowed and the bare noun is not. A string that
     names a commission as something that exists still fails here, and the
     schema half of the same rule is `pnpm check:schema`, which refuses a
     `commissionRate` or `transactionFee` column outright.
  */
  it("never names a commission as something that exists", () => {
    const claimed = /(?<!\bno )\bcommissions?\b/i;
    for (const [key, value] of Object.entries(en)) {
      const strings = typeof value === "string" ? [value] : Object.values(value);
      for (const s of strings) expect(s, key).not.toMatch(claimed);
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
