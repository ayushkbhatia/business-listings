import type { Emirate } from "@/lib/db/generated/enums";
import type { CoverageScope } from "@/lib/locations/coverage";
import { effectiveCoverage } from "@/lib/locations/service-coverage";

/**
 * Board `6a-s` B1 — which firms a services landing page is about.
 *
 * `6a` answers *which suppliers are in Al Quoz*: a location filter on a branch
 * address. This answers *which firms cover Business Bay*, which is a different
 * question with a different source, and the board says what goes wrong if the
 * first is used for the second: *"Filter on address and the page returns a
 * fraction of its 37 and is wrong rather than thin."* Not one of the three firms
 * the board draws is presented as being in the district.
 *
 * Pure, with no database import, for the reason `lib/search/service-signals.ts`
 * gives: this rule leaves the page. The route, the publish gate, the sitemap,
 * the 6f matrix, the category index, the freshness digest and the nightly
 * position snapshot all have to agree about who is on a page, and seven
 * implementations of *does this firm cover Business Bay for VAT work* is how a
 * matrix comes to promise a page the route then 404s. One function, called by
 * all of them.
 *
 * ## The rule, and where it departs from the board's wording
 *
 * A firm is on the page for a trade and a place when it is **in the trade** and
 * **reaches the place**:
 *
 *  - *In the trade* — a live service filed under the trade (or a trade beneath
 *    it), or the trade among its listed categories. A chartered accountant
 *    filed under audit who publishes a VAT service does VAT work, and a VAT
 *    page that left them out would be short by exactly the firms a buyer most
 *    wants to compare.
 *  - *Reaches the place* — through coverage, **resolved per service**: the
 *    live services in this trade, each through `effectiveCoverage` — its own
 *    rows where it has narrowed itself, the firm's default where it has not.
 *    A firm with no live service in the trade (listed, nothing published yet)
 *    is read on its default, which is what such a service would inherit. Or
 *    through a published branch in the place: an office is presence, and
 *    `1c-s`'s place facet reads a firm the same way — *where its branches are
 *    and where it works*.
 *
 * The board writes *"business coverage is the union of the firm's service
 * rows"*, and its correction 1 says the page lists *business-level* coverage
 * where the fan-out reads per service. The build reads per service on both,
 * and deliberately. A practice whose VAT service is narrowed to Abu Dhabi and
 * whose audit covers Dubai has a Dubai-wide union; listed as a VAT consultant in
 * Business Bay it would be the one firm on the page that told us it does not do
 * that work there. `1h-s`'s amended B5, `3c-s` B8, `12c-s` B4 and `1c-s`'s place
 * facet all settled the same question the same way: the union is the listing's
 * headline, and it routes nothing — here, it lists nothing either. The two sets
 * still differ by construction, which is the board's actual point: the fan-out
 * adds a verified, current licence, a claimed listing, a live service in the
 * trade, the plan's cap and a ceiling of eight.
 *
 * ## A place, at two scales
 *
 * An **area** is reached by a row naming it, or by a row covering its whole
 * emirate — three area rows in Dubai do not add up to Dubai, and an emirate row
 * does reach Business Bay. An **emirate** is reached by any row in it: a firm
 * that works in Business Bay does work in Dubai, which is `12c-s`'s reading of an
 * emirate-wide query and `1c-s`'s reading of an emirate filter. A branch reaches
 * the area it sits in, and the emirate that area is in.
 */

/** A place a landing page is about. `areaId` null is the emirate class. */
export interface LandingPlace {
  emirate: Emirate;
  areaId: string | null;
}

/** One live service, as far as membership cares. */
export interface CoverageService {
  id: string;
  categoryId: string;
  /** This service's own rows. Empty inherits the firm's default. */
  coverage: readonly CoverageScope[];
}

/** One firm, as far as membership cares. Everything else is the caller's. */
export interface CoverageFirm {
  primaryCategoryId: string;
  /** Its other trades — `BusinessCategory`. */
  categoryIds: readonly string[];
  /** Live services only. A draft has no page and answers nothing. */
  services: readonly CoverageService[];
  /** The business default — `service_coverage` rows with no service. */
  coverageDefault: readonly CoverageScope[];
  /** Published branches. */
  branches: readonly { emirate: Emirate; areaId: string }[];
}

/**
 * How a firm reaches the place — what the row's place line may say.
 *
 * `coverage` alone is the case the page exists for: remote, or travelling, and
 * not in the district. `branch` alone is an office there whose services in this
 * trade say nothing about the place, and the row says *office in* rather than
 * *covers*. The distinction is the board's own premise, stated per row.
 */
export type Reach = "coverage" | "branch" | "both";

export interface Membership {
  reach: Reach;
  /** Live services in the trade, in the order given. What the row names. */
  tradeServiceIds: string[];
  /** Of those, the ones whose effective coverage reaches the place. */
  answeringServiceIds: string[];
}

/** Whether one coverage set reaches a place, at either scale. */
export function reachesPlace(set: readonly CoverageScope[], place: LandingPlace): boolean {
  return set.some((scope) => {
    if (scope.emirate !== place.emirate) return false;
    if (place.areaId === null) return true;
    return scope.areaId === null || scope.areaId === place.areaId;
  });
}

/** Whether a branch sits in the place — its own area, or anywhere in the emirate. */
export function branchInPlace(
  branch: { emirate: Emirate; areaId: string },
  place: LandingPlace,
): boolean {
  return place.areaId === null ? branch.emirate === place.emirate : branch.areaId === place.areaId;
}

/**
 * The firm's membership of one page, or null.
 *
 * `trade` is the page's category and everything filed beneath it — the same
 * `categoryIds` the scope object carries, so a service filed under a
 * subcategory counts on its sector's page.
 */
export function membershipOf(
  firm: CoverageFirm,
  trade: ReadonlySet<string>,
  place: LandingPlace,
): Membership | null {
  const inTrade = firm.services.filter((service) => trade.has(service.categoryId));
  const listed =
    trade.has(firm.primaryCategoryId) || firm.categoryIds.some((categoryId) => trade.has(categoryId));
  if (inTrade.length === 0 && !listed) return null;

  const answering = inTrade.filter((service) =>
    reachesPlace(effectiveCoverage(firm.coverageDefault, service.coverage), place),
  );
  const byCoverage =
    inTrade.length > 0 ? answering.length > 0 : reachesPlace(firm.coverageDefault, place);
  const byBranch = firm.branches.some((branch) => branchInPlace(branch, place));
  if (!byCoverage && !byBranch) return null;

  return {
    reach: byCoverage && byBranch ? "both" : byCoverage ? "coverage" : "branch",
    tradeServiceIds: inTrade.map((service) => service.id),
    answeringServiceIds: answering.map((service) => service.id),
  };
}

/**
 * The emirates a firm reaches for one trade — the snapshot's and the category
 * index's question, asked once per firm rather than seven times.
 *
 * Exactly the emirates `membershipOf` would admit it to at emirate scale: an
 * emirate reached by an answering service's effective coverage (or the default,
 * where the firm has no service in the trade) or holding one of its branches.
 */
export function emiratesReached(
  firm: Pick<CoverageFirm, "primaryCategoryId" | "categoryIds" | "coverageDefault"> & {
    services: readonly { categoryId: string; coverage: readonly CoverageScope[] }[];
    branches: readonly { emirate: Emirate }[];
  },
  trade: ReadonlySet<string>,
): Emirate[] {
  const inTrade = firm.services.filter((service) => trade.has(service.categoryId));
  const listed =
    trade.has(firm.primaryCategoryId) || firm.categoryIds.some((categoryId) => trade.has(categoryId));
  if (inTrade.length === 0 && !listed) return [];

  const sets =
    inTrade.length > 0
      ? inTrade.map((service) => effectiveCoverage(firm.coverageDefault, service.coverage))
      : [firm.coverageDefault];
  const out = new Set<Emirate>();
  for (const set of sets) for (const scope of set) out.add(scope.emirate);
  for (const branch of firm.branches) out.add(branch.emirate);
  return [...out];
}

/** Whether a firm is in a trade at all — listed there, or selling a live service in it. */
export function inTrade(firm: CoverageFirm, trade: ReadonlySet<string>): boolean {
  return (
    trade.has(firm.primaryCategoryId) ||
    firm.categoryIds.some((categoryId) => trade.has(categoryId)) ||
    firm.services.some((service) => trade.has(service.categoryId))
  );
}
