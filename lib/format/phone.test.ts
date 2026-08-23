import { describe, expect, it } from "vitest";
import { formatPhone, maskPhone, parseUaePhone, toE164 } from "./phone";

describe("formatPhone", () => {
  it("renders the two forms the design system specifies", () => {
    expect(formatPhone("048834120")).toBe("04 883 4120");
    expect(formatPhone("0506412288")).toBe("+971 50 641 2288");
  });

  it("normalises every way a seller might have typed the same number", () => {
    for (const input of [
      "048834120",
      "04 883 4120",
      "04-883-4120",
      "+971 4 883 4120",
      "+97148834120",
      "00971 4 883 4120",
      "971-4-8834120",
      "(04) 883 4120",
    ]) {
      expect(formatPhone(input)).toBe("04 883 4120");
    }
  });

  it("renders a mobile the same from any input form", () => {
    for (const input of ["0506412288", "+971506412288", "00971 50 641 2288", "971 50 641 2288"]) {
      expect(formatPhone(input)).toBe("+971 50 641 2288");
    }
  });

  it("honours an explicit style", () => {
    expect(formatPhone("048834120", { style: "international" })).toBe("+971 4 883 4120");
    expect(formatPhone("0506412288", { style: "local" })).toBe("050 641 2288");
  });

  it("groups a toll-free number without a country code", () => {
    expect(formatPhone("80082255")).toBe("800 82255");
  });

  it("hands back unrecognisable input untouched rather than mangling it", () => {
    expect(formatPhone("ext 4120")).toBe("ext 4120");
  });
});

describe("maskPhone", () => {
  it("renders the masked form the design system specifies", () => {
    expect(maskPhone("048834120")).toBe("04 88• ••••");
  });

  it("masks a mobile to the same depth", () => {
    expect(maskPhone("0506412288")).toBe("+971 50 64• ••••");
  });

  it("keeps the area code so a buyer can still place the emirate", () => {
    expect(maskPhone("068834120").startsWith("06")).toBe(true);
    expect(maskPhone("048834120").startsWith("04")).toBe(true);
  });

  it("leaks no digit beyond the first two of the subscriber part", () => {
    const masked = maskPhone("048834120");
    expect(masked).not.toContain("3412");
    expect(masked.replace(/\D/g, "")).toBe("0488");
  });

  it("keeps the same width as the revealed number so a table does not reflow", () => {
    expect(maskPhone("048834120")).toHaveLength(formatPhone("048834120").length);
    expect(maskPhone("0506412288")).toHaveLength(formatPhone("0506412288").length);
  });

  it("degrades to a bare mask rather than echoing junk input", () => {
    expect(maskPhone("nonsense")).toBe("••••");
  });
});

describe("toE164", () => {
  it("produces the storage and WhatsApp form", () => {
    expect(toE164("0506412288")).toBe("+971506412288");
    expect(toE164("04 883 4120")).toBe("+97148834120");
  });

  it("returns null when it cannot be sure", () => {
    expect(toE164("ext 4120")).toBeNull();
    expect(toE164("")).toBeNull();
  });
});

describe("parseUaePhone", () => {
  it("classifies the number so callers do not have to", () => {
    expect(parseUaePhone("0506412288")?.kind).toBe("mobile");
    expect(parseUaePhone("048834120")?.kind).toBe("landline");
    expect(parseUaePhone("80082255")?.kind).toBe("tollfree");
    expect(parseUaePhone("")).toBeNull();
  });
});
