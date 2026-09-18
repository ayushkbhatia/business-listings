import type { PairedCopy } from "@/lib/i18n/paired";
import type { Availability } from "@/components/domain";

/**
 * Everything the overview's sections render, assembled once.
 *
 * The goods storefront overview is a fixed run of five sections — hero, trust
 * strip, catalogue, reviews, branches — and every one of them reads data the
 * seller already has. So there is one bundle, loaded once per storefront,
 * rather than five components each reaching for the database.
 *
 * Deliberately plain shapes rather than Prisma rows: a component typed to one
 * query is a component that breaks when the query changes.
 *
 * There was a sector template model above this — staff composing, ordering and
 * theming sections per trade, and sellers filling fields a template opened.
 * Boards `5a`, `5b` and `5c` were cut on 15 Sep 2026 and the model went with
 * them, so the run is code and no seller writes anything into it.
 */

export interface StorefrontIdentity {
  slug: string;
  displayName: string;
  description: string | null;
  verificationTier: number;
  verifiedAt: Date | null;
  /** Measured, never claimed. Null where there is not enough to measure. */
  responseTimeMedianMs: number | null;
  establishedYear: number | null;
}

export interface StorefrontLocation {
  id: string;
  type: string;
  emirate: string;
  areaName: string | null;
  addressLine: string;
  /**
   * The landline, masked (`04 88• ••••`) — never the number.
   *
   * Board `1d` amendment `B2`: a storefront section is page payload, and the
   * number behind the reveal form cannot be in it. The number comes back from
   * the reveal, keyed by this location's id.
   */
  maskedPhone: string | null;
  lat: number | null;
  lng: number | null;
}

export interface StorefrontProduct {
  id: string;
  slug: string;
  name: string;
  sku: string | null;
  /** The same union `ProductCard` takes, so no section casts at its call site. */
  availability: Availability;
  stockQty: number | null;
  leadTimeDays: number | null;
  minOrderQty: number | null;
  sizeLabel: string | null;
  imageUrl: string | null;
  /** The product's own category — the trade its compare tick is in (`10d`). */
  categoryId: string;
}

export interface StorefrontReview {
  id: string;
  author: string;
  overall: number;
  body: string;
  sellerReply: string | null;
  /** Staff removed the reply (board 11c `B4`); `sellerReply` is null and a neutral line stands in. */
  replyRemoved?: boolean;
  createdAt: Date;
}

export interface SectionData {
  /**
   * The words the shared sections speak, already resolved for the listing's
   * kind — board `12g-s`. Read through `lib/strings/store.ts`, so a half
   * written on `/admin/strings/paired` reaches a storefront without a deploy.
   */
  copy: PairedCopy;
  business: StorefrontIdentity;
  locations: StorefrontLocation[];
  products: StorefrontProduct[];
  productCount: number;
  reviews: StorefrontReview[];
  reviewSummary: { count: number; average: number | null };
  heroImageUrl: string | null;
}

export interface SectionProps {
  data: SectionData;
  /**
   * Where an enquiry from this storefront goes.
   *
   * Kept for the sections that link rather than compose — a "see the
   * catalogue" style call to action. It must never point at `/rfq/new`:
   * board 1h criterion 3 says a storefront and a catalogue contain no link to
   * the fan-out, because those are single-seller surfaces and a buyer standing
   * on one has already chosen. Sending them to a fan-out undoes the choice.
   */
  enquireHref: string;
  /**
   * The in-place composer, pre-rendered.
   *
   * A node rather than a handler, because the sections are server-rendered and
   * the composer is a client island — a function cannot cross that boundary,
   * which four boards in this repo have each proved once.
   */
  enquireSlot?: React.ReactNode;
}
