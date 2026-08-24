import { describe, expect, it } from "vitest";
import { maskIdentifier, normaliseIdentifier } from "./identity";

describe("normaliseIdentifier", () => {
  it("brings every spelling of one number to the same string", () => {
    // A normalisation bug here is a security bug: two spellings counted
    // separately means the lockout is one retry away from being free.
    const forms = ["+971506412288", "971506412288", "0506412288", "+971 50 641 2288", " 050 641 2288 "];
    const values = forms.map((f) => normaliseIdentifier(f)?.value);
    expect(new Set(values)).toEqual(new Set(["+971506412288"]));
  });

  it("lowercases an email", () => {
    expect(normaliseIdentifier("  Rashid@Harbour.Example ")).toEqual({
      kind: "email",
      value: "rashid@harbour.example",
    });
  });

  it("refuses what is neither", () => {
    expect(normaliseIdentifier("")).toBeNull();
    expect(normaliseIdentifier("not an identifier")).toBeNull();
    expect(normaliseIdentifier("rashid@")).toBeNull();
    expect(normaliseIdentifier("12345")).toBeNull();
  });
});

describe("maskIdentifier", () => {
  it("shows enough to recognise and not enough to confirm", () => {
    expect(maskIdentifier({ kind: "phone", value: "+971506412288" })).toBe("+971 50 ••• ••88");
  });

  it("keeps the domain, which is how somebody spots the wrong address", () => {
    expect(maskIdentifier({ kind: "email", value: "rashid@harbour.example" })).toBe(
      "ra••••@harbour.example",
    );
  });

  it("never renders the middle digits", () => {
    const masked = maskIdentifier({ kind: "phone", value: "+971506412288" });
    expect(masked).not.toContain("6412");
  });
});
