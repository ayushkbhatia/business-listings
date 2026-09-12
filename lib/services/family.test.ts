import { describe, expect, it } from "vitest";
import { familyOrigin, resolveScopeFamily, type ScopeFamilyRow } from "./family";

/**
 * Board `3g-s` B2 — which family a service's category resolves to.
 *
 * The same inheritance rule `tradeKind` follows, tested the same way: null
 * means inherit, the walk stops at the nearest ancestor that answers, and a
 * chain with no answer anywhere returns null for the caller to turn into the
 * seeded default.
 */

const tree = (rows: ScopeFamilyRow[]) => new Map(rows.map((row) => [row.id, row]));

describe("resolving a scope-sheet family", () => {
  it("takes the category's own family where it has one", () => {
    const rows = tree([
      { id: "fm", parentId: "facilities", scopeFamilyId: "facilities-management" },
      { id: "facilities", parentId: null, scopeFamilyId: "general" },
    ]);
    expect(resolveScopeFamily(rows, "fm")).toBe("facilities-management");
    expect(familyOrigin(rows, "fm")).toEqual({
      familyId: "facilities-management",
      from: "own",
    });
  });

  it("inherits from the nearest ancestor that has one, and names it", () => {
    // "From Audit & accounting" is a reason to leave a row alone; a bare
    // family id is not, which is why the origin carries the ancestor.
    const rows = tree([
      { id: "statutory-audit", parentId: "audit", scopeFamilyId: null },
      { id: "audit", parentId: null, scopeFamilyId: "audit-and-assurance" },
    ]);
    expect(familyOrigin(rows, "statutory-audit")).toEqual({
      familyId: "audit-and-assurance",
      from: "inherited",
      ancestorId: "audit",
    });
  });

  it("returns null when nothing on the chain answers — which is all 440 today", () => {
    const rows = tree([
      { id: "leaf", parentId: "root", scopeFamilyId: null },
      { id: "root", parentId: null, scopeFamilyId: null },
    ]);
    expect(resolveScopeFamily(rows, "leaf")).toBeNull();
    expect(familyOrigin(rows, "leaf")).toEqual({ familyId: null, from: "default" });
  });

  it("returns null for a category that is not in the map at all", () => {
    expect(resolveScopeFamily(tree([]), "ghost")).toBeNull();
  });

  it("gives up rather than looping when the parents form a cycle", () => {
    const rows = tree([
      { id: "a", parentId: "b", scopeFamilyId: null },
      { id: "b", parentId: "a", scopeFamilyId: null },
    ]);
    expect(resolveScopeFamily(rows, "a")).toBeNull();
  });
});
