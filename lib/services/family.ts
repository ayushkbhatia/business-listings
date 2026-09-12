/**
 * Which scope sheet a service fills in — board `3g-s` B2.
 *
 * `Category.scopeFamilyId` is nullable and every one of the 440 rows is null
 * today, because null means "inherit from the parent" and nobody has assigned a
 * family yet. That is the same shape `Category.tradeKind` uses and for the same
 * reason: a sector set once covers every child that does not disagree, and only
 * the disagreements are typed.
 *
 * Pure, with no database import, so the inheritance rule is unit-tested the way
 * `resolveTradeKind` is. The query half lives in `./service.ts`.
 *
 * ## The fallback is not a global list
 *
 * B2's whole point is that one fee-basis enum "was wrong for every family at
 * once". The `general` family is not that: it is what a trade nobody has
 * classified yet resolves to, exactly as an unset `tradeKind` resolves to
 * `goods`. The difference is that a global list would be offered to a
 * facilities-management firm *instead of* per-sq-ft-per-year; this one is
 * offered only where no better answer has been recorded, and recording one is a
 * row rather than a deploy.
 */

/** The three columns the walk needs, and nothing else. */
export interface ScopeFamilyRow {
  id: string;
  parentId: string | null;
  scopeFamilyId: string | null;
}

/** How far up the tree to walk before concluding the parents form a cycle. */
const MAX_DEPTH = 8;

export type FamilyOrigin =
  | { familyId: string; from: "own" }
  | { familyId: string; from: "inherited"; ancestorId: string }
  | { familyId: null; from: "default" };

/**
 * Resolve one category against an already-loaded taxonomy.
 *
 * Returns `null` when nothing on the chain names a family, which the caller
 * turns into the seeded default. Null rather than the default's id because the
 * default is a row somebody could rename, and a pure module that hardcoded its
 * id would disagree with the database the first time they did.
 */
export function resolveScopeFamily(
  rows: ReadonlyMap<string, ScopeFamilyRow>,
  categoryId: string,
): string | null {
  return familyOrigin(rows, categoryId).familyId;
}

/** `resolveScopeFamily`, with where the answer came from — for the ops screen. */
export function familyOrigin(
  rows: ReadonlyMap<string, ScopeFamilyRow>,
  categoryId: string,
): FamilyOrigin {
  let current: string | null = categoryId;
  for (let depth = 0; depth < MAX_DEPTH && current; depth += 1) {
    const row: ScopeFamilyRow | undefined = rows.get(current);
    if (!row) break;
    if (row.scopeFamilyId !== null) {
      return current === categoryId
        ? { familyId: row.scopeFamilyId, from: "own" }
        : { familyId: row.scopeFamilyId, from: "inherited", ancestorId: current };
    }
    current = row.parentId;
  }
  return { familyId: null, from: "default" };
}
