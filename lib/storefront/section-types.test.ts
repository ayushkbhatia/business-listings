import { describe, expect, it } from "vitest";
import {
  BUILDABLE_SECTION_TYPES,
  isPublishableDocumentKind,
  PUBLISHABLE_DOCUMENT_KINDS,
  SECTION_TYPES,
  sectionType,
  sellerFieldKeys,
} from "./section-types";

/**
 * Board 5c, and two of step 6's acceptance criteria in the pure.
 */

describe("the catalogue", () => {
  it("has eighteen buildable types and one held for a decision", () => {
    /*
       Criterion 10 kept a visible gap for services. Board `5c-s` fills it with
       four live services sections and keeps the gap for the one it cannot
       build yet — process steps, held on Q1.
    */
    expect(BUILDABLE_SECTION_TYPES).toHaveLength(18);
    expect(SECTION_TYPES).toHaveLength(19);
    expect(SECTION_TYPES.filter((type) => type.heldKey).map((type) => type.key)).toEqual(["process_steps"]);
    expect(sectionType("services")).toBeUndefined();
  });

  it("offers five sections only for firms that sell work — 5c-s", () => {
    const services = SECTION_TYPES.filter((type) => type.availableFor === "services").map((type) => type.key);
    expect(services).toEqual(["scope_grid", "credential_wall", "coverage", "sectors_served", "process_steps"]);
  });

  it("gives every kind-limited type a reason line — B1", () => {
    // A disabled card with no reason is the support ticket the line exists to prevent.
    for (const type of SECTION_TYPES) {
      if (type.availableFor === "both") expect(type.unavailableKey, type.key).toBeNull();
      else expect(type.unavailableKey, type.key).toMatch(/^section\.unavailable\./);
    }
  });

  it("names nothing a map — B7", () => {
    /*
       The render's *Coverage map* would have put the map `2d-s` and `1f-s` B2
       removed back through a builder section. The goods branches section keeps
       its map; the services coverage section may not imply one.
    */
    expect(sectionType("coverage")!.labelKey).toBe("section.coverage");
    expect(sectionType("coverage")!.sellerFields).toEqual([]);
  });

  it("keeps every services section a view: no free-text field on any of them — B2, B4", () => {
    for (const type of SECTION_TYPES.filter((candidate) => candidate.availableFor === "services")) {
      for (const field of type.sellerFields) {
        expect(["line", "text"], `${type.key}.${field.key}`).not.toContain(field.type);
      }
    }
  });

  it("marks the header fixed and nothing else", () => {
    // Criterion 6. The footer is not here at all: it is platform chrome and
    // has no row, which is a stronger guarantee than a flag on one.
    const fixed = SECTION_TYPES.filter((type) => type.fixed).map((type) => type.key);
    expect(fixed).toEqual(["header"]);
  });

  it("keeps the derived sections out of seller hands", () => {
    /*
     * A seller-editable trust signal is not a trust signal. Response time is
     * measured and never claimed — non-negotiable 6 — and the same reasoning
     * covers the reviews and branches sections.
     */
    for (const key of ["trust_strip", "reviews", "branches", "header", "credential_wall", "coverage", "sectors_served"]) {
      expect(sellerFieldKeys(key), key).toEqual([]);
    }
  });

  it("has no price field anywhere in it", () => {
    /*
     * Non-negotiable 1. A section catalogue is exactly where somebody adds a
     * price by accident — "from AED 40 a metre" on a hero is one field away.
     */
    const priceish = /price|aed|cost|discount|rate|amount|fee|percent|%|off\b/i;
    for (const type of SECTION_TYPES) {
      for (const field of type.sellerFields) {
        expect(field.key, `${type.key}.${field.key}`).not.toMatch(priceish);
      }
    }
  });

  it("calls the offer banner's string a reference, not a code", () => {
    // A redeemable discount code is a price mechanism on a public surface. An
    // opaque string a buyer quotes inside an enquiry is a marketing string.
    const keys = sellerFieldKeys("offer_banner");
    expect(keys).toContain("reference");
    expect(keys).not.toContain("code");
  });

  it("names each type's source, so the library card can say where it reads from", () => {
    for (const type of SECTION_TYPES) {
      expect(type.sourceKey, type.key).toMatch(/^section\.source\./);
    }
  });

  it("has unique keys", () => {
    const keys = SECTION_TYPES.map((type) => type.key);
    expect(new Set(keys).size).toBe(keys.length);
  });
});

describe("what a public section may show from the document store", () => {
  it("never a trade licence or a VAT certificate", () => {
    /*
     * `verify_listing.documents_hint` tells the seller, on the upload screen:
     * "They are never on your public listing and never linked from it." Both
     * kinds live in the same private bucket as a datasheet, separated only by
     * an enum the seller picks.
     */
    expect(isPublishableDocumentKind("trade_licence")).toBe(false);
    expect(isPublishableDocumentKind("vat_certificate")).toBe(false);
    expect(isPublishableDocumentKind("enquiry_attachment")).toBe(false);
  });

  it("allows the three a seller would want on a storefront", () => {
    expect([...PUBLISHABLE_DOCUMENT_KINDS].sort()).toEqual([
      "catalogue",
      "certificate",
      "datasheet",
    ]);
  });
});
