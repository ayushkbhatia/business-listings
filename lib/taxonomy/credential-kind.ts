import type { CredentialKind } from "@/lib/db/generated/enums";

/**
 * The credential buyers in a trade look for — board `6a-s`, and the
 * per-subcategory resolution `4e-s` Q3 said a scope-sheet family could not be.
 *
 * `ScopeSheetFamily.credentialKind` prompts one credential for every trade in a
 * family, and it is null for Professional services on purpose: tax, audit and
 * law sit in that family and answer to the FTA, the Ministry of Finance and a
 * bar respectively. `Category.credentialKind` is where a trade names its own,
 * and this is the walk that reads it:
 *
 *   1. the trade's own value;
 *   2. the nearest ancestor's;
 *   3. the family's, where the trade resolves to one that names a credential;
 *   4. none.
 *
 * Pure, the way `./trade-kind.ts` is, so the precedence is tested without a
 * database. The loader in `./services-landing.ts` reads the two small tables it
 * needs once.
 */

export interface CredentialKindRow {
  id: string;
  parentId: string | null;
  credentialKind: CredentialKind | null;
}

export type CredentialKindOrigin =
  | { kind: CredentialKind; from: "own" }
  | { kind: CredentialKind; from: "inherited"; ancestorId: string }
  | { kind: CredentialKind; from: "family"; familyId: string }
  | { kind: null; from: "none" };

/** How far up the tree to walk before concluding the parents form a cycle. */
const MAX_DEPTH = 8;

/**
 * `familyCredential` is the family the trade resolves to, already resolved by
 * the caller through `resolveScopeFamily` — or null where it resolves to the
 * seeded default and that names nothing.
 */
export function credentialKindOrigin(
  rows: ReadonlyMap<string, CredentialKindRow>,
  categoryId: string,
  familyCredential: { familyId: string; kind: CredentialKind | null } | null,
): CredentialKindOrigin {
  let current: string | null = categoryId;
  for (let depth = 0; depth < MAX_DEPTH && current; depth += 1) {
    const row: CredentialKindRow | undefined = rows.get(current);
    if (!row) break;
    if (row.credentialKind !== null) {
      return current === categoryId
        ? { kind: row.credentialKind, from: "own" }
        : { kind: row.credentialKind, from: "inherited", ancestorId: current };
    }
    current = row.parentId;
  }
  if (familyCredential?.kind) {
    return { kind: familyCredential.kind, from: "family", familyId: familyCredential.familyId };
  }
  return { kind: null, from: "none" };
}
