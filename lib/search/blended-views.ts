import type { BlendedDropSuggestion, FacetScopeView, KindBreakdown, ResultKind, TabCounts } from "./blended";
import type { BlendedTab } from "./query";

/**
 * Boards `1c-s`, `10c` and `10c-s` — the result shapes, as plain values.
 *
 * The page and the gallery render the same rows from these, so a specimen
 * cannot show a field the loader never selects. Every field is already worded
 * or already a fact; nothing here is a function, because these cross into the
 * mobile filter sheet's client island.
 *
 * **There is no price in any of them.** A service reads *Fee on enquiry* and a
 * product *Price on enquiry* (`1c-s` B8, B4), and neither shape has a slot an
 * amount could arrive in.
 */

/**
 * One checked credential, as a badge prints it — board `1c-s` B7 and `6a-s`
 * D-REG: the credential's name and the number the register confirmed.
 */
export interface CheckedCredentialView {
  kind: string;
  /** The registry number, where one was checked — `FTA agent 20034512`. */
  identifier: string | null;
}

/** What every row states about the firm behind it. */
export interface ResultFirmFacts {
  businessSlug: string;
  /** Always `displayName` — the name the storefront's `h1` carries. */
  businessName: string;
  /** "Business Bay · Dubai", or null where the firm has published no place. */
  place: string | null;
  /** Null where there is no review to average — never a zero rendered as a rating. */
  rating: { value: number; count: number } | null;
  /** Measured median, or null. Never claimed — `10c`+`10c-s` B5. */
  replyMs: number | null;
  verificationTier: number;
  verifiedAt: string | null;
  /**
   * Register-checked credentials only, and not lapsed — `1c-s` B7, `6a-s` B4.
   * Never a claim: a claim is on the storefront's table, in its own words.
   */
  checkedCredentials: readonly CheckedCredentialView[];
}

export interface ServiceResultView extends ResultFirmFacts {
  kind: "service";
  id: string;
  slug: string;
  name: string;
  /** The firm's scope paragraph, where it wrote one. */
  summary: string | null;
  /** Turnaround, fee basis, delivered, sectors — the filled ones, already worded. */
  chips: readonly string[];
}

export interface SupplierResultView extends ResultFirmFacts {
  kind: "supplier";
  id: string;
  /** The seller's own description or headline. */
  summary: string | null;
  /** Whether the firm sells work — decides *Fee on enquiry* and which storefront word. */
  sellsWork: boolean;
  /**
   * The trade it is filed under — `Q2`, and never `Business.tradeName`.
   *
   * The category's name. A supplier row has to say what the firm supplies, and
   * the one name that may not appear on it is the licence-locked trade name:
   * seller identity is `displayName` everywhere but the storefront's details
   * panel, and a row that reads one name and lands on another is the defect
   * `CLAUDE.md` names first.
   */
  trade: string | null;
  /** "26–50 people", or null. */
  teamLabel: string | null;
  /** The live services named on the row: matched ones first. */
  services: { names: readonly string[]; total: number } | null;
  /** `1c-s` B5 — the firm is here because a service it offers matched. */
  matchedOnService: boolean;
  productCount: number;
  /**
   * `Q2` — what this firm returned on *this* query.
   *
   * The hole both boards left: a Suppliers tab with no specified result shape.
   * A supplier row that repeats the storefront card says nothing a buyer who
   * has just searched needs; one that says *3 products and 1 service match
   * "chiller"* is the reason the tab exists. Zeroes where the firm matched on
   * its own name and nothing it lists did, which is the honest reading of that
   * row and the reason it has a row in Everything at all.
   */
  matched: { products: number; services: number };
}

export interface ProductResultView {
  kind: "product";
  id: string;
  slug: string;
  name: string;
  businessSlug: string;
  businessName: string;
  summary: string | null;
  /** Goods vocabulary, deliberately unchanged: "In stock". */
  availability: string;
  /** True only for `in_stock` — the one chip either board draws in green. */
  inStock: boolean;
  place: string | null;
  /** Spec values worth stating beside the name — `120 TR`, `R-410A`. */
  chips: readonly string[];
  /** Measured median for the firm behind it — B5 puts it on every row of both kinds. */
  replyMs: number | null;
  /** The product's own category — the trade its compare tick is in (`10d`). */
  categoryId: string;
}

export type BlendedResultView = ServiceResultView | SupplierResultView | ProductResultView;

/**
 * Board `6a-s` — one firm on a services landing page.
 *
 * The supplier row's facts (`ResultFirmFacts`: the tier badge, the checked
 * credentials with their numbers, the reply time) plus the three things a
 * landing page says that a search row does not:
 *
 *  - **how the firm reaches the place** — an office there, cover from
 *    elsewhere, or both. The board's premise, stated per row: *"the firms below
 *    are not all physically in the district — they cover it."*
 *  - **the chips the services vocabulary sets** — fee basis, delivered where,
 *    and the sector or free-zone scope — off the firm's lead service in this
 *    trade (`B5`). No amount: a service has a basis, not a number.
 *  - **the services it offers in this trade**, which is what put it here.
 *
 * `place` on the facts is null here: the office line carries the firm's place,
 * once, beside what it covers.
 */
export interface CoverageFirmView extends ResultFirmFacts {
  id: string;
  /** The firm's trade code — `LogoTile`'s honest stand-in where there is no logo. */
  categoryCode: string;
  /** The firm's own description, where it wrote one. */
  summary: string | null;
  /** Fee basis, delivered where, sector or free-zone scope — the filled ones, worded. */
  chips: readonly string[];
  /** Live services in this trade, the ones reaching the place first. */
  services: readonly { name: string; href: string }[];
  /** How many more live services in this trade the row does not name. */
  moreServices: number;
  /** "Deira, Dubai" — the first published branch, or null for a firm with none. */
  office: string | null;
  /** Coverage reaches the page's place — not only an office sitting in it. */
  covers: boolean;
  coverageHref: string;
  claimed: boolean;
  /** Sells work — decides *Fee on enquiry*, as on the supplier row. */
  sellsWork: boolean;
  /** Null for an unclaimed listing: nobody is behind it to answer. */
  enquireHref: string | null;
}

/** How many of a firm's services in the trade a landing row names. */
export const COVERAGE_SERVICES_NAMED = 2;

/** How many service names a supplier row prints before "+ N more". */
export const BUSINESS_SERVICES_NAMED = 2;

/** How many spec chips a product row prints. Three is what the render draws. */
export const PRODUCT_CHIPS_SHOWN = 3;

/**
 * Rows a page of the blended list shows — the twenty goods search shows, and
 * `tests/integration/blended-search-1cs.test.ts` holds the two equal.
 */
export const BLENDED_PAGE_SIZE = 20;

export interface RfqPromptFacts {
  href: string;
  /** How many firms a brief goes to at most. */
  cap: number;
  /** Firms behind the service results with a measured reply, and how many of those answer within a day. */
  measured: number;
  withinDay: number;
}

/**
 * `B10` — the RFQ offer on a zero-result page counts a different query.
 *
 * Zero products match and the offer names *8 matching suppliers*: those eight
 * match the trade and what they do, not the filters that returned nothing. The
 * screen says so rather than letting the two numbers read as one set.
 */
export interface RfqEscapeFacts {
  href: string;
  /**
   * Firms that can answer the words, before any filter, capped at the fan-out's
   * own limit. **Nought where the words found nobody** — the offer still stands
   * and simply states no number.
   */
  suppliers: number;
  cap: number;
}

/** `10c`'s pager, and `Q5`'s answer — a stated window, with both directions. */
export interface PagerFacts {
  /** 1-based, inclusive. Both are 0 on an empty list. */
  from: number;
  to: number;
  total: number;
  page: number;
  pages: number;
}

export function pagerFor(page: number, shown: number, total: number): PagerFacts {
  const from = total === 0 ? 0 : (page - 1) * BLENDED_PAGE_SIZE + 1;
  return {
    from,
    to: total === 0 ? 0 : from + shown - 1,
    total,
    page,
    pages: Math.max(1, Math.ceil(total / BLENDED_PAGE_SIZE)),
  };
}

/**
 * `B9` — a blended set has three zero states, not one, and only the first was
 * drawn.
 *
 * | State | What it means | What the page shows |
 * |---|---|---|
 * | `nothing` | 0 in Everything | the ladder, the RFQ escape, the alert |
 * | `kind` | 0 products, 164 services | **no ladder** — the other kinds' counts and the switch |
 * | (facet) | an option's count is 0 | the option, disabled, with its nought |
 *
 * The middle case is the one that makes blending worth building, and the drawn
 * ladder would be actively wrong there: a buyer told *nobody has listed it*
 * while 164 services match is being told something false.
 *
 * The third is not a page state at all — it is `FacetOptionView.disabled`,
 * which is why it is not in this union.
 */
export type ZeroState = "none" | "nothing" | "kind";

export interface BlendedSearchResult {
  counts: TabCounts;
  /** `B2` said out loud — why the two kind counts do not add up to Suppliers. */
  breakdown: KindBreakdown;
  /** The tab actually in effect, after `B3`'s switch. */
  active: BlendedTab;
  rail: FacetScopeView[];
  rows: BlendedResultView[];
  /** Rows in the narrowed list, for paging. */
  narrowedTotal: number;
  /** Before any facet — what the words found. */
  unfilteredTotal: number;
  zero: ZeroState;
  /** Tabs that still hold something, for the `kind` zero state's switch. */
  elsewhere: BlendedTab[];
  /** `10c`'s ladder. Empty when no single filter helps, or when nothing is filtered. */
  ladder: BlendedDropSuggestion[];
  /** How many filter groups are set — *no single filter helps* needs to know. */
  appliedGroups: number;
  overflow: ResultKind[];
  rfq: RfqPromptFacts | null;
  escape: RfqEscapeFacts | null;
  pager: PagerFacts;
  /**
   * `10c` contribution 1, and `B7`.
   *
   * *Matched on spec fields, not just product names — that is why a DN100
   * search finds "4 inch" too.* Stated only where it is true of this result
   * set: there are words, and products in it. It is the difference between a
   * directory and a search engine, and it belongs on the blended screen.
   */
  specMatched: boolean;
  /** The trade the products scope offers spec fields from, named. Null where none. */
  specTrade: string | null;
}
