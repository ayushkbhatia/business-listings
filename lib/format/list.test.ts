import { describe, expect, it } from "vitest";
import { formatList } from "./list";

describe("formatList", () => {
  it("joins with the locale's conjunction", () => {
    expect(formatList(["Dubai"])).toBe("Dubai");
    expect(formatList(["Dubai", "Sharjah"])).toBe("Dubai and Sharjah");
    expect(formatList(["Dubai", "Sharjah", "Abu Dhabi"])).toMatch(/^Dubai, Sharjah,? and Abu Dhabi$/);
  });

  it("says nothing for nothing", () => {
    expect(formatList([])).toBe("");
  });
});
