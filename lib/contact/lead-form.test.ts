import { describe, expect, it } from "vitest";
import { leadSource, mobileFieldValue, readLeadFields, sourcePathFrom } from "./lead-form";

describe("the three fields (1d amendment)", () => {
  it("accepts a UAE mobile however it is typed beside the fixed +971", () => {
    for (const mobile of ["50 123 4567", "050 123 4567", "+971 50 123 4567", "00971501234567", "501234567"]) {
      const read = readLeadFields({ name: "Priya Menon", email: "Priya@MarinaFM.test", mobile });
      expect(read, mobile).toEqual({
        ok: true,
        lead: { name: "Priya Menon", email: "priya@marinafm.test", mobile: "+971501234567" },
      });
    }
  });

  it("reports every problem at once, never the first", () => {
    expect(readLeadFields({ name: " ", email: "", mobile: "" })).toEqual({
      ok: false,
      problems: { name: "name_missing", email: "email_missing", mobile: "mobile_missing" },
    });
    expect(readLeadFields({ name: "P", email: "priya@marinafm", mobile: "12" })).toEqual({
      ok: false,
      problems: { name: "name_short", email: "email_shape", mobile: "mobile_not_uae" },
    });
  });

  it("refuses a landline — a lead the seller cannot WhatsApp back", () => {
    const read = readLeadFields({ name: "Priya Menon", email: "priya@marinafm.test", mobile: "04 883 4120" });
    expect(read).toEqual({ ok: false, problems: { mobile: "mobile_not_uae" } });
  });

  it("collapses the whitespace in a name and bounds it", () => {
    const read = readLeadFields({ name: "  Priya   Menon ", email: "p@m.test", mobile: "0501234567" });
    expect(read.ok && read.lead.name).toBe("Priya Menon");
    expect(readLeadFields({ name: "x".repeat(121), email: "p@m.test", mobile: "0501234567" })).toMatchObject({
      ok: false,
      problems: { name: "name_long" },
    });
  });

  it("prefills a stored mobile in the field's own shape, and nothing that is not one", () => {
    expect(mobileFieldValue("+971506412288")).toBe("50 641 2288");
    expect(mobileFieldValue("+97148834120")).toBe("");
    expect(mobileFieldValue(null)).toBe("");
  });
});

describe("where the buyer came from (B9)", () => {
  const hosts = ["businesslistings.me", "localhost:3000"];

  it("records a path on the platform's own hosts, and nothing from anywhere else", () => {
    expect(sourcePathFrom("https://businesslistings.me/search?q=valves", hosts)).toBe("/search?q=valves");
    expect(sourcePathFrom("http://localhost:3000/c/valves-and-fittings", hosts)).toBe("/c/valves-and-fittings");
    expect(sourcePathFrom("https://www.google.com/search?q=valves", hosts)).toBeNull();
    expect(sourcePathFrom("", hosts)).toBeNull();
    expect(sourcePathFrom("not a url", hosts)).toBeNull();
    expect(sourcePathFrom("javascript:alert(1)", hosts)).toBeNull();
  });

  it("drops query parameters that can carry a secret or a person", () => {
    expect(
      sourcePathFrom("https://businesslistings.me/review/new?enq=ENQ-1&t=seed-token&email=a@b.test", hosts),
    ).toBe("/review/new?enq=ENQ-1");
  });

  it("is bounded to the column's length", () => {
    const long = `https://businesslistings.me/search?q=${"a".repeat(900)}`;
    expect(sourcePathFrom(long, hosts)?.length).toBe(500);
  });

  it("words a path by what it was", () => {
    expect(leadSource(null, "al-waha")).toMatchObject({ kind: "direct" });
    expect(leadSource("/", "al-waha")).toMatchObject({ kind: "home" });
    expect(leadSource("/search?q=butterfly+valves", "al-waha")).toMatchObject({ kind: "search", query: "butterfly valves" });
    expect(leadSource("/search", "al-waha")).toMatchObject({ kind: "search", query: null });
    expect(leadSource("/c/valves", "al-waha")).toMatchObject({ kind: "category" });
    expect(leadSource("/b/al-waha/branches", "al-waha")).toMatchObject({ kind: "storefront" });
    expect(leadSource("/b/al-waha-two", "al-waha")).toMatchObject({ kind: "other_storefront" });
    expect(leadSource("/guides/valves", "al-waha")).toMatchObject({ kind: "page" });
  });
});
