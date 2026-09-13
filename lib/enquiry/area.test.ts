import { describe, expect, it } from "vitest";
import { areaKey, resolveEnquiryArea, type AreaRow } from "./area";

/**
 * `resolveEnquiryArea` — and most of these cases assert that it gives up.
 *
 * The id it produces is what lets a seller covering only Al Quoz be matched to
 * an enquiry, so a wrong resolve is not a cosmetic error: it sends a job to
 * somebody who does not work there and hides it from somebody who does. Every
 * case below that returns null is a case where filling the column in would
 * have been the platform inventing a delivery address.
 */

const AREAS: AreaRow[] = [
  { id: "quoz1", name: "Al Quoz 1", emirate: "dubai" },
  { id: "quoz3", name: "Al Quoz Industrial Area 3", emirate: "dubai" },
  { id: "jebel", name: "Jebel Ali", emirate: "dubai" },
  { id: "ind1-shj", name: "Industrial Area 1", emirate: "sharjah" },
  { id: "ind1-ajm", name: "Industrial Area 1", emirate: "ajman" },
  { id: "mussafah", name: "Mussafah", emirate: "abu_dhabi" },
];

describe("what it matches", () => {
  it("takes an exact name in the stated emirate", () => {
    expect(resolveEnquiryArea("Al Quoz 1", "dubai", AREAS)).toBe("quoz1");
  });

  it("ignores case and surrounding space, which are noise", () => {
    expect(resolveEnquiryArea("  al quoz 1 ", "dubai", AREAS)).toBe("quoz1");
    expect(resolveEnquiryArea("JEBEL ALI", "dubai", AREAS)).toBe("jebel");
  });

  it("collapses inner runs of space, which are a typing artefact", () => {
    expect(resolveEnquiryArea("Al  Quoz   1", "dubai", AREAS)).toBe("quoz1");
    expect(areaKey("Al  Quoz   1")).toBe("al quoz 1");
  });

  it("resolves an unambiguous name with no emirate stated", () => {
    expect(resolveEnquiryArea("Mussafah", null, AREAS)).toBe("mussafah");
  });
});

describe("what it refuses, and why each one matters", () => {
  it("refuses a prefix — two different places share one", () => {
    /*
       "Al Quoz" is the prefix of both `Al Quoz 1` and
       `Al Quoz Industrial Area 3`, which are different places. A prefix match
       would pick whichever came back first.
    */
    expect(resolveEnquiryArea("Al Quoz", "dubai", AREAS)).toBeNull();
  });

  it("refuses a name that is ambiguous across emirates when none is stated", () => {
    // Sharjah's and Ajman's. Picking one is a coin toss recorded as a fact.
    expect(resolveEnquiryArea("Industrial Area 1", null, AREAS)).toBeNull();
  });

  it("resolves that same name once the buyer says which emirate", () => {
    expect(resolveEnquiryArea("Industrial Area 1", "sharjah", AREAS)).toBe("ind1-shj");
    expect(resolveEnquiryArea("Industrial Area 1", "ajman", AREAS)).toBe("ind1-ajm");
  });

  it("never reaches outside the stated emirate", () => {
    /*
       The buyer said Dubai. Mussafah is in Abu Dhabi. Reading their answer and
       then ignoring it is worse than not resolving at all.
    */
    expect(resolveEnquiryArea("Mussafah", "dubai", AREAS)).toBeNull();
  });

  it("refuses free text that describes a place the taxonomy does not hold", () => {
    expect(resolveEnquiryArea("near the Dragon Mart roundabout", "dubai", AREAS)).toBeNull();
    expect(resolveEnquiryArea("site office, gate 4", "dubai", AREAS)).toBeNull();
  });

  it("treats nothing, empty and whitespace as nothing", () => {
    expect(resolveEnquiryArea(null, "dubai", AREAS)).toBeNull();
    expect(resolveEnquiryArea(undefined, "dubai", AREAS)).toBeNull();
    expect(resolveEnquiryArea("", "dubai", AREAS)).toBeNull();
    expect(resolveEnquiryArea("   ", "dubai", AREAS)).toBeNull();
  });

  it("answers null against an empty taxonomy rather than throwing", () => {
    expect(resolveEnquiryArea("Al Quoz 1", "dubai", [])).toBeNull();
  });
});
