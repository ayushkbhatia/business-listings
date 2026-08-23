import { describe, expect, it } from "vitest";
import { formatTRN, isValidTRN, maskTRN, normaliseTRN } from "./trn";

const TRN = "100123456783003";

describe("formatTRN", () => {
  it("groups the fifteen digits", () => {
    expect(formatTRN(TRN)).toBe("100 1234 5678 3003");
  });

  it("accepts a TRN a seller pasted with spaces or dashes", () => {
    expect(formatTRN("100 1234 5678 3003")).toBe("100 1234 5678 3003");
    expect(formatTRN("100-1234-5678-3003")).toBe("100 1234 5678 3003");
  });
});

describe("maskTRN", () => {
  it("keeps the first three and the last four", () => {
    expect(maskTRN(TRN)).toBe("100 •••• •••• 3003");
  });

  it("leaks nothing from the middle eight", () => {
    const masked = maskTRN(TRN);
    expect(masked).not.toContain("1234");
    expect(masked).not.toContain("5678");
    expect(masked.replace(/\D/g, "")).toBe("1003003");
  });

  it("sits at the same width as the revealed form", () => {
    expect(maskTRN(TRN)).toHaveLength(formatTRN(TRN).length);
  });

  it("does not echo a malformed TRN back to the screen", () => {
    expect(maskTRN("123")).toBe("••••");
    expect(maskTRN("")).toBe("••••");
  });
});

describe("normaliseTRN and isValidTRN", () => {
  it("accepts exactly fifteen digits", () => {
    expect(normaliseTRN("100 1234 5678 3003")).toBe(TRN);
    expect(isValidTRN(TRN)).toBe(true);
  });

  it("rejects anything shorter or longer", () => {
    expect(isValidTRN("10012345678300")).toBe(false);
    expect(isValidTRN("1001234567830031")).toBe(false);
    expect(normaliseTRN("abc")).toBeNull();
  });
});
