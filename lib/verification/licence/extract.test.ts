import { describe, expect, it } from "vitest";
import { extractLicence, LOW_CONFIDENCE } from "./extract";

const DED = `
GOVERNMENT OF DUBAI
DEPARTMENT OF ECONOMIC DEVELOPMENT
TRADE LICENCE
Licence No. DED-618402
Issue Date  15/04/2019
Expiry Date 14/04/2027
Legal Form: Limited Liability Company
Licence Activities: Air conditioning equipment trading
`;

const iso = (date: Date | null) => date?.toISOString().slice(0, 10) ?? null;

describe("extractLicence", () => {
  it("reads the number and the expiry off a DED licence", () => {
    const result = extractLicence(DED, "DED");
    expect(result.licenceNumber).toBe("DED-618402");
    expect(iso(result.licenceExpiry)).toBe("2027-04-14");
    expect(result.confidence).toBeGreaterThan(LOW_CONFIDENCE);
    expect(result.document).toEqual({ kind: "trade_licence" });
  });

  it("takes the expiry, never the issue date", () => {
    // Both are printed, a line apart. Taking the later of the two would work
    // until a back-dated renewal, so the cue words decide instead.
    expect(iso(extractLicence(DED, "DED").licenceExpiry)).not.toBe("2019-04-15");
  });

  it("reads a day-first date as day-first", () => {
    /*
       `04/05/2027` is the fourth of May here and the fifth of April to an
       American parser. A licence read eleven months wrong is a badge granted or
       withheld for eleven months.
    */
    const result = extractLicence("TRADE LICENCE\nLicence No. DED-1\nExpiry 04/05/2027\n", "DED");
    expect(iso(result.licenceExpiry)).toBe("2027-05-04");
  });

  it("refuses a date that cannot be day-first rather than guessing", () => {
    const result = extractLicence("TRADE LICENCE\nLicence No. DED-1\nExpiry 2027/04/14\n", "DED");
    expect(result.licenceExpiry).toBeNull();
  });

  it("reads a written month", () => {
    const result = extractLicence(
      "TRADE LICENCE\nDepartment of Economic Development\nLicence No. DED-618402\nValid until 14 April 2027\n",
      "DED",
    );
    expect(iso(result.licenceExpiry)).toBe("2027-04-14");
  });

  it("prefers the number beside the label over any other number on the page", () => {
    // A licence carries a TRN, a P.O. box and a phone number. Anchoring on the
    // label is what keeps a fifteen-digit TRN out of a six-digit field.
    const result = extractLicence(
      `TRADE LICENCE
       P.O. Box 118822
       TRN 100123456700003
       Licence No. DED-618402
       Expiry 14/04/2027`,
      "DED",
    );
    expect(result.licenceNumber).toBe("DED-618402");
  });

  it("finds an unlabelled number by its authority prefix", () => {
    const result = extractLicence("TRADE LICENCE\nDED 618402\nEconomic Development\n", "DED");
    expect(result.licenceNumber).toBe("DED-618402");
  });

  it("normalises what it read, so the digits alone become canonical", () => {
    const result = extractLicence("TRADE LICENCE\nLicence Number: 618402\nLegal Form: LLC\n", "SAIF");
    expect(result.licenceNumber).toBe("SAIF-618402");
  });

  it("reports low confidence when it read nothing", () => {
    // Board 2b's "OCR failed" state: empty fields and helper text, never a
    // wrong value pre-filled with confidence.
    const result = extractLicence("scan failed", "DED");
    expect(result.licenceNumber).toBeNull();
    expect(result.licenceExpiry).toBeNull();
    expect(result.confidence).toBeLessThan(LOW_CONFIDENCE);
  });

  it("holds confidence down when the document is the wrong one", () => {
    /*
       A perfectly legible VAT certificate should not hand a claimant two
       confident fields off the wrong paper.
    */
    const result = extractLicence(
      `FEDERAL TAX AUTHORITY
       Tax Registration Certificate
       Licence No. DED-618402
       Expiry 14/04/2027`,
      "DED",
    );
    expect(result.document).toMatchObject({ kind: "other", document: "vat_certificate" });
    expect(result.confidence).toBeLessThan(LOW_CONFIDENCE);
  });

  it("never throws on nothing at all", () => {
    expect(extractLicence(null, "DED").confidence).toBe(0);
    expect(extractLicence("", "DED").licenceNumber).toBeNull();
  });
});
