import { describe, expect, it } from "vitest";
import { credentialKindOrigin, type CredentialKindRow } from "./credential-kind";

/**
 * Board `6a-s` — which credential a trade's landing page counts.
 *
 * The trade's own, then an ancestor's, then its scope-sheet family's, then
 * none — `4e-s` Q3's per-subcategory resolution. A family that names nothing
 * (Professional services, deliberately) leaves a trade that names nothing with
 * no credential stat, never a guessed one.
 */

const rows = new Map<string, CredentialKindRow>([
  ["legal", { id: "legal", parentId: null, credentialKind: null }],
  ["vat", { id: "vat", parentId: "legal", credentialKind: "fta_tax_agent" }],
  ["audit", { id: "audit", parentId: "legal", credentialKind: null }],
  ["inspection", { id: "inspection", parentId: null, credentialKind: "professional_body" }],
  ["lifts", { id: "lifts", parentId: "inspection", credentialKind: null }],
]);

describe("credentialKindOrigin", () => {
  it("takes the trade's own value first", () => {
    expect(credentialKindOrigin(rows, "vat", { familyId: "professional", kind: null })).toEqual({
      kind: "fta_tax_agent",
      from: "own",
    });
  });

  it("inherits from the nearest ancestor that names one", () => {
    expect(credentialKindOrigin(rows, "lifts", null)).toEqual({
      kind: "professional_body",
      from: "inherited",
      ancestorId: "inspection",
    });
  });

  it("falls back to the family's prompt where nothing on the chain names one", () => {
    expect(credentialKindOrigin(rows, "audit", { familyId: "fm", kind: "other" })).toEqual({
      kind: "other",
      from: "family",
      familyId: "fm",
    });
  });

  it("says none rather than guessing when the family names nothing either", () => {
    expect(credentialKindOrigin(rows, "audit", { familyId: "professional", kind: null })).toEqual({
      kind: null,
      from: "none",
    });
    expect(credentialKindOrigin(rows, "missing", null)).toEqual({ kind: null, from: "none" });
  });

  it("stops on a cycle rather than spinning", () => {
    const loop = new Map<string, CredentialKindRow>([
      ["a", { id: "a", parentId: "b", credentialKind: null }],
      ["b", { id: "b", parentId: "a", credentialKind: null }],
    ]);
    expect(credentialKindOrigin(loop, "a", null)).toEqual({ kind: null, from: "none" });
  });
});
