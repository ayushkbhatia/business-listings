import { describe, expect, it } from "vitest";
import { channelOf, contactLabel, readContact } from "./contact";

/**
 * One box, two channels, and the one that costs money.
 *
 * The expensive half of these tests is the landline: a WhatsApp template is
 * billed per conversation and a landline cannot receive one, so a `04` number
 * accepted here would produce an invitation the seller believes was sent and
 * nobody ever gets. `toE164` normalises a landline perfectly happily, which is
 * why `readContact` checks `kind` rather than trusting the normaliser.
 */

describe("readContact", () => {
  it("sends an address by email, lowercased", () => {
    expect(readContact("  Ops@Falcon.ae ")).toEqual({
      ok: true,
      channel: "email",
      email: "ops@falcon.ae",
      phone: null,
    });
  });

  it("sends a UAE mobile by WhatsApp, in E.164", () => {
    expect(readContact("050 641 2288")).toEqual({
      ok: true,
      channel: "whatsapp",
      email: null,
      phone: "+971506412288",
    });
  });

  it.each([
    ["a local 05x", "0506412288"],
    ["an international 05x", "+971 50 641 2288"],
    ["a 00-prefixed 05x", "00971506412288"],
    ["a hyphenated 05x", "971-50-641-2288"],
  ])("reaches the same number from %s", (_label, input) => {
    expect(readContact(input)).toMatchObject({ channel: "whatsapp", phone: "+971506412288" });
  });

  it("refuses a landline, which no WhatsApp can reach", () => {
    // Normalises cleanly and is still wrong. This is the case the check exists for.
    expect(readContact("04 883 4120")).toEqual({ ok: false, reason: "ambiguous" });
  });

  it("refuses a toll-free number for the same reason", () => {
    expect(readContact("800 82255")).toEqual({ ok: false, reason: "ambiguous" });
  });

  it("refuses a mobile that is short by a digit", () => {
    expect(readContact("05064122")).toEqual({ ok: false, reason: "ambiguous" });
  });

  it.each(["falcon.ae", "ops@falcon", "ops@@falcon.ae", "ops @falcon.ae"])(
    "refuses %s as an address",
    (input) => {
      expect(readContact(input)).toEqual({ ok: false, reason: "ambiguous" });
    },
  );

  it("separates an untouched row from a wrong one", () => {
    // §4: an empty row is a row the seller left alone. Reporting it as an error
    // would put a red line under a field nobody typed in.
    expect(readContact("")).toEqual({ ok: false, reason: "empty" });
    expect(readContact("   ")).toEqual({ ok: false, reason: "empty" });
  });

  it("takes the @ as the whole decision", () => {
    // A string with an @ is never tried as a phone number, so a typo in an
    // address fails as an address rather than being reported as a bad mobile.
    expect(readContact("0506412288@")).toEqual({ ok: false, reason: "ambiguous" });
  });
});

describe("contactLabel and channelOf", () => {
  it("shows whichever contact the invitation holds", () => {
    expect(contactLabel({ email: "ops@falcon.ae", phone: null })).toBe("ops@falcon.ae");
    expect(contactLabel({ email: null, phone: "+971506412288" })).toBe("+971506412288");
  });

  it("reads the channel off the row, not off a stored flag", () => {
    // Derived rather than written, so a row cannot claim a channel it has no
    // address for.
    expect(channelOf({ email: null, phone: "+971506412288" })).toBe("whatsapp");
    expect(channelOf({ email: "ops@falcon.ae", phone: null })).toBe("email");
  });
});
