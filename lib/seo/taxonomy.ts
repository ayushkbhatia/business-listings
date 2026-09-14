import "server-only";
import { prisma } from "@/lib/db/client";
import { countWords, evaluatePublish } from "@/lib/publish-threshold";
import {
  CATEGORY_RULES_SELECT,
  thresholdsFor,
  type CategoryRules,
} from "@/lib/taxonomy/service";
import { VERIFIED_TIER } from "@/lib/verification";

/**
 * The taxonomy, with the numbers each page publishes against — board 6c.
 *
 * The same three gates as `lib/content/matrix.ts`, computed once for the whole
 * tree. Two callers: the public category index, and the subcategory page, which
 * needs to know whether it may be indexed.
 *
 * Criterion 2: nothing here is keyed by a slug or a name. Adding a subcategory
 * adds a row, adds a page, and touches no code.
 */

const PUBLIC_BUSINESS = { suspendedAt: null, publishedAt: { not: null } } as const;

export interface TradeNode {
  id: string;
  slug: string;
  name: string;
  listings: number;
  verified: number;
  /** Whether this page clears the board 6f floors. */
  publishable: boolean;
  /** Board 4d's switch for `/categories`. Read by `listedInIndex`, and by nothing that builds the sitemap. */
  showInIndex: boolean;
}

export interface SectorNode extends TradeNode {
  children: TradeNode[];
}

interface Counted {
  listings: Map<string, number>;
  verified: Map<string, number>;
}

async function counts(): Promise<Counted> {
  const [listings, verified] = await Promise.all([
    prisma.business.groupBy({
      by: ["primaryCategoryId"],
      where: { ...PUBLIC_BUSINESS, mergedIntoId: null },
      _count: true,
    }),
    prisma.business.groupBy({
      by: ["primaryCategoryId"],
      where: {
        ...PUBLIC_BUSINESS,
        mergedIntoId: null,
        verificationTier: { gte: VERIFIED_TIER },
      },
      _count: true,
    }),
  ]);

  return {
    listings: new Map(listings.map((row) => [row.primaryCategoryId, row._count])),
    verified: new Map(verified.map((row) => [row.primaryCategoryId, row._count])),
  };
}

type Row = CategoryRules & {
  id: string;
  slug: string;
  name: string;
  parentId: string | null;
  intro: string | null;
  showInIndex: boolean;
};

function node(row: Row, counted: Counted): TradeNode {
  const listings = counted.listings.get(row.id) ?? 0;
  const verified = counted.verified.get(row.id) ?? 0;
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    listings,
    verified,
    showInIndex: row.showInIndex,
    publishable: evaluatePublish(
      { listings, verified, introWords: countWords(row.intro) },
      thresholdsFor(row),
    ).publishable,
  };
}

/**
 * Every sector with its subcategories.
 *
 * A sector's own count is the businesses filed directly under it; the index
 * shows the rolled-up figure by adding its children, because a buyer reading
 * "Industrial supplies" wants the trade's whole size and not an accident of
 * how precisely each listing was filed.
 */
export async function categoryIndex(): Promise<SectorNode[]> {
  const [rows, counted] = await Promise.all([
    prisma.category.findMany({
      orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
      select: {
        id: true,
        slug: true,
        name: true,
        parentId: true,
        intro: true,
        showInIndex: true,
        ...CATEGORY_RULES_SELECT,
      },
    }),
    counts(),
  ]);

  const sectors = rows.filter((row) => row.parentId === null);
  return sectors.map((row) => {
    const children = rows.filter((child) => child.parentId === row.id).map((child) => node(child, counted));
    const self = node(row, counted);
    return {
      ...self,
      listings: self.listings + children.reduce((total, child) => total + child.listings, 0),
      verified: self.verified + children.reduce((total, child) => total + child.verified, 0),
      children,
    };
  });
}

/**
 * What `/categories` lists — board 4d.
 *
 * The index is one of two public surfaces a category appears on, and since
 * board 4d it has its own switch (`B3`). This is the only reader of it. The
 * sitemap keeps reading `categoryIndex` whole: holding a trade out of the index
 * is a decision about what a buyer is shown, not about whether its page may be
 * crawled, and one boolean doing both jobs is the defect the board corrected.
 *
 * Two rules, from the board's states table:
 *
 *   - **A sector at zero listings is out**, whatever its switch says: *"stays
 *     in the tree, off the home grid and out of the index. A sector is a
 *     taxonomy decision, not a supply one."* Computed from the count, never
 *     stored.
 *   - **A subcategory is out when its own switch is off.** Its sector being out
 *     takes it out too, because it has no block to be listed in.
 *
 * A subcategory at zero listings stays. The index has listed thin
 * subcategories deliberately since board 6c — see the page's own comment.
 */
export function listedInIndex(sectors: readonly SectorNode[]): SectorNode[] {
  return sectors
    .filter((sector) => sector.showInIndex && sector.listings > 0)
    .map((sector) => ({ ...sector, children: sector.children.filter((child) => child.showInIndex) }));
}

/**
 * Whether one category's page clears the floors.
 *
 * Read by the subcategory route to decide `robots`. A thin page is not a 404 —
 * a buyer following a link to it should see what there is — but it does not go
 * into the index, and `app/sitemap.ts` already leaves it out on the same gate.
 * The two now agree because they compute it the same way.
 */
export async function isCategoryPublishable(categoryId: string): Promise<boolean> {
  const row = await prisma.category.findUnique({
    where: { id: categoryId },
    select: {
      id: true,
      slug: true,
      name: true,
      parentId: true,
      intro: true,
      showInIndex: true,
      ...CATEGORY_RULES_SELECT,
    },
  });
  if (!row) return false;
  return node(row, await counts()).publishable;
}
