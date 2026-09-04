import { describe, expect, it } from "vitest";
import { normaliseLicenceNumber, sameLicenceNumber } from "./number";

/**
 * The four spellings of one licence number, and the one thing that is not a
 * spelling.
 */
describe("normaliseLicenceNumber", () => {
  it("accepts the canonical form unchanged", () => {
    expect(normaliseLicenceNumber("DED-618402", "DED")).toEqual({
      ok: true,
      value: "DED-618402",
      hadPrefix: true,
    });
  });

  it("adds the prefix when a person typed only the digits", () => {
    // What somebody reading a licence off a wall actually types.
    expect(normaliseLicenceNumber("618402", "DED")).toEqual({
      ok: true,
      value: "DED-618402",
      hadPrefix: false,
    });
  });

  it("takes a space, an en dash, a slash or an underscore as the separator", () => {
    for (const written of ["DED 618402", "DED–618402", "DED—618402", "DED/618402", "DED_618402"]) {
      expect(normaliseLicenceNumber(written, "DED")).toMatchObject({ value: "DED-618402" });
    }
  });

  it("is case-insensitive, because a PRO pastes lowercase", () => {
    expect(normaliseLicenceNumber("ded-618402", "DED")).toMatchObject({ value: "DED-618402" });
  });

  it("strips separators inside the digits, which OCR inserts", () => {
    expect(normaliseLicenceNumber("DED-618 402", "DED")).toMatchObject({ value: "DED-618402" });
  });

  it("works for a free-zone authority the same way", () => {
    expect(normaliseLicenceNumber("20118", "SAIF")).toMatchObject({ value: "SAIF-20118" });
  });

  it("refuses a prefix naming a different authority, and says which", () => {
    /*
       Not a typo. A Sharjah number submitted against a Dubai listing is a claim
       about a different licence, and rewriting the prefix to match would erase
       the disagreement a reviewer needs to see.
    */
    expect(normaliseLicenceNumber("SHJ-618402", "DED")).toEqual({
      ok: false,
      reason: "wrong_authority",
      found: "SHJ",
    });
  });

  it("refuses text with no digits in it", () => {
    expect(normaliseLicenceNumber("trade licence", "DED")).toMatchObject({ reason: "no_digits" });
    expect(normaliseLicenceNumber("DED-", "DED")).toMatchObject({ reason: "no_digits" });
  });

  it("refuses an empty field", () => {
    expect(normaliseLicenceNumber("   ", "DED")).toEqual({ ok: false, reason: "empty" });
  });
});

describe("sameLicenceNumber", () => {
  it("does not count adding the prefix as a correction", () => {
    // A correction should mean a correction. Somebody who typed the digits
    // against a stored `DED-618402` has corrected nothing.
    expect(sameLicenceNumber("618402", "DED-618402", "DED")).toBe(true);
    expect(sameLicenceNumber("DED 618402", "ded-618402", "DED")).toBe(true);
  });

  it("counts a different number as a correction", () => {
    expect(sameLicenceNumber("618402", "618403", "DED")).toBe(false);
  });

  it("is false where either side is unreadable", () => {
    expect(sameLicenceNumber("", "DED-618402", "DED")).toBe(false);
    expect(sameLicenceNumber("SHJ-618402", "DED-618402", "DED")).toBe(false);
  });
});
