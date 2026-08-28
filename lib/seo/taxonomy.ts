import "server-only";
import { prisma } from "@/lib/db/client";
import { countWords, evaluatePublish } from "@/lib/publish-threshold";
import { thresholdsFor } from "@/lib/taxonomy/service";
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

type Row = {
  id: string;
  slug: string;
  name: string;
  parentId: string | null;
  intro: string | null;
  publishThreshold: number;
  verifiedShareMin: number;
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
        publishThreshold: true,
        verifiedShareMin: true,
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
      publishThreshold: true,
      verifiedShareMin: true,
    },
  });
  if (!row) return false;
  return node(row, await counts()).publishable;
}
