import { describe, expect, it } from "vitest";
import {
  DEFAULT_TRADE_KIND,
  resolveTradeKind,
  tradeKindOrigin,
  type TradeKindRow,
} from "./trade-kind";

/**
 * The inheritance rule, without a database.
 *
 * The rule is one sentence — a null inherits from the parent — and every
 * service board reads through it, so the ways it can be subtly wrong are worth
 * writing down: an override that loses to its ancestor, a root that answers for
 * a tree it is not in, a cycle that hangs the request.
 */

/** Logistics, which is the sector that proves the split is per subcategory. */
function taxonomy(over: Partial<Record<string, TradeKindRow["tradeKind"]>> = {}) {
  const rows: TradeKindRow[] = [
    { id: "logistics", parentId: null, tradeKind: over["logistics"] ?? null },
    { id: "customs", parentId: "logistics", tradeKind: over["customs"] ?? null },
    { id: "handling", parentId: "logistics", tradeKind: over["handling"] ?? null },
    { id: "forklifts", parentId: "handling", tradeKind: over["forklifts"] ?? null },
  ];
  return new Map(rows.map((row) => [row.id, row]));
}

describe("resolveTradeKind", () => {
  it("takes the category's own value over anything above it", () => {
    const rows = taxonomy({ logistics: "services", handling: "goods" });
    expect(resolveTradeKind(rows, "handling")).toBe("goods");
  });

  it("inherits from the parent when it has none of its own", () => {
    const rows = taxonomy({ logistics: "services" });
    expect(resolveTradeKind(rows, "customs")).toBe("services");
  });

  it("passes an override down to a grandchild", () => {
    // Material handling is goods inside a sector set to services, and forklifts
    // under it inherit the override rather than the sector.
    const rows = taxonomy({ logistics: "services", handling: "goods" });
    expect(resolveTradeKind(rows, "forklifts")).toBe("goods");
  });

  it("keeps two siblings apart, which is the whole reason the column exists", () => {
    /*
       Customs clearance is a service and material handling equipment is a
       product, and they sit under one sector. A sector-level flag would be
       wrong on one of these two whichever way it was set.
    */
    const rows = taxonomy({ customs: "services", handling: "goods" });
    expect(resolveTradeKind(rows, "customs")).toBe("services");
    expect(resolveTradeKind(rows, "handling")).toBe("goods");
  });

  it("falls back to goods when nothing on the chain has been set", () => {
    // The state of all 440 rows the moment the migration lands. The product has
    // to behave exactly as it did the day before.
    expect(resolveTradeKind(taxonomy(), "forklifts")).toBe(DEFAULT_TRADE_KIND);
    expect(DEFAULT_TRADE_KIND).toBe("goods");
  });

  it("falls back for an id the taxonomy does not hold", () => {
    expect(resolveTradeKind(taxonomy({ logistics: "services" }), "nope")).toBe("goods");
  });

  it("stops on a cycle instead of hanging the request", () => {
    // `parentId` is a self-relation with no database constraint against a loop,
    // so the walk is bounded rather than trusting the data.
    const rows = new Map<string, TradeKindRow>([
      ["a", { id: "a", parentId: "b", tradeKind: null }],
      ["b", { id: "b", parentId: "a", tradeKind: null }],
    ]);
    expect(resolveTradeKind(rows, "a")).toBe("goods");
  });
});

describe("tradeKindOrigin", () => {
  it("says own when the row answers for itself", () => {
    expect(tradeKindOrigin(taxonomy({ customs: "services" }), "customs")).toEqual({
      kind: "services",
      from: "own",
    });
  });

  it("names the ancestor an inherited value came from", () => {
    // "from Logistics & freight forwarding" is a reason to leave a row alone.
    // A bare "services" is not, and the ops screen has 440 rows to triage.
    expect(tradeKindOrigin(taxonomy({ logistics: "services" }), "customs")).toEqual({
      kind: "services",
      from: "inherited",
      ancestorId: "logistics",
    });
  });

  it("says default when nobody has decided, which is not the same as goods", () => {
    /*
       The distinction the screen exists to show, and the reason the column has
       no database default: a default would write `goods` into all 440 rows and
       make "decided" and "never opened" indistinguishable forever.
    */
    expect(tradeKindOrigin(taxonomy(), "customs")).toEqual({ kind: "goods", from: "default" });
    expect(tradeKindOrigin(taxonomy({ customs: "goods" }), "customs")).toEqual({
      kind: "goods",
      from: "own",
    });
  });
});
