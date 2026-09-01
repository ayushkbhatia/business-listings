import "server-only";
import { unstable_cache } from "next/cache";
import { prisma } from "@/lib/db/client";
import { VERIFIED_TIER } from "@/lib/verification";
import { detectIdentityLeak } from "@/lib/enquiry/redaction";
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
 * instead. That is what makes putting a trade on the home page visible.
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
 * The five "Popular:" chips — the most-searched terms of the last thirty days
 * that returned something.
 *
 * `resultCount > 0` is the load-bearing half. A chip is a promise that there is
 * something behind it, and the most-searched term on a young directory is
 * frequently one nobody can supply; sending a buyer from the home page to an
 * empty results page is worse than showing them one chip fewer.
 *
 * Grouped on the normalised form and rendered as the most recent raw spelling,
 * so "DN100 gate valve" and "dn100 gate valve" are one chip and it reads the
 * way somebody actually typed it.
 *
 * Returns an empty array when there is no history. The caller falls back to the
 * seeded five — a fresh install has no search log and the row should still have
 * something in it.
 */
export async function readPopularQueries(take = 5): Promise<string[]> {
  const grouped = await prisma.searchQueryLog.groupBy({
    by: ["normalised"],
    where: { createdAt: { gte: ago(30) }, resultCount: { gt: 0 } },
    _count: { normalised: true },
    orderBy: { _count: { normalised: "desc" } },
    take,
  });
  if (grouped.length === 0) return [];

  // One more read to recover the spelling. Grouping on the raw text instead
  // would split a term across its capitalisations and none of them would rank.
  const spellings = await prisma.searchQueryLog.findMany({
    where: { normalised: { in: grouped.map((row) => row.normalised) } },
    distinct: ["normalised"],
    orderBy: { createdAt: "desc" },
    select: { normalised: true, query: true },
  });
  const bySpelling = new Map(spellings.map((row) => [row.normalised, row.query]));

  return grouped.map((row) => bySpelling.get(row.normalised) ?? row.normalised);
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
export async function readOpenRfqTeasers(take = 4): Promise<RfqTeaser[]> {
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
    orderBy: { createdAt: "desc" },
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
        orderBy: { createdAt: "asc" },
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

/**
 * The sector grid.
 *
 * Two rules from the board, both of which look like ordering and are not:
 *
 *   - **Ordered by listing count descending**, so the grid reflects what the
 *     directory actually has rather than the order somebody typed the taxonomy
 *     in. A sector that recruits well climbs without anyone editing anything.
 *   - **Each card teases its four largest subcategories**, not the first four
 *     alphabetically. "Cement · Steel · Aggregates · Formwork" tells a buyer
 *     what this trade is here; four subcategories with two listings between
 *     them tells them nothing and is what alphabetical order would give.
 *
 * `showOnHome` is the gate, and it is the ops lead's. `lib/content/homepage.ts`
 * refuses to set it while a sector's own landing page is too thin to publish,
 * because the home page is the most-linked page on the site and a link from it
 * to a thin page is the most expensive kind. That refusal is the reason this
 * query does not simply list all twelve sectors: six of them have no listings,
 * and six cards reading zero would be both honest and useless.
 */
export async function readHomeSectors(): Promise<HomeSector[]> {
  const sectors = await prisma.category.findMany({
    where: { showOnHome: true, parentId: null },
    select: {
      id: true,
      slug: true,
      name: true,
      code: true,
      _count: { select: { primaryFor: { where: PUBLIC_BUSINESS } } },
      children: {
        select: {
          name: true,
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
        .filter((child) => child._count.primaryFor > 0)
        .sort((a, b) => b._count.primaryFor - a._count.primaryFor || a.name.localeCompare(b.name))
        .slice(0, 4)
        .map((child) => child.name),
    }))
    .sort((a, b) => b.listings - a.listings || a.name.localeCompare(b.name));
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
 * Businesses whose verification tier *rose* inside the window.
 *
 * Read from the audit log, not from `verifiedAt`. A date says when somebody
 * looked; it does not say the tier went up, and a re-check that confirmed an
 * existing tier would put a supplier in a section headed "Verified this week"
 * having earned nothing that week. `AuditEvent` is the only record of the
 * change itself, which is one more thing non-negotiable 3 pays for.
 *
 * The window widens 7 → 14 → 30 and then gives up. The section is dropped
 * rather than filled from general listings: "a card here must be genuinely
 * newly verified or the section is a lie."
 *
 * Ordered by tier descending then by recency, so a site visit outranks a
 * licence check on the same day.
 */
export async function readRecentlyVerified(take = 4) {
  for (const window of [7, 14, 30]) {
    const events = await prisma.auditEvent.findMany({
      where: { action: "tier_change", createdAt: { gte: ago(window) } },
      orderBy: { createdAt: "desc" },
      select: { subject: true, before: true, after: true, createdAt: true },
    });

    /*
       `before` and `after` are Json. Filtering on a JSON path in Postgres is
       possible and would move this into the database, but the table is the
       audit log — small, append-only, and read here at most once every five
       minutes behind a cache. Comparing in JS keeps the rule legible, and the
       rule is the point: the tier has to have gone *up*.
    */
    const rose = new Map<string, Date>();
    for (const event of events) {
      const before = (event.before as { verificationTier?: number } | null)?.verificationTier;
      const after = (event.after as { verificationTier?: number } | null)?.verificationTier;
      if (typeof before !== "number" || typeof after !== "number" || after <= before) continue;

      const id = event.subject.startsWith("Business:") ? event.subject.slice("Business:".length) : null;
      if (!id || rose.has(id)) continue;
      rose.set(id, event.createdAt);
    }
    if (rose.size === 0) continue;

    const businesses = await prisma.business.findMany({
      where: { id: { in: [...rose.keys()] }, ...PUBLIC_BUSINESS },
      include: {
        primaryCategory: { select: { name: true, code: true } },
        locations: { where: { published: true }, include: { area: true }, take: 1 },
        _count: { select: { products: { where: { status: { not: "draft" } } } } },
      },
    });

    if (businesses.length === 0) continue;

    return businesses
      .sort((a, b) => {
        if (b.verificationTier !== a.verificationTier) return b.verificationTier - a.verificationTier;
        return (rose.get(b.id)?.getTime() ?? 0) - (rose.get(a.id)?.getTime() ?? 0);
      })
      .slice(0, take);
  }

  return [];
}

export type RecentlyVerified = Awaited<ReturnType<typeof getRecentlyVerified>>[number];

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
export async function readNewCatalogueProducts(take = 5) {
  const candidates = await prisma.product.findMany({
    where: {
      status: { not: "draft" },
      createdAt: { gte: ago(7) },
      business: { ...PUBLIC_BUSINESS, verificationTier: { gte: VERIFIED_TIER } },
    },
    orderBy: { createdAt: "desc" },
    take: take * 8,
    include: {
      category: { select: { id: true, name: true } },
      media: { orderBy: { sortOrder: "asc" }, take: 1 },
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
      photoLimit: true,
      enquiriesPerMonth: true,
      customDomain: true,
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

export const getPopularQueries = unstable_cache(readPopularQueries, ["home-popular"], {
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

export const getRecentlyVerified = unstable_cache(readRecentlyVerified, ["home-verified"], {
  revalidate: FIVE_MIN_S,
  tags: [HOME_CACHE_TAG],
});

export const getNewCatalogueProducts = unstable_cache(readNewCatalogueProducts, ["home-products"], {
  revalidate: FIVE_MIN_S,
  tags: [HOME_CACHE_TAG],
});

export const getHomePlans = unstable_cache(readHomePlans, ["home-plans"], {
  revalidate: HOUR_S,
  tags: [HOME_CACHE_TAG],
});

