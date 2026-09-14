import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db/client";
import { PLAN_CACHE_TAG } from "./pricing";
import { VERIFIED_TIER } from "@/lib/verification";
import { detectIdentityLeak } from "@/lib/enquiry/redaction";
import { chipHref, featureBlock } from "@/lib/content/homepage-rules";
import type { Emirate } from "@/lib/db/generated/client";

/**
 * Board 1a's reads. One file, because the home page's whole argument is that
 * every number on it is true, and the rules that make each number true are
 * worth keeping next to each other.
 *
 * "A stale count is worse than no count, because the whole proposition is that
 * we know what is actually out there." So nothing here is a constant, nothing
 * is padded to fill a grid, and three sections are specified to disappear
 * rather than show a row they had to reach for.
 *
 * Every function is server-only and every one is called from the page's own
 * `Promise.all`. There is no client-side fetch on this route: the first paint
 * has to be complete for a crawler, and the LCP target is two seconds on a
 * phone.
 */

/** Suspended and unpublished never appear. Same rule as every public read. */
const PUBLIC_BUSINESS = {
  suspendedAt: null,
  publishedAt: { not: null },
} as const;

const DAY = 24 * 60 * 60 * 1000;
const ago = (days: number) => new Date(Date.now() - days * DAY);

/**
 * The cache tag every read on this page carries.
 *
 * `/` is a dynamic route: it reads the session, because a signed-in seller must
 * not be shown a claim CTA (criterion 9) and there is no way to know that
 * without a cookie. A cookie read opts the whole route out of static rendering,
 * so `export const revalidate` on the page would be inert and every visit would
 * otherwise be eight queries against Postgres — on the most-linked page on the
 * site, which is exactly the page that must not be.
 *
 * So the *route* is dynamic and the *data* is cached, each read on the window
 * the spec asks for rather than all of them on the shortest one. A hit serves
 * without touching the database; only the session lookup is per-request.
 *
 * `revalidatePath("/")` cannot clear these — it clears the route cache, and a
 * dynamic route has none — so `/admin/content/home` revalidates this tag
 * instead (board 6h `B7`). So do the three decisions that empty a featured
 * card — a suspension, a tier change and the nightly licence sweep — because a
 * stale card is a stale claim about verification.
 *
 * TODO: `unstable_cache` is deprecated in Next 16 in favour of `use cache`,
 * which needs `cacheComponents: true` in next.config.ts — a project-wide switch
 * affecting all thirty-odd routes, and its own piece of work rather than a
 * side effect of building one page.
 */
export const HOME_CACHE_TAG = "home-page";

/** An hour for the counts, five minutes for recency, a minute for the RFQs. */
const HOUR_S = 3600;
const FIVE_MIN_S = 300;
const MINUTE_S = 60;

// ─────────────────────────────────────────────────────────────────────────────
// 2 · Hero
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The three numbers in the sub-heading, and the two in the category link.
 *
 * `sectors` counts top-level categories rather than the ones on the home page:
 * the sentence says how big the directory is, and answering it with how many
 * trades we chose to feature would be a smaller, truer-sounding lie.
 */
export async function readHomeStats() {
  const [listings, sectors, subcategories, verified] = await Promise.all([
    prisma.business.count({ where: PUBLIC_BUSINESS }),
    prisma.category.count({ where: { parentId: null } }),
    prisma.category.count({ where: { parentId: { not: null } } }),
    prisma.business.count({
      where: { ...PUBLIC_BUSINESS, verificationTier: { gte: VERIFIED_TIER } },
    }),
  ]);
  return { listings, sectors, subcategories, verified };
}

/**
 * The popular-search chips under the hero — board 6h.
 *
 * Typed by staff at `/admin/content/home`, not mined from search volume. They
 * were mined until 6h, and the board's argument against it is the one that
 * holds: the top real queries on a young directory are often a brand it does
 * not stock, and this row is a promise about coverage rather than a report on
 * demand. Each chip is a label plus the query it runs (`B8`), so it can read
 * "HVAC maintenance AMC" and carry facets.
 *
 * No fallback. The six the page used to fall back to were carried into the
 * table by migration, and an empty table renders no row — the "Popular:" label
 * with nothing after it would be a promise with nothing behind it.
 *
 * A chip whose search returns nothing stays: the results page's zero state
 * handles it, and a promise about coverage is allowed to be aspirational once.
 */
export async function readCuratedQueries(): Promise<{ label: string; href: string }[]> {
  const rows = await prisma.curatedQuery.findMany({
    orderBy: { position: "asc" },
    select: { label: true, query: true },
  });
  return rows.map((row) => ({ label: row.label, href: chipHref(row.query) }));
}

/**
 * Write one row per search, whatever it returned.
 *
 * Called from the results surface beside `recordZeroResult`, which keeps its
 * own table: that one carries the applied facets and feeds the gap report and
 * the recruitment call list, and this one is counted. See the schema comment on
 * `SearchQueryLog` for why they are not one table.
 *
 * Never throws. A logging failure must not take down a results page.
 */
export async function recordSearch(
  input: {
    q: string;
    tab: string;
    emirate?: string | undefined;
  },
  resultCount: number,
  categoryId: string | null,
): Promise<void> {
  const query = input.q.trim();
  if (!query) return;

  try {
    await prisma.searchQueryLog.create({
      data: {
        query: query.slice(0, 200),
        normalised: query.toLowerCase().replace(/\s+/g, " ").slice(0, 200),
        resultCount,
        categoryId,
        emirate: (input.emirate as Emirate | undefined) ?? null,
        tab: input.tab,
      },
    });
  } catch (error) {
    console.error("[search_query_log] write failed", error);
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2 · Open requests for quotes
// ─────────────────────────────────────────────────────────────────────────────

export interface RfqTeaser {
  id: string;
  /** The requirement, as the buyer wrote it. Never truncated server-side. */
  requirement: string;
  /** The trade the fan-out went to. Never the buyer's own company. */
  categoryName: string;
  /**
   * Emirate, or null for "UAE". Resolved from the delivery area through the
   * `Area` table and never rendered as the buyer typed it — `deliverToArea` is
   * free text and "Warehouse 4, Al Quoz, behind ENOC" is an address.
   */
  emirate: Emirate | null;
  quoteCount: number;
  createdAt: Date;
}

/**
 * The four open requirements in the hero panel.
 *
 * The panel's rules, in the order they bite:
 *
 *   - **Real and open only.** `closesAt` in the future. Nothing seeded for the
 *     panel, nothing synthetic, and no fallback that invents one.
 *   - **No buyer identity at any granularity.** There is no join to `buyer` or
 *     `buyerCompany` in this query at all, so there is no column here to leak
 *     one from — the same structural move `MissedEnquiry` makes in the schema.
 *     The emirate is resolved from the area table rather than echoed.
 *   - **Suppressed if the text identifies anybody.** A phone number, an email,
 *     an IBAN or a company form drops the row. See `lib/enquiry/redaction.ts`
 *     for why suppression rather than masking.
 *   - **Never padded.** Fewer than four qualifying rows returns fewer than
 *     four; none returns none, and the page swaps the whole panel for the
 *     verification ladder rather than rendering an empty state.
 *
 * Over-fetches so suppression has something to fall back on: reading exactly
 * four and dropping two would leave two rows when a fifth was available and
 * clean.
 */
/** The hero panel holds four requirements. */
export const HOME_RFQ_LIMIT = 4;

export async function readOpenRfqTeasers(take = HOME_RFQ_LIMIT): Promise<RfqTeaser[]> {
  const now = new Date();
  const rows = await prisma.enquiry.findMany({
    where: {
      closesAt: { gt: now },
      /*
         Sent already, as well as still open.

         Two different dates, and only one of them was being checked. `closesAt`
         in the future means the request is still taking quotes; it says nothing
         about whether the request has been made yet. A row with `createdAt` in
         the future renders its age as "in 11 h" under a heading that says LIVE,
         which is the panel contradicting itself in the two words next to each
         other.

         It is reachable: the seed's clock is noon on the day it runs, so a seed
         run before midday dates its fixtures ahead of itself. A backdated
         import or a clock skew between app and database would do the same in
         production.
      */
      createdAt: { lte: now },
    },
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    // Four times the need. Enough that a run of chatty requirements does not
    // empty the panel, small enough to stay one index scan.
    take: take * 4,
    select: {
      id: true,
      requirement: true,
      deliverToArea: true,
      createdAt: true,
      _count: { select: { quotes: true } },
      /*
         The trade, taken from where the enquiry was sent rather than from
         anything the buyer typed. One recipient is enough to name it, and
         `EnquiryRecipient` carries no buyer column either.
      */
      recipients: {
        take: 1,
        // `businessId` last: under one enquiry it is the other half of the key.
        orderBy: [{ createdAt: "asc" }, { businessId: "asc" }],
        select: {
          business: {
            select: { primaryCategory: { select: { name: true, parent: { select: { name: true } } } } },
          },
        },
      },
    },
  });

  /*
     Resolving a free-text delivery area to an emirate.

     `deliverToArea` is what the buyer typed. They write "Mussafah" and the
     area table says "Mussafah M-17"; they write "Al Quoz" and it says "Al Quoz
     Industrial 1". An exact match found neither, so every row on the panel
     rendered "UAE" and the emirate column was decorative.

     Matched loosely in both directions — either name containing the other,
     lowercased — because the buyer's version is usually shorter than ours and
     occasionally longer ("Mussafah Industrial"). Seventeen areas, read once
     per render behind a five-minute cache, so this is a loop over a short list
     rather than anything the database should be asked to do.

     Unresolvable stays null and renders "UAE". That is the honest answer, and
     it is also the safe one: this column may never be finer than an emirate,
     so guessing is worse than declining.
  */
  const areas = await prisma.area.findMany({ select: { name: true, emirate: true } });
  const resolveEmirate = (typed: string | null): Emirate | null => {
    if (!typed) return null;
    const needle = typed.trim().toLowerCase();
    if (!needle) return null;
    const hit = areas.find((area) => {
      const name = area.name.toLowerCase();
      return name === needle || name.startsWith(needle) || needle.startsWith(name);
    });
    return hit?.emirate ?? null;
  };

  const teasers: RfqTeaser[] = [];
  for (const row of rows) {
    if (teasers.length === take) break;
    if (detectIdentityLeak(row.requirement).leaks) continue;

    const category = row.recipients[0]?.business.primaryCategory;
    // The sector, not the niche. "HVAC" is a useful label on a four-line
    // teaser; "Grooved couplings" is a filing code.
    const categoryName = category?.parent?.name ?? category?.name;
    if (!categoryName) continue;

    teasers.push({
      id: row.id,
      requirement: row.requirement,
      categoryName,
      emirate: resolveEmirate(row.deliverToArea),
      quoteCount: row._count.quotes,
      createdAt: row.createdAt,
    });
  }
  return teasers;
}

// ─────────────────────────────────────────────────────────────────────────────
// 3 · Browse by category
// ─────────────────────────────────────────────────────────────────────────────

export interface HomeSector {
  id: string;
  slug: string;
  name: string;
  code: string;
  listings: number;
  /** The four largest subcategories, by listing count. Never the first four. */
  topSubcategories: string[];
}

/** The rail's own length. Twelve cards is the grid the board draws; a thirteenth sector waits its turn. */
export const HOME_SECTOR_LIMIT = 12;

/**
 * The sector grid.
 *
 * A rail that computes (board 6h's map): every sector with at least one public
 * listing, by listing count, twelve at most. It used to be gated on
 * `Category.showOnHome`, a flag set by hand on the screen 6h replaced — and a
 * rail chosen by hand can be wrong by hand, which is the whole argument for
 * curating only two of the nine.
 *
 * Two rules from board 1a, both of which look like ordering and are not:
 *
 *   - **Ordered by listing count descending**, so the grid reflects what the
 *     directory actually has rather than the order somebody typed the taxonomy
 *     in. A sector that recruits well climbs without anyone editing anything.
 *   - **Each card teases its four largest subcategories**, not the first four
 *     alphabetically.
 *
 * A sector with no listings is left out rather than drawn at zero: twelve cards
 * with six reading nothing would be honest and useless, and the category index
 * one link away lists every sector anyway.
 */
export async function readHomeSectors(): Promise<HomeSector[]> {
  const sectors = await prisma.category.findMany({
    /*
       Board 4d: a sector held out of the category index is off this rail too.
       The rail's counts and population are `6c`'s (`6h` B5), and a trade staff
       took out of the full index reappearing on the most-linked page on the
       site would be the index switch not doing its job. The reverse does not
       hold — this rail is a shortlist of the index, not the other way round.
    */
    where: { parentId: null, showInIndex: true },
    select: {
      id: true,
      slug: true,
      name: true,
      code: true,
      _count: { select: { primaryFor: { where: PUBLIC_BUSINESS } } },
      children: {
        select: {
          name: true,
          showInIndex: true,
          _count: { select: { primaryFor: { where: PUBLIC_BUSINESS } } },
        },
      },
    },
  });

  return sectors
    .map((sector) => ({
      id: sector.id,
      slug: sector.slug,
      name: sector.name,
      code: sector.code,
      /*
         A sector's listings are its own plus its children's. Half the seed is
         filed under a subcategory, so counting `primaryFor` alone would show
         HVAC as a third of its real size — and the number beside the name is
         the one thing on the card a buyer can check.
      */
      listings:
        sector._count.primaryFor +
        sector.children.reduce((total, child) => total + child._count.primaryFor, 0),
      topSubcategories: sector.children
        // A subcategory held out of the index is not teased here either.
        .filter((child) => child.showInIndex && child._count.primaryFor > 0)
        .sort((a, b) => b._count.primaryFor - a._count.primaryFor || a.name.localeCompare(b.name))
        .slice(0, 4)
        .map((child) => child.name),
    }))
    .filter((sector) => sector.listings > 0)
    .sort((a, b) => b.listings - a.listings || a.name.localeCompare(b.name))
    .slice(0, HOME_SECTOR_LIMIT);
}

// ─────────────────────────────────────────────────────────────────────────────
// 4 · By emirate
// ─────────────────────────────────────────────────────────────────────────────

export interface EmirateChip {
  emirate: Emirate;
  count: number;
}

/**
 * All seven emirates with a live supplier count, plus the free-zone total.
 *
 * Seven rows always, including the ones at zero. This row is a map of the
 * country and a country does not lose an emirate because nobody has signed up
 * there yet; a buyer in Fujairah needs to see that we know Fujairah exists and
 * currently has nothing, which is a different message from Fujairah's absence.
 *
 * Free zones are counted separately and are not an eighth emirate. A JAFZA
 * company is in Dubai *and* in a free zone — two independent facts about one
 * place, which is why `Area.isFreeZone` is a property of the area and the chip
 * is a cross-cutting filter.
 */
export async function readEmirateChips(): Promise<{ chips: EmirateChip[]; freeZone: number }> {
  const ORDER: Emirate[] = [
    "dubai",
    "abu_dhabi",
    "sharjah",
    "ajman",
    "ras_al_khaimah",
    "fujairah",
    "umm_al_quwain",
  ];

  const [rows, freeZone] = await Promise.all([
    prisma.location.groupBy({
      by: ["emirate"],
      where: { published: true, business: PUBLIC_BUSINESS },
      _count: { businessId: true },
    }),
    prisma.business.count({
      where: {
        ...PUBLIC_BUSINESS,
        locations: { some: { published: true, area: { isFreeZone: true } } },
      },
    }),
  ]);

  const byEmirate = new Map(rows.map((row) => [row.emirate, row._count.businessId]));
  const chips = ORDER.map((emirate) => ({ emirate, count: byEmirate.get(emirate) ?? 0 })).sort(
    (a, b) => b.count - a.count,
  );

  return { chips, freeZone };
}

// ─────────────────────────────────────────────────────────────────────────────
// 5 · Verified this week
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The four "Verified this week" cards — board 6h.
 *
 * Chosen by a person at `/admin/content/home`, in the order they chose: slot 1
 * is the first card a buyer sees. Eligibility is read here, live, through the
 * same `featureBlock` the console reads (`B1`), so a licence the nightly sweep
 * dropped overnight, or a business suspended this morning, is simply not
 * rendered — nobody has to write to the slot.
 *
 * **Never padded.** An empty or ineligible slot renders nothing, and the rail
 * shows three cards rather than reaching for a fourth (`B2`). With no eligible
 * slot at all the array is empty and the page drops the section, which is the
 * cold-start state: four empty cards on the home page would say the directory
 * has nothing verified.
 */
export async function readVerifiedSlots(now: Date = new Date()) {
  const slots = await prisma.homepageSlot.findMany({
    orderBy: { position: "asc" },
    select: {
      business: {
        include: {
          primaryCategory: { select: { name: true, code: true } },
          locations: { where: { published: true }, include: { area: true }, orderBy: [{ createdAt: "asc" }, { id: "asc" }], take: 1 },
          _count: { select: { products: { where: { status: { not: "draft" } } } } },
        },
      },
    },
  });
  return slots.map((slot) => slot.business).filter((business) => featureBlock(business, now) === null);
}

export type VerifiedSlotBusiness = Awaited<ReturnType<typeof getVerifiedSlots>>[number];

// ─────────────────────────────────────────────────────────────────────────────
// 6 · New in supplier catalogues
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Products published in the last week, from verified sellers, one per seller.
 *
 * One per seller and spread across at least three categories, both for the same
 * reason: a supplier who uploaded a catalogue on Tuesday would otherwise own
 * the whole row, and a row of five valves from one company is an advertisement
 * rather than a picture of what is new on the platform.
 *
 * Verified sellers only. This row is an editorial slot on the home page and an
 * unverified listing has not earned one.
 *
 * No price is selected here, because there is no price column to select. The
 * card renders availability and an enquiry action where a price would sit.
 */
/** One row of five. */
export const HOME_CATALOGUE_LIMIT = 5;

export async function readNewCatalogueProducts(take = HOME_CATALOGUE_LIMIT) {
  const candidates = await prisma.product.findMany({
    where: {
      status: { not: "draft" },
      createdAt: { gte: ago(7) },
      business: { ...PUBLIC_BUSINESS, verificationTier: { gte: VERIFIED_TIER } },
    },
    // `id` last: a seller who imported a catalogue this week has one
    // `created_at` across the whole file, and this row is an editorial slot —
    // it should show the same five products to two visitors a second apart.
    orderBy: [{ createdAt: "desc" }, { id: "desc" }],
    take: take * 8,
    include: {
      category: { select: { id: true, name: true } },
      // `mediaId` last, for the same reason the row's own order needs `id`:
      // `ProductMedia.sortOrder` is `@default(0)` and ties across the product.
      media: {
        orderBy: [{ sortOrder: "asc" }, { mediaId: "asc" }],
        take: 1,
        include: { media: true },
      },
      business: { select: { slug: true, displayName: true, verificationTier: true } },
    },
  });

  const perBusiness = new Set<string>();
  const picked: typeof candidates = [];
  for (const product of candidates) {
    if (picked.length === take) break;
    if (perBusiness.has(product.businessId)) continue;
    perBusiness.add(product.businessId);
    picked.push(product);
  }

  /*
     "Mixed across at least three categories" is a quality bar, not a filter.
     If the week's uploads genuinely came from two trades, showing four
     products from two trades is the truth; dropping the section over it would
     hide real activity to satisfy a rule about variety.
  */
  return picked;
}

export type NewCatalogueProduct = Awaited<ReturnType<typeof getNewCatalogueProducts>>[number];

// ─────────────────────────────────────────────────────────────────────────────
// 7 · Supplier CTA
// ─────────────────────────────────────────────────────────────────────────────

/**
 * The three plan tiles, from the `Plan` table.
 *
 * Criterion 6: these must not drift from `/pricing`. That is only achievable by
 * both reading the same row, so neither this band nor that page carries a
 * number of its own — the seed's Basic is AED 349 and Pro is AED 899, and the
 * band says so whatever the mock was drawn with.
 */
export async function readHomePlans() {
  return prisma.plan.findMany({
    orderBy: { sortOrder: "asc" },
    select: {
      id: true,
      name: true,
      monthlyPriceAed: true,
      locationLimit: true,
      productLimit: true,
      serviceLimit: true,
      photoLimit: true, publicPhotoLimit: true,
  categoryLimit: true, storageMb: true,
      enquiriesPerMonth: true,
      customDomain: true,
      analytics: true,
      csvImport: true,
      sponsoredEligible: true,
    },
  });
}

export type HomePlan = Awaited<ReturnType<typeof getHomePlans>>[number];


// ─────────────────────────────────────────────────────────────────────────────
// Cached exports
//
// Each read on the window the spec's data table asks for, rather than all of
// them on the shortest. The page composes these.
//
// The `read*` functions above are exported too, uncached. `unstable_cache`
// needs a Next request context to reach the incremental cache and throws
// "Invariant: incrementalCache missing" without one, so a test in node can only
// call the reader — which is the right target anyway: what the integration
// tests are about is the selection rules, not whether Next caches them.
// ─────────────────────────────────────────────────────────────────────────────

export const getHomeStats = unstable_cache(readHomeStats, ["home-stats"], {
  revalidate: HOUR_S,
  tags: [HOME_CACHE_TAG],
});

export const getCuratedQueries = unstable_cache(readCuratedQueries, ["home-curated-queries"], {
  revalidate: HOUR_S,
  tags: [HOME_CACHE_TAG],
});

export const getOpenRfqTeasers = unstable_cache(readOpenRfqTeasers, ["home-rfqs"], {
  revalidate: MINUTE_S,
  tags: [HOME_CACHE_TAG],
});

export const getHomeSectors = unstable_cache(readHomeSectors, ["home-sectors"], {
  revalidate: HOUR_S,
  tags: [HOME_CACHE_TAG],
});

export const getEmirateChips = unstable_cache(readEmirateChips, ["home-emirates"], {
  revalidate: HOUR_S,
  tags: [HOME_CACHE_TAG],
});

export const getVerifiedSlots = unstable_cache(readVerifiedSlots, ["home-verified-slots"], {
  revalidate: FIVE_MIN_S,
  tags: [HOME_CACHE_TAG],
});

export const getNewCatalogueProducts = unstable_cache(readNewCatalogueProducts, ["home-products"], {
  revalidate: FIVE_MIN_S,
  tags: [HOME_CACHE_TAG],
});

/*
   Two tags, because two different people change this band.

   `HOME_CACHE_TAG` is the content editor putting a trade on the front page.
   `PLAN_CACHE_TAG` is somebody editing a plan in `/admin/plans`, which used to
   reach the admin screens immediately and this band up to an hour later —
   board 1l criterion 2 says the figures here and on `/pricing` are identical
   for the same plan, and one invalidator over two caches is how that stopped
   being true.
*/
export const getHomePlans = unstable_cache(readHomePlans, ["home-plans"], {
  revalidate: HOUR_S,
  tags: [HOME_CACHE_TAG, PLAN_CACHE_TAG],
});

