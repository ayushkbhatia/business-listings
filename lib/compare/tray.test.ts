import { describe, expect, it } from "vitest";
import {
  COMPARE_MAX,
  EMPTY_TRAY,
  addToTray,
  compareHref,
  idsFromParam,
  parseTray,
  removeFromTray,
  serialiseTray,
  tickState,
  type Tray,
  type TrayItem,
} from "./tray";

/**
 * Board `10d` — the tray's two rules, and the cookie they live in.
 *
 * Four at most (`B7`), refused rather than silently rotated; one trade at a
 * time, so the heading's *genuinely the same fields* is always true. And the
 * cookie is a thing a script can write, so every malformed shape parses to an
 * empty tray rather than an error on a public page.
 */

const id = (n: number) => `cprod${String(n).padStart(20, "0")}`;
const VALVES = { id: "ctradevalves0000000000000", name: "Butterfly valves" };
const PUMPS = { id: "ctradepumps00000000000000", name: "Centrifugal pumps" };
const item = (n: number): TrayItem => ({ id: id(n), name: `Valve ${n}`, seller: `Seller ${n}` });

function trayOf(...ns: number[]): Tray {
  return { trade: VALVES, items: ns.map(item) };
}

describe("B7 — four at most, enforced at add time", () => {
  it("adds up to four and refuses the fifth, leaving the four untouched", () => {
    let tray: Tray = EMPTY_TRAY;
    for (let n = 1; n <= COMPARE_MAX; n += 1) {
      const result = addToTray(tray, item(n), VALVES);
      expect(result.outcome).toBe("added");
      tray = result.tray;
    }
    const fifth = addToTray(tray, item(5), VALVES);
    expect(fifth.outcome).toBe("full");
    expect(fifth.tray).toBe(tray);
    expect(fifth.tray.items.map((held) => held.id)).toEqual([1, 2, 3, 4].map(id));
  });

  it("is idempotent — adding what is held changes nothing", () => {
    const tray = trayOf(1, 2);
    const again = addToTray(tray, item(1), VALVES);
    expect(again.outcome).toBe("already");
    expect(again.tray).toBe(tray);
  });

  it("names the four held when a tick is refused", () => {
    expect(tickState(trayOf(1, 2, 3, 4), id(9), VALVES.id)).toEqual({ kind: "full", held: trayOf(1, 2, 3, 4).items });
  });
});

describe("one comparison, one trade", () => {
  it("starts a fresh comparison for another trade and counts what it cleared", () => {
    const result = addToTray(trayOf(1, 2, 3), item(7), PUMPS);
    expect(result.outcome).toBe("replaced");
    expect(result.dropped).toBe(3);
    expect(result.tray).toEqual({ trade: PUMPS, items: [item(7)] });
  });

  it("decides the trade before the cap, so a full tray does not refuse another trade", () => {
    expect(addToTray(trayOf(1, 2, 3, 4), item(7), PUMPS).outcome).toBe("replaced");
    expect(tickState(trayOf(1, 2, 3, 4), id(7), PUMPS.id)).toEqual({ kind: "switch", heldTrade: VALVES.name, held: 4 });
  });

  it("offers a plain add on an empty tray whatever the trade", () => {
    expect(tickState(EMPTY_TRAY, id(1), PUMPS.id)).toEqual({ kind: "add" });
    expect(tickState(trayOf(1), id(1), VALVES.id)).toEqual({ kind: "in" });
  });
});

describe("removing", () => {
  it("drops one, and empties to the empty tray rather than a tray with no items", () => {
    expect(removeFromTray(trayOf(1, 2), id(1)).items.map((held) => held.id)).toEqual([id(2)]);
    expect(removeFromTray(trayOf(1), id(1))).toBe(EMPTY_TRAY);
  });
});

describe("the cookie", () => {
  it("round-trips a tray", () => {
    const tray = trayOf(1, 2, 3);
    expect(parseTray(serialiseTray(tray))).toEqual(tray);
  });

  it("is JSON, left for the cookie store to encode once", () => {
    // Encoding here as well is what once made the server read a tray the browser could not.
    const value = serialiseTray(trayOf(1));
    expect(JSON.parse(value)).toMatchObject({ trade: VALVES });
    expect(value).not.toMatch(/%7B/i);
  });

  it("parses anything malformed to an empty tray, never an error", () => {
    for (const raw of [
      undefined,
      "",
      "not json",
      "null",
      "[]",
      JSON.stringify({ trade: { id: "x", name: "y" }, items: [] }),
      JSON.stringify({ trade: VALVES, items: [{ id: "nope", name: "a", seller: "b" }] }),
      encodeURIComponent(JSON.stringify(trayOf(1))),
      "%E0%A4%A",
    ]) {
      expect(parseTray(raw)).toEqual(EMPTY_TRAY);
    }
  });

  it("drops duplicates and anything past four, and clips long names", () => {
    const long = "x".repeat(400);
    const raw = JSON.stringify({
      trade: VALVES,
      items: [item(1), item(1), item(2), item(3), item(4), item(5), { id: id(6), name: long, seller: "s" }],
    });
    const tray = parseTray(raw);
    expect(tray.items.map((held) => held.id)).toEqual([1, 2, 3, 4].map(id));
  });

  it("stays small enough to ride on every request", () => {
    const long = "A long product name with a grade and a size in it, DN100 PN16 GGG40 EPDM";
    const tray: Tray = {
      trade: VALVES,
      items: [1, 2, 3, 4].map((n) => ({ id: id(n), name: `${long} ${n}`, seller: `${long} seller` })),
    };
    // Measured as it rides: percent-encoded by the cookie store.
    expect(encodeURIComponent(serialiseTray(tray)).length).toBeLessThan(1600);
  });
});

describe("B10 — the URL carries the set", () => {
  it("reads ids in order, deduplicated, and counts what the cap left out", () => {
    const raw = [1, 2, 2, 3, 4, 5, 6].map(id).join(",");
    expect(idsFromParam(raw)).toEqual({ ids: [1, 2, 3, 4].map(id), overflow: 2 });
  });

  it("never lets a value that is not an id become a lookup", () => {
    expect(idsFromParam("al-waha-industrial,'; DROP TABLE,../../etc")).toEqual({ ids: [], overflow: 0 });
    expect(idsFromParam(undefined)).toEqual({ ids: [], overflow: 0 });
  });

  it("builds the shareable URL in the order chosen", () => {
    expect(compareHref([id(2), id(1)])).toBe(`/compare?p=${id(2)},${id(1)}`);
    expect(compareHref([])).toBe("/compare");
  });
});
