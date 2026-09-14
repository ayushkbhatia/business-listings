import type { BlendedDropSuggestion, FacetGroupView, ResultKind, TabCounts } from "./blended";

/**
 * Board `1c-s` — the three result shapes, as plain values.
 *
 * The page and the gallery render the same rows from these, so a specimen
 * cannot show a field the loader never selects. Every field is already worded
 * or already a fact; nothing here is a function, because these cross into the
 * mobile filter sheet's client island.
 *
 * **There is no price in any of them.** A service reads *Fee on enquiry* and a
 * product *Price on enquiry* (B8, B4), and neither shape has a slot an amount
 * could arrive in.
 */

/** What every row states about the firm behind it. */
export interface ResultFirmFacts {
  businessSlug: string;
  /** Always `displayName` — the name the storefront's `h1` carries. */
  businessName: string;
  /** "Business Bay · Dubai", or null where the firm has published no place. */
  place: string | null;
  /** Null where there is no review to average — never a zero rendered as a rating. */
  rating: { value: number; count: number } | null;
  /** Measured median, or null. Never claimed. */
  replyMs: number | null;
  verificationTier: number;
  verifiedAt: string | null;
  /** Register-checked credential kinds only — B7. */
  checkedCredentials: readonly string[];
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

export interface BusinessResultView extends ResultFirmFacts {
  kind: "business";
  id: string;
  /** The seller's own description or headline. */
  summary: string | null;
  /** Whether the firm sells work — decides *Fee on enquiry* and *View firm*. */
  sellsWork: boolean;
  /** "26–50 people", or null. */
  teamLabel: string | null;
  /** The live services named on the row: matched ones first. */
  services: { names: readonly string[]; total: number } | null;
  /** B5 — the firm is here because a service it offers matched. */
  matchedOnService: boolean;
  productCount: number;
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
  place: string | null;
}

export type BlendedResultView = ServiceResultView | BusinessResultView | ProductResultView;

/** How many service names a business row prints before "+ N more". */
export const BUSINESS_SERVICES_NAMED = 2;

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

export interface BlendedSearchResult {
  counts: TabCounts;
  rail: FacetGroupView[];
  rows: BlendedResultView[];
  /** Rows in the narrowed list, for paging. */
  narrowedTotal: number;
  /** Before any facet — what the words and place found. */
  unfilteredTotal: number;
  suggestion: BlendedDropSuggestion | null;
  overflow: ResultKind[];
  rfq: RfqPromptFacts | null;
}
