import type { Availability } from "@/components/domain";
import type { ResolvedSection } from "./sections";

/**
 * Everything the fourteen section types can render, assembled once.
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
  createdAt: Date;
}

export interface StorefrontDocument {
  id: string;
  /**
   * The filename. `Document` has no title column and no validity dates —
   * `filename`, `kind` and `mimeType` are the whole of what a seller gives us
   * about a file.
   *
   * The board's Certifications card draws an expiry beside each one. That needs
   * columns nobody has argued for yet, so the card shows what exists rather
   * than a date the data cannot supply.
   */
  title: string;
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

export interface SectionData {
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
  /** Where an enquiry from this storefront goes. */
  enquireHref: string;
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
