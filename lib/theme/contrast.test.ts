import { describe, expect, it } from "vitest";
import { CONTRAST_FLOOR, contrastRatio } from "./contrast";

describe("the maths", () => {
  it("agrees with the two ends everybody knows", () => {
    expect(contrastRatio("#000000", "#FFFFFF")).toBeCloseTo(21, 2);
    expect(contrastRatio("#FFFFFF", "#FFFFFF")).toBeCloseTo(1, 5);
  });

  it("does not care which way round the pair is given", () => {
    expect(contrastRatio("#46584A", "#FFFFFF")).toBeCloseTo(
      contrastRatio("#FFFFFF", "#46584A"),
      10,
    );
  });
});

describe("the storefront palette", () => {
  it("clears the floor on the page it is painted on", () => {
    /*
     * `--brand` paints headings, links and button labels on `--paper`. It is the
     * one storefront colour left, and it has to pass the same rule every other
     * text colour does. Measured against the literal values, because naming the
     * colour is the only way a contrast test can say what it measured.
     */
    expect(contrastRatio("#46584A", "#FAF9F6")).toBeGreaterThanOrEqual(CONTRAST_FLOOR);
  });
});
