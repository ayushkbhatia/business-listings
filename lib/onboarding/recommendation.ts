import type { LocationType } from "@/lib/db/generated/enums";

/**
 * The sub-line that repeats the seller's own setup back to them.
 *
 * Board 2e's second correction, and the sharpest one on the board: the render
 * cited *"3 branches, a fabrication shop and an existing product list"* for a
 * seller who had pinned **one** location, of type workshop, on `2d`. The note is
 * worth quoting because it is the whole reason this module is pure and tested
 * rather than a template string in the page — *"a personalised recommendation
 * that misstates the seller's own setup is worse than a generic one — it tells
 * them the platform was not paying attention during four steps of data entry."*
 *
 * So every clause here is derived from a row the seller filled in, and a fact
 * that is not there is left out rather than guessed. Criterion 9: a branch count
 * that disagrees with `2d` fails the board.
 *
 * Pure, and no `t()`. The caller passes the words, because the assembly is the
 * decision and the wording is a locale's.
 */

export interface SetupFacts {
  /** How many locations the seller pinned on 2d. */
  locations: number;
  /** The types they chose, in the order the cards render. */
  locationTypes: readonly LocationType[];
  /** Primary first, then extras. Already the seller's own names. */
  categories: readonly string[];
  /** What they have loaded so far. Zero is a fact worth stating, not hiding. */
  products: number;
}

/** The clauses, in the order the sentence reads them. */
export type Clause =
  | { kind: "locations"; count: number; types: LocationType[] }
  | { kind: "categories"; names: string[] }
  | { kind: "catalogue"; loaded: boolean };

/**
 * What can honestly be said about this seller's setup.
 *
 * Returns clauses rather than a sentence so the caller can drop the whole
 * sub-line when there is nothing to say. A seller who has one location, no
 * extra categories and no products still gets two clauses — the location and
 * the category are both real — and that is the floor, because those two are
 * required to reach this page at all.
 *
 * Location types are de-duplicated and kept in the order they appear. A seller
 * with three warehouses is described as having three locations, not as having
 * "a warehouse, a warehouse and a warehouse".
 */
export function setupClauses(facts: SetupFacts): Clause[] {
  const clauses: Clause[] = [];

  if (facts.locations > 0) {
    const types: LocationType[] = [];
    for (const type of facts.locationTypes) if (!types.includes(type)) types.push(type);
    clauses.push({ kind: "locations", count: facts.locations, types });
  }

  const names = facts.categories.filter((name) => name.trim() !== "");
  if (names.length > 0) clauses.push({ kind: "categories", names });

  /*
     The catalogue clause is about what is *left to do*, which is why an empty
     one is worth a sentence and a full one is not. "A product list to load" is
     the seller's next hour; "forty products" is a fact they already know and
     would read as the page padding itself.
  */
  if (facts.products === 0) clauses.push({ kind: "catalogue", loaded: false });

  return clauses;
}

/**
 * `one location with a workshop, HVAC chillers and AMC, and a product list to load`
 *
 * The caller supplies every word. `join` is the locale's list separator and
 * `and` its final conjunction — Arabic needs both and neither is a comma.
 */
export function joinClauses(
  parts: readonly string[],
  words: { join: string; and: string },
): string {
  if (parts.length === 0) return "";
  if (parts.length === 1) return parts[0]!;
  return `${parts.slice(0, -1).join(words.join)}${words.and}${parts.at(-1)}`;
}
