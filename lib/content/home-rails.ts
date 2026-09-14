import "server-only";
import {
  getCuratedQueries,
  getEmirateChips,
  getHomePlans,
  getHomeSectors,
  getNewCatalogueProducts,
  getOpenRfqTeasers,
  getVerifiedSlots,
  HOME_CATALOGUE_LIMIT,
  HOME_RFQ_LIMIT,
  HOME_SECTOR_LIMIT,
} from "@/lib/db/queries/home";
import { directoryFooterKeyCount } from "./directory-footer";
import { CHIP_CAP, HOME_HEADLINE, SLOT_COUNT } from "./homepage-rules";

/**
 * Board 6h — every rail on the home page, and which of them a person chooses.
 *
 * Before this, nothing recorded which rails were curated and which computed, so
 * any question about the home page started with somebody reading the code. The
 * map is half the board for that reason.
 *
 * The item counts are what the page is rendering, read through the page's own
 * cached getters (`B5`): the sector count is `readHomeSectors`'s length, not a
 * figure typed here, and a rail that shows three of its four is reported as
 * three. The two string rails count the catalogue keys the page reads.
 */

export type RailKey =
  | "headline"
  | "popular"
  | "rfqs"
  | "verified"
  | "categories"
  | "emirates"
  | "catalogue"
  | "plans"
  | "footer";

export type RailSource = "strings" | "curated" | "live" | "listing_count" | "last_published" | "plan_table";

export interface HomeRail {
  key: RailKey;
  source: RailSource;
  /** The board that owns a computed rail. Null for the two curated here. */
  board: string | null;
  /** Where that board's screen is, when it has one. */
  href: string | null;
  /** What the rail is showing right now. */
  count: number;
  /** The most it shows, where it has a cap. */
  limit: number | null;
}

export async function homeRails(): Promise<HomeRail[]> {
  const [chips, rfqs, slots, sectors, emirates, products, plans] = await Promise.all([
    getCuratedQueries(),
    getOpenRfqTeasers(),
    getVerifiedSlots(),
    getHomeSectors(),
    getEmirateChips(),
    getNewCatalogueProducts(),
    getHomePlans(),
  ]);

  return [
    { key: "headline", source: "strings", board: "12g-s", href: "/admin/strings", count: Object.keys(HOME_HEADLINE).length, limit: null },
    { key: "popular", source: "curated", board: null, href: null, count: chips.length, limit: CHIP_CAP },
    { key: "rfqs", source: "live", board: "1h", href: null, count: rfqs.length, limit: HOME_RFQ_LIMIT },
    { key: "verified", source: "curated", board: null, href: null, count: slots.length, limit: SLOT_COUNT },
    { key: "categories", source: "listing_count", board: "6c", href: "/admin/categories", count: sectors.length, limit: HOME_SECTOR_LIMIT },
    { key: "emirates", source: "listing_count", board: "12h", href: null, count: emirates.chips.length, limit: null },
    { key: "catalogue", source: "last_published", board: "1e", href: null, count: products.length, limit: HOME_CATALOGUE_LIMIT },
    { key: "plans", source: "plan_table", board: "2e", href: "/admin/plans", count: plans.length, limit: null },
    { key: "footer", source: "strings", board: "12g-s", href: "/admin/strings", count: directoryFooterKeyCount(), limit: null },
  ];
}
