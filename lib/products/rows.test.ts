import { describe, expect, it } from "vitest";
import type { SpecFieldRule } from "@/lib/metrics/spec-completeness";
import {
  isPublishable,
  parsePaste,
  productSlug,
  QUALIFY_RATIO,
  sizeFieldOf,
  specStanding,
  type SheetField,
} from "./rows";

/**
 * The arithmetic three different parts of board 8c depend on.
 *
 * Pure, so it is tested without a database — which matters most for the 60%
 * bar, because that one number decides whether a row a seller can see on their
 * own storefront counts towards the task, and the screen says two different
 * things about the same table because of it.
 */

const NOW = new Date("2026-09-05T00:00:00.000Z");

function rule(id: string, over: Partial<SpecFieldRule> = {}): SpecFieldRule {
  return {
    id,
    key: id,
    required: true,
    isFilterable: true,
    requiredFrom: null,
    ...over,
  };
}

function sheet(id: string, over: Partial<SheetField> = {}): SheetField {
  return { ...rule(id), label: id, unit: null, type: "text", options: [], ...over };
}

describe("what makes a row live", () => {
  it("needs all three of the publishable trio", () => {
    // §4: no publish button. The trio being present is the publish.
    expect(isPublishable({ name: "Gate valve", size: "DN100", availability: "in_stock" })).toBe(
      true,
    );
    expect(isPublishable({ name: "Gate valve", size: "", availability: "in_stock" })).toBe(false);
    expect(isPublishable({ name: "Gate valve", size: "DN100", availability: null })).toBe(false);
    expect(isPublishable({ name: "ab", size: "DN100", availability: "in_stock" })).toBe(false);
  });
});

describe("the 60% bar", () => {
  const three = [rule("a"), rule("b"), rule("c")];

  it("counts a row that clears it and refuses one that does not", () => {
    // Two of three is 67% — thin, and it counts.
    const thin = specStanding({ a: "x", b: "y" }, three, NOW);
    expect(thin.qualifies).toBe(true);
    expect(thin.tone).toBe("thin");

    // One of three is 33%. Live on the storefront, and does not count.
    const short = specStanding({ a: "x" }, three, NOW);
    expect(short.qualifies).toBe(false);
    expect(short.tone).toBe("short");
    expect(short.ratio).toBeLessThan(QUALIFY_RATIO);
  });

  it("calls a full row strong", () => {
    expect(specStanding({ a: "x", b: "y", c: "z" }, three, NOW).tone).toBe("strong");
  });

  it("ignores a field that is required but not filterable", () => {
    /*
       `requiredNow` counts required AND filterable, and this test pins that
       rather than re-deriving it: there were three definitions of "spec
       coverage" in this repo and they disagreed. This is deliberately not a
       fourth.
    */
    const fields = [rule("a"), rule("b", { isFilterable: false })];
    expect(specStanding({ a: "x" }, fields, NOW).ratio).toBe(1);
  });

  it("ignores a field whose requirement has not started", () => {
    const later = rule("b", { requiredFrom: new Date("2027-01-01T00:00:00.000Z") });
    expect(specStanding({ a: "x" }, [rule("a"), later], NOW).ratio).toBe(1);
  });

  it("passes a sheet that requires nothing rather than failing it", () => {
    // A statement about the sheet, not about the product. Inventing a failure
    // here would punish a seller for our gap.
    const standing = specStanding({}, [rule("a", { required: false })], NOW);
    expect(standing.qualifies).toBe(true);
    expect(standing.required).toBe(0);
  });

  it("treats an empty string as unfilled", () => {
    expect(specStanding({ a: "  ", b: "y", c: "z" }, three, NOW).filled).toBe(2);
  });
});

describe("which field the size column is", () => {
  it("prefers the one carrying a unit", () => {
    // On the seeded valve sheet that is `nominal_diameter`, unit DN — there is
    // no field keyed `size` anywhere.
    const fields = [sheet("pressure"), sheet("nominal_diameter", { unit: "DN" })];
    expect(sizeFieldOf(fields)?.id).toBe("nominal_diameter");
  });

  it("falls back to the first required field", () => {
    const fields = [sheet("colour", { required: false }), sheet("bore")];
    expect(sizeFieldOf(fields)?.id).toBe("bore");
  });

  it("returns nothing for a sheet with no fields", () => {
    expect(sizeFieldOf([])).toBeUndefined();
  });
});

describe("a block pasted out of a spreadsheet", () => {
  it("reads tab-separated rows in the table's own column order", () => {
    const rows = parsePaste("Gate valve\tDN100\tIn stock\nBall valve\tDN50\tMade to order", 10);
    expect(rows).toEqual([
      { name: "Gate valve", size: "DN100", availability: "In stock" },
      { name: "Ball valve", size: "DN50", availability: "Made to order" },
    ]);
  });

  it("drops a line with no product name rather than saving it empty", () => {
    // A trailing newline is the commonest thing in a paste.
    expect(parsePaste("Gate valve\tDN100\tIn stock\n\n\t\t\n", 10)).toHaveLength(1);
  });

  it("unwraps the quotes Excel adds around a cell containing a tab", () => {
    const rows = parsePaste('"Valve, 2""\tDN50\tIn stock', 10);
    expect(rows[0]?.name).toBe('Valve, 2"');
  });

  it("stops at the limit it is given, so a paste cannot walk past a plan cap", () => {
    expect(parsePaste("A valve\nB valve\nC valve", 2)).toHaveLength(2);
  });

  it("tolerates carriage returns", () => {
    expect(parsePaste("Gate valve\tDN100\r\nBall valve\tDN50", 10)).toHaveLength(2);
  });
});

describe("slugs", () => {
  it("is url-safe and bounded", () => {
    expect(productSlug('Resilient seated gate valve — DN100, 4"')).toBe(
      "resilient-seated-gate-valve-dn100-4",
    );
    expect(productSlug("x".repeat(200))).toHaveLength(80);
  });

  it("never returns an empty slug", () => {
    // A name of punctuation alone would otherwise produce "", and an empty slug
    // collides with every other empty slug on the same listing.
    expect(productSlug("!!!")).toBe("product");
  });
});
