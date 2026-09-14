import { describe, expect, it } from "vitest";
import {
  buildTree,
  CHILDREN_SHOWN,
  flattenTree,
  foldForMatch,
  matchTree,
  sectorOf,
  visibleChildren,
  type TreeRow,
} from "./tree-model";
import { codeProblem, nameProblem, normaliseSynonyms, slugify, slugProblem } from "./rules";

/**
 * Board 4d — the tree's arithmetic and the editor's field rules, without a
 * database.
 *
 * B1 is the one this board exists to hold: the header total is the sum of the
 * tree, so the two cannot disagree. These assertions are on the numbers the
 * screen prints, computed the way the screen computes them.
 */

let order = 0;
const row = (over: Partial<TreeRow> & Pick<TreeRow, "id">): TreeRow => ({
  parentId: null,
  name: over.id,
  nameAr: null,
  slug: over.id,
  code: "XX",
  sortOrder: order++,
  synonyms: [],
  showInIndex: true,
  acceptsRfq: true,
  requiresExtraCheck: false,
  ...over,
});

const ROWS: TreeRow[] = [
  row({ id: "industrial", name: "Industrial & MEP supplies", sortOrder: 2 }),
  row({ id: "auto", name: "Auto parts & garages", sortOrder: 0 }),
  row({ id: "empty", name: "Education & training", sortOrder: 9 }),
  row({ id: "valves", parentId: "industrial", name: "Valves & actuators", synonyms: ["butterfly valve", "gate valve", "صمامات"] }),
  row({ id: "pumps", parentId: "industrial", name: "Pumps & motors" }),
  row({ id: "hoses", parentId: "industrial", name: "Industrial hoses" }),
  row({ id: "tyres", parentId: "auto", name: "Tyres" }),
];

const COUNTS = new Map([
  ["valves", 341],
  ["pumps", 298],
  ["hoses", 14],
  ["industrial", 7],
  ["tyres", 40],
]);

describe("buildTree — B1, every figure adds up", () => {
  const tree = buildTree(ROWS, COUNTS);

  it("rolls a sector up from its subcategories plus what is filed directly under it", () => {
    const industrial = tree.sectors.find((sector) => sector.id === "industrial")!;
    expect(industrial.ownListings).toBe(7);
    expect(industrial.listings).toBe(7 + 341 + 298 + 14);
  });

  it("states a header total that is the sum of the rows — and of every listing counted", () => {
    const sumOfRows = tree.sectors.reduce((total, sector) => total + sector.listings, 0);
    const everyListing = [...COUNTS.values()].reduce((total, count) => total + count, 0);
    expect(tree.totals.listings).toBe(sumOfRows);
    expect(tree.totals.listings).toBe(everyListing);
    expect(tree.totals.sectors).toBe(3);
    expect(tree.totals.subcategories).toBe(4);
    expect(flattenTree(tree)).toHaveLength(ROWS.length);
  });

  it("keeps a sector at zero listings in the tree — a sector is a taxonomy decision, not a supply one", () => {
    const empty = tree.sectors.find((sector) => sector.id === "empty");
    expect(empty?.listings).toBe(0);
  });

  it("orders sectors as ops ordered them, and subcategories by listings", () => {
    expect(tree.sectors.map((sector) => sector.id)).toEqual(["auto", "industrial", "empty"]);
    expect(tree.sectors[1]!.children.map((child) => child.id)).toEqual(["valves", "pumps", "hoses"]);
  });

  it("does not lose a row whose parent is missing, and does not loop on a cycle", () => {
    const odd = buildTree(
      [row({ id: "orphan", parentId: "gone" }), row({ id: "a", parentId: "b" }), row({ id: "b", parentId: "a" })],
      new Map([["orphan", 3], ["a", 2]]),
    );
    expect(odd.totals.listings).toBe(5);
    expect(odd.sectors.map((sector) => sector.id)).toContain("orphan");
    expect(flattenTree(odd).map((node) => node.id).sort()).toEqual(["a", "b", "orphan"]);
  });

  it("finds the sector a row sits under", () => {
    expect(sectorOf(tree, "pumps")?.id).toBe("industrial");
    expect(sectorOf(tree, "auto")?.id).toBe("auto");
    expect(sectorOf(tree, "nope")).toBeNull();
  });
});

describe("matchTree — search the tree", () => {
  const tree = buildTree(ROWS, COUNTS);

  it("is the whole tree for an empty query", () => {
    expect(matchTree(tree, "  ").matches).toHaveLength(3);
  });

  it("reaches a subcategory through a synonym, and shows only that subcategory", () => {
    const { matches, count } = matchTree(tree, "Gate VALVE");
    expect(matches.map((match) => match.sector.id)).toEqual(["industrial"]);
    expect(matches[0]!.children.map((child) => child.id)).toEqual(["valves"]);
    expect(count).toBe(1);
  });

  it("finds Arabic with or without the short vowels (B4: synonyms are multilingual)", () => {
    expect(matchTree(tree, "صمامات").matches[0]?.children[0]?.id).toBe("valves");
    expect(matchTree(tree, "صَمَامَات").matches[0]?.children[0]?.id).toBe("valves");
    expect(foldForMatch("صَمَامَات")).toBe("صمامات");
  });

  it("shows every subcategory of a sector matched by name", () => {
    const { matches } = matchTree(tree, "industrial");
    const industrial = matches.find((match) => match.sector.id === "industrial")!;
    expect(industrial.children).toHaveLength(3);
  });

  it("returns nothing, not everything, when nothing matches", () => {
    expect(matchTree(tree, "zzz").matches).toEqual([]);
  });
});

describe("visibleChildren — + N more", () => {
  const children = buildTree(
    [row({ id: "s" }), ...Array.from({ length: 12 }, (_, index) => row({ id: `c${index}`, parentId: "s" }))],
    new Map(Array.from({ length: 12 }, (_, index) => [`c${index}`, 100 - index])),
  ).sectors[0]!.children;

  it("folds after the limit and says how many wait", () => {
    const { shown, hidden } = visibleChildren(children, { selectedId: null, expanded: false });
    expect(shown).toHaveLength(CHILDREN_SHOWN);
    expect(hidden).toBe(12 - CHILDREN_SHOWN);
  });

  it("never hides the selected row behind the fold", () => {
    const { shown, hidden } = visibleChildren(children, { selectedId: "c11", expanded: false });
    expect(shown.map((child) => child.id)).toContain("c11");
    expect(hidden).toBe(0);
  });
});

describe("field rules", () => {
  it("makes a slug the way the rest of the tree is spelled", () => {
    expect(slugify("Valves & actuators")).toBe("valves-and-actuators");
    expect(slugify("  Café  équipement ")).toBe("cafe-equipement");
    expect(slugify("صمامات")).toBe("");
    expect(slugProblem("valves-and-actuators")).toBeNull();
    expect(slugProblem("Valves")).toBe("slug_invalid");
    expect(slugProblem("a--b")).toBe("slug_invalid");
  });

  it("asks for two letters only where the code changes", () => {
    expect(codeProblem("IN")).toBeNull();
    expect(codeProblem("in")).toBe("code_invalid");
    expect(codeProblem("BV2")).toBe("code_invalid");
    // A seeded three-character code the person did not touch is not refused.
    expect(codeProblem("BV2", "BV2")).toBeNull();
  });

  it("stores synonyms trimmed, collapsed, and once regardless of case", () => {
    const { value, problem } = normaliseSynonyms([" Gate  valve", "gate valve", "", "صمامات", "صمامات "]);
    expect(value).toEqual(["Gate valve", "صمامات"]);
    expect(problem).toBeNull();
    expect(normaliseSynonyms(["x".repeat(61)]).problem).toBe("synonym_too_long");
    expect(normaliseSynonyms(Array.from({ length: 41 }, (_, index) => `term ${index}`)).problem).toBe("too_many_synonyms");
  });

  it("requires a name", () => {
    expect(nameProblem("   ")).toBe("name_empty");
    expect(nameProblem("x".repeat(81))).toBe("name_too_long");
    expect(nameProblem("Valves & actuators")).toBeNull();
  });
});
