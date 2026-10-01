import { describe, expect, it } from "vitest";
import { unclaimedRecord, type RecordSource } from "./record";

/**
 * Board 10g's record card, as rows. The handoff's own fixture — Deira Bearing
 * House, DED-118904 — as the importer would have written it: an active licence,
 * a licensed activity, an area, no telephone, nothing provided.
 */
const NOW = new Date("2026-10-01T09:00:00+04:00");

const DEIRA: RecordSource = {
  tradeName: "Deira Bearing House",
  licenceNumber: "DED-118904",
  licenceExpiry: new Date("2027-01-31T00:00:00+04:00"),
  licenceActivity: "Trading in bearings & transmission parts",
  source: "licence_import",
  createdAt: new Date("2026-01-14T10:00:00+04:00"),
  verificationTier: 0,
  verifiedAt: null,
  head: { addressLine: "Deira, Naif", phone: null },
};

const value = (source: RecordSource, key: string, now = NOW) =>
  unclaimedRecord(source, now).rows.find((row) => row.key === key)?.value;

describe("the record card renders what the register holds", () => {
  it("prints the fixture as drawn: the number, Active, Not on record, Not provided", () => {
    const record = unclaimedRecord(DEIRA, NOW);
    const text = record.rows.map((row) => `${row.label}: ${row.value.text}`);

    expect(text).toContain("Trade licence: DED-118904");
    expect(text).toContain("Status on record: Active until 31 Jan 2027 · not verified by us");
    expect(text).toContain("Licensed activity: Trading in bearings & transmission parts");
    expect(text).toContain("Area: Deira, Naif");
    expect(text).toContain("Phone: Not on record");
    expect(text).toContain("Hours, photos, products: Not provided");
  });

  it("keeps the drawn order, with the legal name ahead of the number it pairs with", () => {
    expect(unclaimedRecord(DEIRA, NOW).rows.map((row) => row.key)).toEqual([
      "legal_name",
      "licence",
      "status",
      "activity",
      "area",
      "phone",
      "provided",
    ]);
  });

  it("puts the legal name in the record, verbatim, suffix included — the h1 is the display name", () => {
    expect(value({ ...DEIRA, tradeName: "Deira Bearing House LLC" }, "legal_name")).toEqual({
      state: "present",
      text: "Deira Bearing House LLC",
      tone: "ink",
      mono: false,
    });
  });

  it("sets the licence number in mono", () => {
    expect(value(DEIRA, "licence")).toMatchObject({ state: "present", mono: true });
  });

  it("dates the kicker from the import", () => {
    expect(unclaimedRecord(DEIRA, NOW).imported).toBe("Imported Jan 2026");
  });

  it("drops the kicker for a record that did not come from an import", () => {
    expect(unclaimedRecord({ ...DEIRA, source: "self_added" }, NOW).imported).toBeNull();
  });
});

describe("B3 — an unpopulated field is absent, never empty and never hidden", () => {
  it("marks a missing activity, address and telephone absent under their own labels", () => {
    const thin: RecordSource = { ...DEIRA, licenceActivity: null, head: null };
    for (const key of ["activity", "area", "phone"]) {
      expect(value(thin, key), key).toEqual({ state: "absent", text: "Not on record" });
    }
    // Every row is still there.
    expect(unclaimedRecord(thin, NOW).rows).toHaveLength(7);
  });

  it("treats whitespace as nothing, not as a value", () => {
    expect(value({ ...DEIRA, licenceActivity: "   " }, "activity")).toEqual({
      state: "absent",
      text: "Not on record",
    });
  });

  it("never fills hours, photos or products — B6", () => {
    expect(value(DEIRA, "provided")).toEqual({ state: "absent", text: "Not provided" });
  });
});

describe("B5 — a telephone on record is a presence flag, never the digits", () => {
  it("reads On record and carries no digit", () => {
    const phone = value({ ...DEIRA, head: { addressLine: "Deira, Naif", phone: "04 223 8810" } }, "phone");
    expect(phone).toMatchObject({ state: "present", text: "On record" });
    expect(phone?.text).not.toMatch(/\d/);
  });
});

describe("B4 — the expiry reaches the page", () => {
  it("reads Expired on record, with the date, once the licence has lapsed", () => {
    const lapsed = unclaimedRecord({ ...DEIRA, licenceExpiry: new Date("2026-09-30T00:00:00+04:00") }, NOW);
    expect(lapsed.lapsed).toBe(true);
    expect(lapsed.rows.find((row) => row.key === "status")?.value).toEqual({
      state: "present",
      text: "Expired on record · 30 Sep 2026",
      tone: "bad",
      mono: false,
    });
  });

  it("is not lapsed while the licence is current", () => {
    expect(unclaimedRecord(DEIRA, NOW).lapsed).toBe(false);
  });
});

describe("a licence we checked without a claim", () => {
  /*
     Not the importer's state — it writes tier 0 — but production held 23 on
     1 Oct 2026, and "not verified by us" on one would be the page saying
     something false about our own check.
  */
  const checked: RecordSource = {
    ...DEIRA,
    verificationTier: 2,
    verifiedAt: new Date("2026-06-01T09:00:00+04:00"),
  };

  it("says we checked it, and when", () => {
    const record = unclaimedRecord(checked, NOW);
    expect(record.licenceChecked).toBe(true);
    expect(record.rows.find((row) => row.key === "status")?.value).toEqual({
      state: "present",
      text: "Active until 31 Jan 2027 · licence checked by us 1 Jun 2026",
      tone: "ok",
      mono: false,
    });
  });

  it("says nothing of the kind once the licence has lapsed", () => {
    const lapsed = unclaimedRecord({ ...checked, licenceExpiry: new Date("2026-09-30T00:00:00+04:00") }, NOW);
    expect(lapsed.licenceChecked).toBe(false);
    expect(lapsed.rows.find((row) => row.key === "status")?.value).toMatchObject({ tone: "bad" });
  });

  it("an import is not checked", () => {
    expect(unclaimedRecord(DEIRA, NOW).licenceChecked).toBe(false);
  });
});
