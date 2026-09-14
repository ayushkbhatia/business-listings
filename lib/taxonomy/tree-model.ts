/**
 * Board 4d — the category tree, as numbers that add up.
 *
 * Pure. The server builds it from two queries, the client filters it as staff
 * type, and the tests hold its arithmetic without a database. Nothing here
 * imports Prisma, the clock or the catalogue.
 *
 * **B1: every count is a query, and the header total is the sum of the tree.**
 * The board shipped once with a header that could disagree with the rows under
 * it, and twice before that this week another board did the same. So there is
 * exactly one place a figure on this screen is added up — `buildTree` — and the
 * header reads the same array the rows render. It cannot say one number while
 * the tree says another, because there is no second number to say.
 *
 * **B2: no unmapped state.** `Business.primaryCategoryId` is `NOT NULL`, so a
 * listing that exists is in the tree, and the header states a total rather
 * than a fraction. There is no field on this type that could carry "unmapped",
 * which is the point.
 */

export interface TreeRow {
  id: string;
  parentId: string | null;
  name: string;
  nameAr: string | null;
  slug: string;
  code: string;
  sortOrder: number;
  synonyms: readonly string[];
  showInIndex: boolean;
  acceptsRfq: boolean;
  requiresExtraCheck: boolean;
}

export interface TreeNode {
  id: string;
  parentId: string | null;
  name: string;
  nameAr: string | null;
  slug: string;
  code: string;
  synonyms: readonly string[];
  showInIndex: boolean;
  acceptsRfq: boolean;
  requiresExtraCheck: boolean;
  /** Public listings filed directly under this category. */
  ownListings: number;
  /**
   * Its own plus everything beneath it — the figure the row shows.
   *
   * The board's states table: *"Sector collapsed — count only. The count is the
   * sum of its subcategories plus directly-mapped listings."* A sector's own
   * count alone would show a trade at a fraction of its size, because most
   * listings are filed under a subcategory.
   */
  listings: number;
  children: TreeNode[];
}

export interface TaxonomyTree {
  sectors: TreeNode[];
  totals: {
    sectors: number;
    subcategories: number;
    /** The sum of the sectors' rolled-up counts, which is every public listing. */
    listings: number;
  };
}

/** Two levels is what the taxonomy uses; the bound is for a cycle nobody meant. */
const MAX_DEPTH = 8;

const byName = (a: { name: string }, b: { name: string }) => a.name.localeCompare(b.name, "en");

/**
 * Assemble the tree and every figure on it.
 *
 * Sectors keep the order ops gave them (`sortOrder`), because that order is a
 * taxonomy decision. Subcategories sort by listing count, largest first: a
 * sector with forty children opens on the eight that carry the supply, and the
 * rest wait behind "+ N more".
 *
 * A row whose parent is not in the set is treated as a sector rather than
 * dropped. The foreign key makes that impossible today; if it ever happens, a
 * category that vanished from the tree while its listings still counted in
 * nothing would be the worse failure.
 */
export function buildTree(rows: readonly TreeRow[], ownCounts: ReadonlyMap<string, number>): TaxonomyTree {
  const ids = new Set(rows.map((row) => row.id));
  const childrenOf = new Map<string, TreeRow[]>();
  const roots: TreeRow[] = [];

  for (const row of rows) {
    if (row.parentId === null || !ids.has(row.parentId) || row.parentId === row.id) {
      roots.push(row);
      continue;
    }
    const siblings = childrenOf.get(row.parentId);
    if (siblings) siblings.push(row);
    else childrenOf.set(row.parentId, [row]);
  }

  let subcategories = 0;
  const seen = new Set<string>();

  const nodeFor = (row: TreeRow, depth: number): TreeNode => {
    seen.add(row.id);
    const children =
      depth >= MAX_DEPTH
        ? []
        : (childrenOf.get(row.id) ?? [])
            .filter((child) => !seen.has(child.id))
            .map((child) => nodeFor(child, depth + 1));
    if (depth > 0) subcategories += 1;

    children.sort((a, b) => b.listings - a.listings || byName(a, b));

    const ownListings = ownCounts.get(row.id) ?? 0;
    return {
      id: row.id,
      parentId: depth === 0 ? null : row.parentId,
      name: row.name,
      nameAr: row.nameAr,
      slug: row.slug,
      code: row.code,
      synonyms: row.synonyms,
      showInIndex: row.showInIndex,
      acceptsRfq: row.acceptsRfq,
      requiresExtraCheck: row.requiresExtraCheck,
      ownListings,
      listings: ownListings + children.reduce((total, child) => total + child.listings, 0),
      children,
    };
  };

  const sectors = [...roots]
    .sort((a, b) => a.sortOrder - b.sortOrder || byName(a, b))
    .map((row) => nodeFor(row, 0));

  /*
     Rows no root reached: a cycle, where every row has a parent and none is a
     sector. Nothing on the screen can make one — the add dialog only files
     under a sector — but a row the tree silently dropped would have listings
     the header never counted, which is the one thing this function exists to
     rule out. So they surface as sectors, where somebody will see them.
  */
  for (const row of rows) {
    if (!seen.has(row.id)) sectors.push(nodeFor({ ...row, parentId: null }, 0));
  }

  return {
    sectors,
    totals: {
      sectors: sectors.length,
      subcategories,
      listings: sectors.reduce((total, sector) => total + sector.listings, 0),
    },
  };
}

/** Every node, depth first, sectors before their children. */
export function flattenTree(tree: TaxonomyTree): TreeNode[] {
  const out: TreeNode[] = [];
  const walk = (node: TreeNode) => {
    out.push(node);
    node.children.forEach(walk);
  };
  tree.sectors.forEach(walk);
  return out;
}

/** The sector a node sits under, or the node itself when it is one. */
export function sectorOf(tree: TaxonomyTree, id: string): TreeNode | null {
  for (const sector of tree.sectors) {
    if (sector.id === id) return sector;
    const stack = [...sector.children];
    while (stack.length) {
      const node = stack.pop()!;
      if (node.id === id) return sector;
      stack.push(...node.children);
    }
  }
  return null;
}

// ─────────────────────────────────────────────────────────────────────────────
// Search the tree
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Folded for matching: case, compatibility forms, Arabic diacritics and the
 * tatweel.
 *
 * Synonyms are routing and they are multilingual (`B4`), so a person searching
 * the tree for صمامات has to find the row a buyer typing it lands on — with or
 * without the short vowels, which Arabic keyboards type and most writing omits.
 */
export function foldForMatch(value: string): string {
  return value
    .normalize("NFKC")
    .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
    .toLocaleLowerCase("en")
    .replace(/\s+/g, " ")
    .trim();
}

function nodeMatches(node: TreeNode, needle: string): boolean {
  if (foldForMatch(node.name).includes(needle)) return true;
  if (node.slug.includes(needle.replace(/ /g, "-"))) return true;
  if (node.nameAr && foldForMatch(node.nameAr).includes(needle)) return true;
  return node.synonyms.some((synonym) => foldForMatch(synonym).includes(needle));
}

export interface TreeMatch {
  sector: TreeNode;
  /** The children to show: all of them where the sector itself matched. */
  children: TreeNode[];
}

/**
 * The part of the tree a query reaches.
 *
 * A sector that matches by name shows every child, because "Logistics" is a
 * request to see logistics. A sector that matches only through a child shows
 * that child, because "gate valve" is not.
 *
 * An empty query is the whole tree, not no tree.
 */
export function matchTree(tree: TaxonomyTree, query: string): { matches: TreeMatch[]; count: number } {
  const needle = foldForMatch(query);
  if (!needle) {
    return {
      matches: tree.sectors.map((sector) => ({ sector, children: sector.children })),
      count: tree.totals.sectors + tree.totals.subcategories,
    };
  }

  const matches: TreeMatch[] = [];
  let count = 0;
  for (const sector of tree.sectors) {
    const self = nodeMatches(sector, needle);
    const children = self ? sector.children : sector.children.filter((child) => nodeMatches(child, needle));
    if (!self && children.length === 0) continue;
    matches.push({ sector, children });
    // Rows that answer the query themselves, not rows shown because a sector did.
    count += (self ? 1 : 0) + sector.children.filter((child) => nodeMatches(child, needle)).length;
  }
  return { matches, count };
}

/** How many subcategories an open sector shows before "+ N more". */
export const CHILDREN_SHOWN = 8;

/**
 * The children an open sector renders, and how many wait behind "+ N more".
 *
 * The selected row is never hidden behind the fold: a person who opened a
 * subcategory from a link, or from the merge tool, would otherwise land on an
 * editor for a row the tree does not show.
 */
export function visibleChildren(
  children: readonly TreeNode[],
  options: { selectedId: string | null; expanded: boolean; limit?: number },
): { shown: TreeNode[]; hidden: number } {
  const limit = options.limit ?? CHILDREN_SHOWN;
  if (options.expanded || children.length <= limit) return { shown: [...children], hidden: 0 };
  const selectedAt = options.selectedId ? children.findIndex((child) => child.id === options.selectedId) : -1;
  if (selectedAt >= limit) return { shown: [...children], hidden: 0 };
  return { shown: children.slice(0, limit), hidden: children.length - limit };
}
