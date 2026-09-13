import { describe, expect, it } from "vitest";
import type { TradeKindRow } from "@/lib/taxonomy/trade-kind";
import {
  addableTypes,
  isAvailable,
  refusedCount,
  rendersFor,
  scopeOf,
  sectionLibrary,
  templateScope,
} from "./library";
import { sectionType } from "./section-types";

/**
 * Board `5c-s` in the pure: the library filtered by trade kind.
 *
 * Acceptance criteria 1, 2 and 9 are statements about `sectionLibrary`, and the
 * public half of B7 — each storefront shows the sections it can fill — is a
 * statement about `rendersFor`.
 */

const keys = (group: { entries: { type: { key: string } }[] } | undefined) =>
  (group?.entries ?? []).map((entry) => entry.type.key);

describe("which library a template gets — criterion 1", () => {
  const taxonomy = new Map<string, TradeKindRow>(
    [
      { id: "legal", parentId: null, tradeKind: "services" },
      { id: "legal-audit", parentId: "legal", tradeKind: null },
      { id: "legal-setup", parentId: "legal", tradeKind: null },
      { id: "valves", parentId: null, tradeKind: "goods" },
      { id: "valves-gate", parentId: "valves", tradeKind: null },
      // A services leaf under a goods sector — `4d-s` classified 169 of these.
      { id: "valves-inspection", parentId: "valves", tradeKind: "services" },
      { id: "pipes", parentId: null, tradeKind: "goods" },
      { id: "pipes-hdpe", parentId: "pipes", tradeKind: null },
      { id: "lonely", parentId: null, tradeKind: "services" },
    ].map((row) => [row.id, row as TradeKindRow]),
  );

  it("reads the leaves, not the sector's own value", () => {
    expect(templateScope(taxonomy, "legal", [])).toBe("services");
    expect(templateScope(taxonomy, "pipes", [])).toBe("goods");
    // Goods sector, one services leaf: its stores can sell either.
    expect(templateScope(taxonomy, "valves", [])).toBe("both");
  });

  it("lets a sector with no children answer for itself", () => {
    expect(templateScope(taxonomy, "lonely", [])).toBe("services");
  });

  it("widens to what the published stores have said they sell", () => {
    // A firm that sells work, filed under a goods trade, is still a storefront this template governs.
    expect(templateScope(taxonomy, "pipes", ["goods", "services"])).toBe("both");
    expect(templateScope(taxonomy, "legal", ["both"])).toBe("both");
    // `unset` says nothing and counts for nothing.
    expect(templateScope(taxonomy, "legal", ["unset"])).toBe("services");
  });

  it("survives a parent cycle rather than looping", () => {
    const cyclic = new Map<string, TradeKindRow>([
      ["a", { id: "a", parentId: "b", tradeKind: "goods" }],
      ["b", { id: "b", parentId: "a", tradeKind: null }],
    ]);
    expect(["goods", "services", "both"]).toContain(templateScope(cyclic, "a", []));
  });

  it("unions kinds, and treats nothing as goods", () => {
    expect(scopeOf([])).toBe("goods");
    expect(scopeOf(["services", "services"])).toBe("services");
    expect(scopeOf(["goods", "services"])).toBe("both");
    expect(scopeOf(["both"])).toBe("both");
  });
});

describe("the services library — criteria 2 and 9", () => {
  it("groups as the board draws it: for service listings, shared, unavailable here", () => {
    const groups = sectionLibrary("services", []);
    expect(groups.map((group) => group.key)).toEqual(["services", "shared", "unavailable"]);
    expect(keys(groups[0])).toEqual(["scope_grid", "credential_wall", "coverage", "sectors_served", "process_steps"]);
    expect(keys(groups[1])).toEqual(expect.arrayContaining(["hero", "reviews", "enquiry_form"]));
  });

  it("lists the goods sections as unavailable, each with its reason — never hidden (B1)", () => {
    const unavailable = sectionLibrary("services", []).find((group) => group.key === "unavailable")!;
    expect(keys(unavailable)).toEqual(
      expect.arrayContaining(["featured_products", "catalogue_grid", "spec_comparison", "branches"]),
    );
    for (const entry of unavailable.entries) {
      expect(entry.state).toBe("unavailable");
      expect(entry.reasonKey, entry.type.key).toMatch(/^section\.unavailable\./);
    }
    expect(unavailable.entries.find((entry) => entry.type.key === "branches")!.reasonKey).toBe(
      "section.unavailable.branches",
    );
  });

  it("lists process steps held, in its own group, with the decision it waits on (B3)", () => {
    const entry = sectionLibrary("services", [])[0]!.entries.find((e) => e.type.key === "process_steps")!;
    expect(entry.state).toBe("held");
    expect(entry.reasonKey).toBe("section.held.process_steps");
  });

  it("does not list the header, which is chrome and not a choice", () => {
    const all = sectionLibrary("services", []).flatMap((group) => group.entries);
    expect(all.some((entry) => entry.type.key === "header")).toBe(false);
  });

  it("marks what the template already carries", () => {
    const groups = sectionLibrary("services", [{ type: "scope_grid" }, { type: "branches" }]);
    const all = groups.flatMap((group) => group.entries);
    expect(all.find((entry) => entry.type.key === "scope_grid")!.state).toBe("in_use");
    // On the template and unavailable here — both facts are kept.
    const branches = all.find((entry) => entry.type.key === "branches")!;
    expect(branches.state).toBe("unavailable");
    expect(branches.inUse).toBe(true);
  });

  it("gives a template that sells both both sets, labelled, neither unavailable (B9)", () => {
    const groups = sectionLibrary("both", []);
    expect(groups.map((group) => group.key)).toEqual(["goods", "services", "shared"]);
    expect(groups.flatMap((group) => group.entries).some((entry) => entry.state === "unavailable")).toBe(false);
  });

  it("mirrors for a goods template: scope grid and its siblings unavailable with their reasons", () => {
    const groups = sectionLibrary("goods", []);
    expect(groups.map((group) => group.key)).toEqual(["goods", "shared", "unavailable"]);
    expect(keys(groups[2])).toEqual(["scope_grid", "credential_wall", "coverage", "sectors_served", "process_steps"]);
  });

  it("offers the builder only what it can add, and counts what it cannot", () => {
    const addable = addableTypes("services", [{ type: "hero" }, { type: "team" }]).map((type) => type.key);
    expect(addable).toContain("scope_grid");
    expect(addable).not.toContain("hero"); // singleton, present
    expect(addable).toContain("team"); // repeatable, present
    expect(addable).not.toContain("process_steps"); // held
    expect(addable).not.toContain("catalogue_grid"); // unavailable
    // Six goods-only sections plus the held one.
    expect(refusedCount("services")).toBe(7);
    expect(refusedCount("both")).toBe(1);
  });
});

describe("which sections a storefront renders", () => {
  it("shows each listing the half of a template it can fill", () => {
    const scopeGrid = sectionType("scope_grid")!;
    const catalogue = sectionType("catalogue_grid")!;
    const reviews = sectionType("reviews")!;

    expect(rendersFor(scopeGrid, "services")).toBe(true);
    expect(rendersFor(scopeGrid, "both")).toBe(true);
    expect(rendersFor(scopeGrid, "goods")).toBe(false);
    expect(rendersFor(scopeGrid, "unset")).toBe(false);

    expect(rendersFor(catalogue, "services")).toBe(false);
    expect(rendersFor(catalogue, "unset")).toBe(true);

    for (const kind of ["unset", "goods", "services", "both"] as const) {
      expect(rendersFor(reviews, kind)).toBe(true);
    }
  });

  it("agrees with the library about what is available", () => {
    expect(isAvailable(sectionType("coverage")!, "services")).toBe(true);
    expect(isAvailable(sectionType("coverage")!, "goods")).toBe(false);
    expect(isAvailable(sectionType("coverage")!, "both")).toBe(true);
  });
});
