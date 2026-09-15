import type { PairedCopy } from "@/lib/i18n/paired";
import type { Availability } from "@/components/domain";
import type { CredentialKind } from "@/lib/db/generated/enums";
import type { ResolvedSection } from "./sections";
import type { ListingKind } from "./library";

/**
 * Everything the section types can render, assembled once.
 *
 * Every section reads from data the seller already has — that is the whole
 * point of the model, and it is why enabling one is a click for staff and no
 * content work for the seller. So there is one bundle, loaded once per
 * storefront, rather than fourteen components each reaching for the database.
 *
 * Deliberately plain shapes rather than Prisma rows. The specimens page feeds
 * these components sample data and the storefront feeds them query results; a
 * component typed to one query is a component that breaks when the other
 * changes.
 */

export interface StorefrontIdentity {
  slug: string;
  displayName: string;
  tradeName: string;
  description: string | null;
  verificationTier: number;
  verifiedAt: Date | null;
  /** Measured, never claimed. Null where there is not enough to measure. */
  responseTimeMedianMs: number | null;
  establishedYear: number | null;
  logoUrl: string | null;
}

export interface StorefrontLocation {
  id: string;
  type: string;
  emirate: string;
  areaName: string | null;
  addressLine: string;
  phone: string | null;
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

export interface StorefrontDocument {
  id: string;
  /**
   * The name a buyer would use — "ISO 9001:2015", not "scan_0043_final.pdf".
   *
   * This used to be the raw filename, and the note here used to say that
   * `Document` had no title column and no validity dates, so the card showed
   * what existed rather than a date the data could not supply. Board 1d argued
   * for those columns and they exist: `display_name` and `valid_until`, with a
   * CHECK refusing a public document that has no name.
   */
  title: string;
  /**
   * Validity, or null for a document that does not expire.
   *
   * Rendered to the month. The board asks for the month rather than the day on
   * purpose — "expires March 2027" is the fact a buyer uses, and a precise date
   * invites a page that looks wrong for the twenty-four hours around it.
   */
  validUntil?: Date | null;
  /** Always one of `PUBLISHABLE_DOCUMENT_KINDS`. The loader fences it. */
  kind: string;
  /**
   * Where to go to read it — a route, never the storage path.
   *
   * The bucket is private and stays private. The route mints a signed link at
   * request time, which is the only way a link can appear on a page that is
   * cached for five minutes without the link outliving its expiry.
   */
  href: string;
}

export interface StorefrontBrand {
  id: string;
  name: string;
  logoUrl: string | null;
}

export interface StorefrontTeamMember {
  id: string;
  name: string;
  role: string;
  /** The branch line unless somebody chose otherwise. Never a sign-in number. */
  phone: string | null;
  photoUrl: string | null;
}

export interface StorefrontSpecRow {
  label: string;
  /** One cell per product in `products`, in the same order. */
  values: (string | null)[];
}

/**
 * A service, as a section reads it — board `5c-s`.
 *
 * The raw scope-sheet values for the four fields `1e-s` compares, null where
 * the firm has not said. Worded by the renderer, because a loader has no
 * business calling `t()`; and never a fee amount, because the loader behind it
 * is `publicServicesFor`, which does not select one.
 */
export interface SectionService {
  id: string;
  slug: string;
  name: string;
  /** The firm's own scope paragraph — the deliverable line under the name. */
  scope: string | null;
  engagementType: string | null;
  turnaround: string | null;
  /** The family's own label for it, already a word. */
  feeBasis: string | null;
  deliveredWhere: string | null;
  /** This service's effective coverage: its own rows, else the default (`1f-s` B1). */
  places: SectionPlace[];
}

export interface SectionPlace {
  emirate: string;
  /** Null for the whole emirate. */
  areaId: string | null;
  /** The area's name, or the emirate's where the claim is emirate-wide. */
  label: string;
}

export interface SectionCredential {
  id: string;
  kind: CredentialKind;
  identifier: string | null;
  issuer: string | null;
  expiresOn: Date | null;
  verified: boolean;
  verifiedBy: string | null;
}

/**
 * What a firm that sells work brings to a section. Null for one that does not.
 *
 * Loaded only when a template carries a services section and the listing sells
 * work — a goods storefront pays nothing for a scope grid it will never render.
 */
export interface SectionWork {
  /** In the public list's order — 90-day enquiry volume, seller order breaking ties (B8). */
  services: SectionService[];
  credentials: SectionCredential[];
  /** The union of every published service's coverage, as the overview prints it. */
  coverage: SectionPlace[];
  /** Free-zone registrations: a qualifier printed beside a place, never a place. */
  freeZones: { emirate: string; name: string }[];
  sectors: { label: string; engagements: number | null }[];
  /** How the work reaches a client — `2d-s`'s answer, printed with the union. */
  deliveryModes: string[];
}

export interface SectionData {
  /**
   * Which words a shared section speaks — B5.
   *
   * A firm that sells both leads with its catalogue, so its shared sections
   * speak goods; the services half renders in its own sections beside them.
   */
  kind: ListingKind;
  /**
   * The words the shared sections speak, already resolved for `kind` — board
   * `12g-s`. Read through `lib/strings/store.ts` for a real store, so a half
   * written on `/admin/strings/paired` reaches it without a deploy; a specimen
   * carries the code defaults.
   */
  copy: PairedCopy;
  work: SectionWork | null;
  business: StorefrontIdentity;
  locations: StorefrontLocation[];
  products: StorefrontProduct[];
  productCount: number;
  categories: { id: string; name: string; count: number }[];
  reviews: StorefrontReview[];
  reviewSummary: { count: number; average: number | null };
  documents: StorefrontDocument[];
  brands: StorefrontBrand[];
  team: StorefrontTeamMember[];
  specRows: StorefrontSpecRow[];
  heroImageUrl: string | null;
}

/** What one seller filled into one section. Only keys the template opened. */
export type SectionContent = Record<string, unknown>;

export interface SectionProps {
  section: ResolvedSection;
  data: SectionData;
  content: SectionContent;
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
   * A node rather than a handler, because the section system is server-rendered
   * and the composer is a client island — a function cannot cross that
   * boundary, which four boards in this repo have each proved once.
   */
  enquireSlot?: React.ReactNode;
  /**
   * Rendered in the builder rather than on a storefront — board `5c-s`.
   *
   * A storefront drops an empty section or says the buyer's version of why. A
   * preview says the seller's: *no services published yet, and here is what
   * fills it* — the seller needs to see what a section will do before it has
   * anything to do it with.
   */
  preview?: boolean;
}

/** A seller-filled line, or the template's own fallback. */
export function line(content: SectionContent, key: string, fallback = ""): string {
  const value = content[key];
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

/** A seller's picks, as ids. Anything that is not a list of strings is none. */
export function picks(content: SectionContent, key: string): string[] {
  const value = content[key];
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}
