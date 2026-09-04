import { describe, expect, it } from "vitest";
import { classifyDocument } from "./document";

const LICENCE = `
  GOVERNMENT OF DUBAI
  DEPARTMENT OF ECONOMIC DEVELOPMENT
  TRADE LICENCE
  Licence No. DED-618402
  Legal Form: Limited Liability Company
  Licence Activities: Air conditioning equipment trading
`;

describe("classifyDocument", () => {
  it("recognises a trade licence", () => {
    expect(classifyDocument(LICENCE)).toEqual({ kind: "trade_licence" });
  });

  it("recognises a free-zone licence, which does not say DED", () => {
    expect(
      classifyDocument(`
        SHARJAH AIRPORT INTERNATIONAL FREE ZONE
        Free Zone Company Licence
        Licence Activities: General trading
        Legal Status: FZE
      `),
    ).toEqual({ kind: "trade_licence" });
  });

  it("catches a health-authority licence, which also says licence everywhere", () => {
    /*
       The reason this file exists. A DHA professional licence carries the word
       "licence" and an activity, so a check that looked for the word alone would
       pass every one of them.
    */
    expect(
      classifyDocument(`
        DUBAI HEALTH AUTHORITY
        Professional Licence
        Licence Activities: General practitioner
        Legal Form: Individual
      `),
    ).toEqual({ kind: "other", document: "health_authority" });
  });

  it("catches a municipality permit", () => {
    expect(
      classifyDocument(`
        DUBAI MUNICIPALITY
        Food Safety Permit
        Permit No. 44821 valid to 2027
      `),
    ).toEqual({ kind: "other", document: "municipality_permit" });
  });

  it("catches a VAT certificate", () => {
    expect(
      classifyDocument(`
        FEDERAL TAX AUTHORITY
        Tax Registration Certificate
        TRN 100123456700003
      `),
    ).toEqual({ kind: "other", document: "vat_certificate" });
  });

  it("catches an establishment card and an Emirates ID", () => {
    expect(classifyDocument("GENERAL DIRECTORATE OF RESIDENCY\nEstablishment Card\nExpiry 2027")).toMatchObject({
      document: "establishment_card",
    });
    expect(
      classifyDocument("UNITED ARAB EMIRATES\nEmirates ID\nNationality: India\nDate of birth 1981"),
    ).toMatchObject({ document: "passport_or_id" });
  });

  it("says nothing when there is nothing to read", () => {
    // Never a wrong verdict from an empty extraction. A scan that produced no
    // text is a failure of the reader, not evidence about the document.
    expect(classifyDocument("")).toEqual({ kind: "unknown" });
    expect(classifyDocument(null)).toEqual({ kind: "unknown" });
    expect(classifyDocument("Licence")).toEqual({ kind: "unknown" });
  });

  it("says nothing for text that matches neither side", () => {
    expect(
      classifyDocument("Invoice 4482 — thank you for your business. Payment due in thirty days."),
    ).toEqual({ kind: "unknown" });
  });
});
