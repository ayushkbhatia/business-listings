import { describe, expect, it } from "vitest";
import { canonicalSize, sameNominalSize, sizeAliases } from "./nominal-size";

describe("canonicalSize", () => {
  it("reads the metric spellings", () => {
    expect(canonicalSize("DN100")).toBe("DN100");
    expect(canonicalSize("dn 100")).toBe("DN100");
    expect(canonicalSize("dn-100")).toBe("DN100");
    expect(canonicalSize("100")).toBe("DN100");
  });

  it("reads the imperial spellings, including what a phone keyboard types", () => {
    expect(canonicalSize('4"')).toBe("DN100");
    expect(canonicalSize("4 inch")).toBe("DN100");
    expect(canonicalSize("4in")).toBe("DN100");
    expect(canonicalSize("4”")).toBe("DN100");
    expect(canonicalSize('1-1/4"')).toBe("DN32");
    expect(canonicalSize("1/2 inch")).toBe("DN15");
    expect(canonicalSize("half inch")).toBe("DN15");
  });

  it("returns null for a size that is not a nominal bore", () => {
    // These are real sizes on real products. They are not diameters, and a
    // matcher must not pretend otherwise.
    expect(canonicalSize("600 CFM")).toBeNull();
    expect(canonicalSize("35 mm²")).toBeNull();
    expect(canonicalSize("450 x 250 mm")).toBeNull();
    expect(canonicalSize("")).toBeNull();
    expect(canonicalSize(null)).toBeNull();
  });

  it("returns null for a diameter nobody stocks a name for", () => {
    expect(canonicalSize("DN1234")).toBeNull();
  });
});

describe("sameNominalSize", () => {
  it("crosses the metric/imperial line in both directions", () => {
    expect(sameNominalSize("DN100", '4"')).toBe(true);
    expect(sameNominalSize('6"', "DN150")).toBe(true);
  });

  it("is false when the sizes differ", () => {
    expect(sameNominalSize("DN100", "DN150")).toBe(false);
    expect(sameNominalSize("DN600", '4"')).toBe(false);
  });

  it("is false when either side is unreadable, never true", () => {
    // The failure mode this guards is quoting a DN600 line at the DN100 price.
    expect(sameNominalSize("DN100", "600 CFM")).toBe(false);
    expect(sameNominalSize(null, null)).toBe(false);
    expect(sameNominalSize("400 A", "400 A")).toBe(false);
  });
});

describe("sizeAliases", () => {
  it("indexes a nominal bore under every spelling", () => {
    expect(sizeAliases("DN100").sort()).toEqual(["4 inch", '4"', "dn100"]);
    expect(sizeAliases('4"').sort()).toEqual(["4 inch", '4"', "dn100"]);
  });

  it("passes a non-bore size through unchanged", () => {
    expect(sizeAliases("600 CFM")).toEqual(["600 cfm"]);
    expect(sizeAliases(null)).toEqual([]);
  });
});
