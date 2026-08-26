import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  CONTRAST_FLOOR,
  PAPER,
  checkBrandHex,
  contrastRatio,
  isThemePreset,
  THEME_PRESETS,
} from "./contrast";

/**
 * Criterion 5: *"a custom brand hex below 4.5:1 against white is rejected with
 * the reason shown."* The reason is the part that matters — a refusal with no
 * number is a refusal somebody argues with.
 */

describe("what a brand colour is measured against", () => {
  it("is the paper token, not a colour this file invented", () => {
    /*
     * `PAPER` is the one literal colour in `lib/`, and it is arithmetic rather
     * than styling. This is what stops it drifting away from the background it
     * claims to represent.
     */
    // From the project root: vitest runs with cwd there, and `import.meta.url`
    // is a vite id rather than a file URL under the jsdom environment.
    const css = readFileSync(join(process.cwd(), "docs/tokens.css"), "utf8");
    const token = /--paper:\s*(#[0-9A-Fa-f]{6})/.exec(css);
    expect(token, "docs/tokens.css has no --paper").not.toBeNull();
    expect(PAPER.toUpperCase()).toBe(token![1]!.toUpperCase());
  });

  it("is stricter than the criterion's white, not looser", () => {
    // Criterion 5 says "against white". Paper is slightly darker, so anything
    // that clears the floor on paper clears it on white.
    const borderline = "#767676";
    expect(contrastRatio(borderline, PAPER)).toBeLessThan(
      contrastRatio(borderline, "#FFFFFF"),
    );
  });
});

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

describe("a seller's own brand colour", () => {
  it("takes the six preset brand colours, which is the floor working", () => {
    // Every shipped preset must pass its own rule, or the rule is wrong.
    for (const hex of ["#46584A", "#2F4A5C", "#7A4A2F", "#1F1F1F", "#3D5A3A", "#5C3B52"]) {
      const check = checkBrandHex(hex);
      expect(check.ok, `${hex} at ${check.ratio}`).toBe(true);
    }
  });

  it("refuses a colour that would be illegible on paper, and says the number", () => {
    const check = checkBrandHex("#FFD400");
    expect(check.ok).toBe(false);
    expect(check.reason).toBe("below_floor");
    expect(check.ratio).toBeLessThan(CONTRAST_FLOOR);
    // Rounded, because the message shows it.
    expect(String(check.ratio)).toMatch(/^\d+(\.\d{1,2})?$/);
  });

  it("refuses three-digit hex rather than expanding it", () => {
    /*
     * `#c00` and `#cc0000` are the same colour. A field that silently rewrites
     * what somebody typed is a field that will one day rewrite it wrong, and a
     * brand colour is something the seller has written down in six digits
     * somewhere already.
     */
    expect(checkBrandHex("#c00")).toMatchObject({ ok: false, reason: "not_a_hex" });
  });

  it("refuses anything that is not a hex at all", () => {
    for (const input of ["", "red", "rgb(0,0,0)", "#12345", "#1234567", "123456"]) {
      expect(checkBrandHex(input), input).toMatchObject({ ok: false, reason: "not_a_hex" });
    }
  });

  it("trims, because a pasted colour carries whitespace", () => {
    expect(checkBrandHex("  #46584A  ").ok).toBe(true);
  });
});

describe("the preset list", () => {
  it("is the six the tokens define", () => {
    expect([...THEME_PRESETS].sort()).toEqual([
      "clinic",
      "default",
      "industrial",
      "mono",
      "salon",
      "trade",
    ]);
  });

  it("refuses a theme nobody wrote tokens for", () => {
    expect(isThemePreset("industrial")).toBe(true);
    expect(isThemePreset("neon")).toBe(false);
  });
});
