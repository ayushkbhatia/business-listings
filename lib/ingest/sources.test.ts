import { describe, expect, it } from "vitest";
import { Authority } from "@/lib/db/generated/enums";
import { EMIRATES } from "@/lib/uae";
import { AUTHORITY_EMIRATE, coverageByEmirate } from "./sources";

/**
 * Board 12a B10 — the sources panel is the coverage map for supply, and must
 * not hide an empty row.
 */

const SEVEN = EMIRATES.map((emirate) => emirate.value);

describe("where each authority licenses", () => {
  it("places every authority the schema knows, so a new free zone cannot vanish from the panel", () => {
    expect(Object.keys(AUTHORITY_EMIRATE).sort()).toEqual(Object.values(Authority).sort());
  });
});

describe("coverage by emirate", () => {
  it("lists all seven emirates when nothing has been imported", () => {
    const rows = coverageByEmirate(SEVEN, []);
    expect(rows.map((row) => row.emirate)).toEqual(SEVEN);
    for (const row of rows) {
      expect(row.imported).toEqual([]);
      expect(row.lastRunAt).toBeNull();
      expect(row.authorities.length).toBeGreaterThan(0);
    }
  });

  it("puts the emirate's own department first", () => {
    const dubai = coverageByEmirate(SEVEN, []).find((row) => row.emirate === "dubai")!;
    expect(dubai.authorities[0]).toBe("DED");
  });

  it("dates an emirate by its latest run from any of its authorities", () => {
    const rows = coverageByEmirate(SEVEN, [
      { source: "DED", createdAt: new Date("2026-08-01") },
      { source: "jafza", createdAt: new Date("2026-09-01") },
      { source: "DED", createdAt: new Date("2026-07-01") },
    ]);
    const dubai = rows.find((row) => row.emirate === "dubai")!;
    expect(dubai.imported.sort()).toEqual(["DED", "JAFZA"]);
    expect(dubai.lastSource).toBe("JAFZA");
    expect(dubai.lastRunAt?.toISOString().slice(0, 10)).toBe("2026-09-01");
    expect(rows.find((row) => row.emirate === "fujairah")!.imported).toEqual([]);
  });

  it("ignores a source that is not an authority", () => {
    const rows = coverageByEmirate(SEVEN, [{ source: "somewhere", createdAt: new Date() }]);
    expect(rows.every((row) => row.imported.length === 0)).toBe(true);
  });
});
