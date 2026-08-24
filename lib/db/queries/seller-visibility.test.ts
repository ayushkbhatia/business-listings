import { describe, expect, it } from "vitest";
import {
  MASKED_BUYER_SELECT,
  RELEASED_BUYER_SELECT,
  buyerForSeller,
  buyerSelectFor,
  firstNameOf,
} from "./seller-visibility";

/**
 * Acceptance criterion 2, at the level it is specified: "proven by a
 * query-layer test, not a template inspection".
 */
const BUYER = {
  fullName: "Rashid Al Hameli",
  phone: "+971506412288",
  email: "rashid@harbour.example",
  buyerCompany: { name: "Harbour Contracting LLC", trn: "100487213600003" },
};

const ME = "biz_me";
const THEM = "biz_them";

describe("before acceptance", () => {
  it("gives a seller a first name and nothing else", () => {
    const view = buyerForSeller(BUYER, null, ME);
    expect(view).toEqual({ released: false, firstName: "Rashid" });
  });

  it("carries no phone, email or company on the returned object at all", () => {
    // Not "undefined" — absent. A field that exists as undefined is a field a
    // careless JSON.stringify or a spread will one day carry.
    const view = buyerForSeller(BUYER, null, ME);
    expect(Object.keys(view).sort()).toEqual(["firstName", "released"]);
    expect(JSON.stringify(view)).not.toContain("971");
    expect(JSON.stringify(view)).not.toContain("@");
    expect(JSON.stringify(view)).not.toContain("Harbour");
  });

  it("selects only the name column, so the data never leaves Postgres", () => {
    expect(buyerSelectFor(null, ME)).toBe(MASKED_BUYER_SELECT);
    expect(Object.keys(MASKED_BUYER_SELECT)).toEqual(["fullName"]);
  });
});

describe("after acceptance, for the accepted seller only", () => {
  it("releases the details to the business named on the enquiry", () => {
    const view = buyerForSeller(BUYER, ME, ME);
    expect(view.released).toBe(true);
    if (!view.released) throw new Error("unreachable");
    expect(view.phone).toBe("+971506412288");
    expect(view.companyName).toBe("Harbour Contracting LLC");
  });

  it("releases nothing to any other recipient of the same enquiry", () => {
    // One enquiry must not become five cold calls. The other four recipients
    // read the same enquiry row and must still see a first name.
    const view = buyerForSeller(BUYER, ME, THEM);
    expect(view).toEqual({ released: false, firstName: "Rashid" });
  });

  it("uses the fuller select only for the accepted business", () => {
    expect(buyerSelectFor(ME, ME)).toBe(RELEASED_BUYER_SELECT);
    expect(buyerSelectFor(ME, THEM)).toBe(MASKED_BUYER_SELECT);
  });
});

describe("firstNameOf", () => {
  it("takes the first token and survives nothing", () => {
    expect(firstNameOf("Rashid Al Hameli")).toBe("Rashid");
    expect(firstNameOf("  Fatima  ")).toBe("Fatima");
    expect(firstNameOf(null)).toBe("");
    expect(firstNameOf("")).toBe("");
  });

  it("never returns a surname, which is how a company gets found", () => {
    expect(firstNameOf("Rashid Al Hameli")).not.toContain("Hameli");
  });
});
