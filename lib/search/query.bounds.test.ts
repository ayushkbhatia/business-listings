import { describe, expect, it } from "vitest";
import { formatBounds, parseBounds, parseSearchQuery, toSearchParams } from "./query";

/**
 * The map viewport's round trip through the URL.
 *
 * Board 1c requires a pasted link to reproduce the result set *and* the
 * viewport, so this is not a formatting detail — it is criterion 6 and the
 * shareability section, both of which are false if the box does not survive.
 */

const BOX = { west: 55.1, south: 25.0, east: 55.4, north: 25.3 };

describe("bounds in the query string", () => {
  it("survives a round trip", () => {
    const written = toSearchParams(parseSearchQuery({ q: "valve" }), { bounds: BOX });
    const read = parseSearchQuery(Object.fromEntries(new URLSearchParams(written)));
    expect(read.bounds).toEqual(BOX);
  });

  it("is read whole, not comma-split into a facet", () => {
    /*
     * The bug this test exists for. Every other multi-value parameter is split
     * on commas, and reading bounds the same way yields a box with one number
     * in it — which `parseBounds` correctly rejects, so the viewport silently
     * stopped applying while the URL still carried it.
     */
    const read = parseSearchQuery({ bounds: formatBounds(BOX) });
    expect(read.bounds).toEqual(BOX);
  });

  it("does not land in the spec bucket", () => {
    // An unreserved key becomes a spec facet keyed by a SpecField id. `bounds`
    // is reserved precisely so it cannot become a filter on a field that does
    // not exist.
    expect(parseSearchQuery({ bounds: formatBounds(BOX) }).spec).toEqual({});
  });

  it("rejects a box that is inverted, degenerate or off the globe", () => {
    // Any of these selects everything or nothing depending on which side of a
    // comparison it lands, and neither is what the buyer drew.
    expect(parseBounds("55.4,25.0,55.1,25.3")).toBeUndefined(); // west past east
    expect(parseBounds("55.1,25.3,55.4,25.0")).toBeUndefined(); // south past north
    expect(parseBounds("55.1,25.0,55.1,25.3")).toBeUndefined(); // zero width
    expect(parseBounds("-200,25.0,55.4,25.3")).toBeUndefined(); // off the globe
    expect(parseBounds("55.1,25.0,55.4")).toBeUndefined(); // three numbers
    expect(parseBounds("a,b,c,d")).toBeUndefined();
    expect(parseBounds(undefined)).toBeUndefined();
  });

  it("stays out of the URL when unset", () => {
    // Same rule as sort and view: a default in the query string makes an
    // unfiltered page's canonical differ from the page itself.
    expect(toSearchParams(parseSearchQuery({ q: "valve" }))).not.toContain("bounds");
  });
});
