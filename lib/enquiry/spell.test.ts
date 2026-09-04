import { describe, expect, it } from "vitest";
import { spell, spellCapitalised } from "./spell";

describe("counts read as words in an h1", () => {
  it("spells everything the fan-out cap allows", () => {
    expect(spell(1)).toBe("one");
    expect(spell(5)).toBe("five");
    expect(spell(8)).toBe("eight");
  });

  it("capitalises for a sentence that opens with it", () => {
    expect(spellCapitalised(2)).toBe("Two");
  });

  it("falls back to digits past the cap rather than inventing a rule", () => {
    // Nothing can exceed eight recipients, so there is no product need for it.
    expect(spell(12)).toBe("12");
  });
});
