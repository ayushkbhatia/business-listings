import "server-only";
import { prisma } from "@/lib/db/client";
import { haversineKm } from "@/lib/geo/distance";
import { CATEGORY_RULES_SELECT, tradeKindFor, type CategoryRules } from "@/lib/taxonomy/service";
import { landingState, PUBLIC_BUSINESS, toLandingCategory, type LandingScope } from "./scope";
import { EMIRATES } from "./scope";
import type { Emirate, TradeKind } from "@/lib/db/generated/enums";

/**
 * Board 6a §3 and §6 — the internal link graph, and the rule that governs all
 * of it.
 *
 * **No entry is ever rendered for an unpublished page** — not greyed, not plain
 * text, not a `span`. §6 states it and §the-publish-gate consequence 4 states
 * the other direction: when supply drops, every link block that pointed at a
 * page stops rendering that link **in the same pass** the page stops being
 * served. No orphaned link survives a supply drop, in either direction.
 *
 * That is why nothing here reads `publishedAt` alone. Every candidate goes
 * through `landingState`, which re-evaluates the four conditions now — the same
 * call the route makes to decide whether to 404 and the same one the sitemap
 * makes. Criterion 13 asks the anchor set and the sitemap set to be identical,
 * and one shared decision is the only way that holds without two functions
 * being kept in step by hand.
 *
 * ## The cost, stated
 *
 * This is a state evaluation per candidate page, and the candidates are the
 * published rows in three adjacent axes — tens, not thousands, because
 * `publishedAt` narrows first and only survivors are re-checked. At
 * `revalidate = 300` on a page that is mostly cache hits that is the right
 * trade against a stored flag that can be wrong. If the published population
 * ever makes it the wrong trade, the fix is a materialised `live` column
 * maintained by the sweep — not trusting `publishedAt` here.
 */

export interface LandingLink {
  href: string;
  label: string;
  listings: number;
  /**
   * The linked page's trade, and what it calls the people in it — board
   * `6a-s`. The services template words a *Related work* entry the way the
   * linked page's own H1 reads, so a link and the page it opens agree.
   */
  trade?: TradeKind;
  categoryName?: string;
  pluralHuman?: string | null;
  /** Kilometres from this page's area to the linked one, where both are pinned. */
  distanceKm?: number | null;
}

interface Candidate {
  scope: LandingScope;
  label: string;
  distanceKm?: number | null;
}

/** Every candidate that is genuinely live, with its real count. */
async function live(candidates: readonly Candidate[]): Promise<LandingLink[]> {
  const states = await Promise.all(
    candidates.map(async (candidate) => ({
      candidate,
      state: await landingState(candidate.scope),
    })),
  );
  return states
    .filter((entry) => entry.state.live)
    .map((entry) => ({
      href: entry.candidate.scope.path,
      label: entry.candidate.label,
      listings: entry.state.listings,
      trade: entry.candidate.scope.trade,
      categoryName: entry.candidate.scope.category.name,
      pluralHuman: entry.candidate.scope.category.pluralHuman,
      distanceKm: entry.candidate.distanceKm ?? null,
    }));
}

/**
 * The trade of every category a block names, resolved once each.
 *
 * `tradeKindFor` rather than a walk over the cached map, because the map lives a
 * day and a trade created since resolves to `goods` from it — and a services
 * page checked on the goods rule is a page counted by branch address, which is
 * the one thing this board forbids. `tradeKindFor` reads the table on a miss.
 */
async function tradeResolver(categoryIds: readonly string[]): Promise<(categoryId: string) => TradeKind> {
  const unique = [...new Set(categoryIds)];
  const resolved = new Map(
    await Promise.all(unique.map(async (id) => [id, await tradeKindFor(id)] as const)),
  );
  return (categoryId) => resolved.get(categoryId) ?? "goods";
}

/** Kilometres between two areas, or null where either has no centre. */
function kmBetween(
  from: { lat: number | null; lng: number | null } | null,
  to: { lat: number | null; lng: number | null },
): number | null {
  if (!from || from.lat === null || from.lng === null || to.lat === null || to.lng === null) return null;
  return haversineKm({ lat: from.lat, lng: from.lng }, { lat: to.lat, lng: to.lng });
}

const CATEGORY_SELECT = {
  id: true,
  slug: true,
  name: true,
  parentId: true,
  pluralHuman: true,
  servicesLandingOpenedAt: true,
  ...CATEGORY_RULES_SELECT,
  parent: { select: { slug: true, name: true } },
} as const;

type CandidateCategory = CategoryRules & {
  id: string;
  slug: string;
  name: string;
  parentId: string | null;
  pluralHuman: string | null;
  servicesLandingOpenedAt: Date | null;
  parent: { slug: string; name: string } | null;
};

function scopeOf(
  kind: "area" | "emirate",
  emirate: Emirate,
  area: { id: string; slug: string; name: string; lat: number | null; lng: number | null } | null,
  category: CandidateCategory,
  categoryIds: string[],
  trade: TradeKind,
): LandingScope {
  return {
    kind,
    trade,
    emirate,
    area,
    category: toLandingCategory(category),
    categoryIds,
    path: area ? `/${emirate}/${area.slug}/${category.slug}` : `/${emirate}/${category.slug}`,
  };
}

async function categoryIdsFor(category: { id: string }): Promise<string[]> {
  const children = await prisma.category.findMany({
    where: { parentId: category.id },
    select: { id: true },
  });
  return [category.id, ...children.map((child) => child.id)];
}

/**
 * §3, the map card — five nearby areas, in the same emirate and the same trade.
 *
 * *"Ordered by real travel proximity from the geo table, not alphabetically and
 * not by count."* Haversine from this area's own centroid, which is the geo
 * table's answer to that question; an area with no coordinates cannot be
 * ordered against and is left out rather than dropped at the bottom, because
 * "nearby" is the whole claim the card makes.
 *
 * **Only published pages appear**, so this card can be short. Five is a cap and
 * not a quota — padding it to five with a page that does not exist is the lie
 * with a layout reason the interface-honesty rules name first.
 */
export async function nearbyAreas(scope: LandingScope, limit = 5): Promise<LandingLink[]> {
  if (!scope.area || scope.area.lat === null || scope.area.lng === null) return [];
  const here = { lat: scope.area.lat, lng: scope.area.lng };

  const pages = await prisma.areaPage.findMany({
    where: {
      publishedAt: { not: null },
      categoryId: scope.category.id,
      areaId: { not: scope.area.id },
      area: { emirate: scope.emirate, lat: { not: null }, lng: { not: null } },
    },
    select: {
      area: { select: { id: true, slug: true, name: true, lat: true, lng: true } },
      category: { select: CATEGORY_SELECT },
    },
  });

  const byDistance = pages
    .map((page) => ({
      page,
      km: haversineKm(here, { lat: page.area.lat as number, lng: page.area.lng as number }),
    }))
    /*
       Ordered before the live check, then truncated after it. Checking the
       nearest five and finding three of them held back would render two links
       and leave the sixth-nearest — which is published — off a card that has
       room for it.
    */
    .sort((a, b) => a.km - b.km);

  const links = await live(
    await Promise.all(
      byDistance.map(async (entry) => ({
        scope: scopeOf(
          "area",
          scope.emirate,
          entry.page.area,
          entry.page.category,
          await categoryIdsFor(entry.page.category),
          scope.trade,
        ),
        label: entry.page.area.name,
      })),
    ),
  );
  return links.slice(0, limit);
}

export interface SiblingBlocks {
  /** Same trade, other areas in this emirate. Absent on the emirate class. */
  otherAreas: LandingLink[];
  /** Same trade, the other emirates — the `/:emirate/:category` class. */
  otherEmirates: LandingLink[];
  /** Other trades in this place. */
  otherTrades: LandingLink[];
}

/**
 * §6 — three equal columns, and the reason a new area page gets crawled at all.
 *
 * *"the emirate column lists all 7 only when all 7 are published, otherwise
 * only those that are"* — which is what filtering on `live` does, said out
 * loud so nobody later reads a short column as a bug.
 */
export async function siblingLinks(scope: LandingScope): Promise<SiblingBlocks> {
  /*
     The emirate class's trade. For goods it is the sector, because the goods
     emirate class exists at sector level only. For a trade sold by the job it
     is the trade itself — board `6a-s` D-EMI puts *VAT consultants in Dubai*
     at the subcategory, where the services taxonomy lives.
  */
  const emirateTradeId =
    scope.trade === "services" ? scope.category.id : (scope.category.parentId ?? scope.category.id);

  const [areaRows, emirateRows, tradeRows] = await Promise.all([
    /*
       Same trade, other areas in this emirate. Empty by construction on the
       emirate class, whose "other areas" question is answered by the emirate
       column instead.
    */
    scope.area
      ? prisma.areaPage.findMany({
          where: {
            publishedAt: { not: null },
            categoryId: scope.category.id,
            areaId: { not: scope.area.id },
            area: { emirate: scope.emirate },
          },
          select: {
            area: { select: { id: true, slug: true, name: true, lat: true, lng: true } },
            category: { select: CATEGORY_SELECT },
          },
        })
      : Promise.resolve([]),
    /*
       The same trade in the other emirates, as the emirate-class page.

       Deliberately not the area class: "HVAC in Sharjah" is the page a reader
       of "HVAC in Al Quoz" wants, and offering them "HVAC in Industrial Area 4"
       instead would answer a question about Sharjah with a question about one
       street in it.
    */
    prisma.emiratePage.findMany({
      where: {
        publishedAt: { not: null },
        categoryId: emirateTradeId,
        emirate: { not: scope.emirate },
      },
      select: { emirate: true, category: { select: CATEGORY_SELECT } },
    }),
    /*
       Other trades in this place. On an area page that is the other published
       area pages here; on an emirate page, the other emirate pages in the
       emirate — sectors for goods, and the services trades that have one.
    */
    scope.area
      ? prisma.areaPage.findMany({
          where: {
            publishedAt: { not: null },
            areaId: scope.area.id,
            categoryId: { not: scope.category.id },
          },
          select: {
            area: { select: { id: true, slug: true, name: true, lat: true, lng: true } },
            category: { select: CATEGORY_SELECT },
          },
        })
      : prisma.emiratePage.findMany({
          where: {
            publishedAt: { not: null },
            emirate: scope.emirate,
            categoryId: { not: scope.category.id },
          },
          select: { emirate: true, category: { select: CATEGORY_SELECT } },
        }),
  ]);

  const tradeOf = await tradeResolver([
    ...areaRows.map((row) => row.category.id),
    ...emirateRows.map((row) => row.category.id),
    ...tradeRows.map((row) => row.category.id),
  ]);

  const [otherAreas, otherEmirates, otherTrades] = await Promise.all([
    live(
      await Promise.all(
        areaRows.map(async (row) => ({
          scope: scopeOf(
            "area",
            scope.emirate,
            row.area,
            row.category,
            await categoryIdsFor(row.category),
            tradeOf(row.category.id),
          ),
          label: row.area.name,
          distanceKm: kmBetween(scope.area, row.area),
        })),
      ),
    ),
    live(
      await Promise.all(
        emirateRows.map(async (row) => ({
          scope: scopeOf(
            "emirate",
            row.emirate,
            null,
            row.category,
            await categoryIdsFor(row.category),
            tradeOf(row.category.id),
          ),
          label: row.emirate,
        })),
      ),
    ),
    live(
      await Promise.all(
        tradeRows.map(async (row) => {
          const area = "area" in row ? row.area : null;
          return {
            scope: scopeOf(
              area ? "area" : "emirate",
              area ? scope.emirate : ("emirate" in row ? row.emirate : scope.emirate),
              area,
              row.category,
              await categoryIdsFor(row.category),
              tradeOf(row.category.id),
            ),
            label: row.category.name,
          };
        }),
      ),
    ),
  ]);

  return {
    otherAreas: otherAreas.sort((a, b) => b.listings - a.listings),
    // The federal order the matrix uses, not by count: this column is a fixed
    // list of seven places and reordering it every time supply moves makes a
    // reader hunt for the one they want.
    otherEmirates: otherEmirates.sort(
      (a, b) =>
        EMIRATES.indexOf(a.label as never) - EMIRATES.indexOf(b.label as never),
    ),
    otherTrades: otherTrades.sort((a, b) => b.listings - a.listings),
  };
}

/**
 * Board `6a-s`'s *Nearby* — every live page of this trade in the other areas of
 * this emirate, nearest first.
 *
 * Every one, not five. The goods page splits the axis into a five-chip map card
 * and a full sibling column; the services board draws one card, and `B7` asks
 * the anchors across the page class to equal the sitemap — so a sixth page left
 * off this card is a live page nothing on its siblings points at. Services
 * pages are fewer and larger (`Q1`), so the card stays short in practice.
 *
 * Nearest first where both areas are pinned, then by how many firms each page
 * lists: a remote practice is not nearer for being close, but a buyer in
 * Business Bay still reads Downtown before Jebel Ali.
 */
export function nearestFirst(links: readonly LandingLink[]): LandingLink[] {
  return [...links].sort((a, b) => {
    const da = a.distanceKm ?? null;
    const db = b.distanceKm ?? null;
    if (da !== null && db !== null && da !== db) return da - db;
    if (da !== null && db === null) return -1;
    if (da === null && db !== null) return 1;
    return b.listings - a.listings || a.label.localeCompare(b.label);
  });
}

/**
 * The emirate class's half of *Nearby* — every live area page of this trade in
 * this emirate, the most firms first.
 *
 * Board `6a-s` D-EMI, undrawn: *VAT consultants in Dubai* is the page a buyer
 * who does not know the district lands on, and the areas it links are the
 * narrower pages beneath it. On the goods emirate class that axis is empty by
 * construction; on the services one it is how the link graph reaches the area
 * pages from the page above them.
 */
export async function areaPagesInEmirate(scope: LandingScope): Promise<LandingLink[]> {
  if (scope.area) return [];
  const rows = await prisma.areaPage.findMany({
    where: {
      publishedAt: { not: null },
      categoryId: scope.category.id,
      area: { emirate: scope.emirate },
    },
    select: {
      area: { select: { id: true, slug: true, name: true, lat: true, lng: true } },
      category: { select: CATEGORY_SELECT },
    },
  });
  const links = await live(
    await Promise.all(
      rows.map(async (row) => ({
        scope: scopeOf(
          "area",
          scope.emirate,
          row.area,
          row.category,
          await categoryIdsFor(row.category),
          scope.trade,
        ),
        label: row.area.name,
      })),
    ),
  );
  return links.sort((a, b) => b.listings - a.listings || a.label.localeCompare(b.label));
}

export interface SubcategoryChip {
  /** Needed to narrow the results when the chip filters in place. */
  id: string;
  slug: string;
  name: string;
  listings: number;
}

/**
 * §3 — the chips under the intro.
 *
 * *"the subcategories present in this scope with mono counts. Chips are anchors
 * to the same page with a subcategory filter, **not** to `1b`."* Open question
 * 5 settles what the filter does: it filters **in place**, canonical to the
 * unfiltered page. Navigating would open a fourth page class
 * (`/:emirate/:area/:category/:sub`) and a much larger sitemap for the same
 * content.
 *
 * Present in this scope, so a subcategory nobody here trades in has no chip.
 * A chip reading `0` is a filter that empties the page.
 */
export async function subcategoryChips(scope: LandingScope): Promise<SubcategoryChip[]> {
  /*
     Not on the services template. The board draws none, and a chip counted by
     branch address would be the location filter B1 forbids, one level down.
     No chips also means `?sub=` names nothing, so the route 404s it — a filter
     the page does not offer is not a page.
  */
  if (scope.trade === "services") return [];
  const children = await prisma.category.findMany({
    where: { parentId: scope.category.id },
    orderBy: { sortOrder: "asc" },
    select: { id: true, slug: true, name: true },
  });
  if (children.length === 0) return [];

  const place = scope.area
    ? { some: { areaId: scope.area.id, published: true } }
    : { some: { emirate: scope.emirate, published: true } };

  const counts = await prisma.business.groupBy({
    by: ["primaryCategoryId"],
    where: {
      ...PUBLIC_BUSINESS,
      primaryCategoryId: { in: children.map((child) => child.id) },
      locations: place,
    },
    _count: { _all: true },
  });
  const byId = new Map(counts.map((row) => [row.primaryCategoryId, row._count._all]));

  return children
    .map((child) => ({
      id: child.id,
      slug: child.slug,
      name: child.name,
      listings: byId.get(child.id) ?? 0,
    }))
    .filter((chip) => chip.listings > 0)
    .sort((a, b) => b.listings - a.listings);
}
