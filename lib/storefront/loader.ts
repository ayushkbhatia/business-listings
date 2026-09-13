import "server-only";
import { prisma } from "@/lib/db/client";
import { PUBLISHED } from "@/lib/db/queries/reviews";
import { MEDIA_BUCKET, publicUrl } from "@/lib/storage";
import { PUBLISHABLE_DOCUMENT_KINDS, sectionType } from "./section-types";
import { resolveSections, type ResolvedSection, type SectionRow } from "./sections";
import type { SectionContent, SectionData, SectionWork } from "./render-data";
import type { Availability } from "@/components/domain";
import { rendersFor, type ListingKind } from "./library";
import { sanitiseContent } from "./seller-content";
import { sellsWork, type SellsKindValue } from "./tabs";
import { coveragePageFor, serviceEnquiryVolume, servicesStorefrontFor } from "./services";
import { sortByVolume } from "./services-catalogue";

/**
 * What a storefront renders, loaded once.
 *
 * This is the module that makes criterion 2 true rather than provable. Until it
 * existed, `resolveSections` and the fourteen renderers were a model no public
 * route called, and *"reordering a section changes every live storefront on
 * that template"* was a statement about a function nothing invoked.
 *
 * ## The fence
 *
 * Documents are filtered to `PUBLISHABLE_DOCUMENT_KINDS` **here**, in the
 * query, before anything is assembled. The Certifications and Downloads
 * components filter again, and that is not redundancy for its own sake — they
 * also render on the specimens page against hand-written data that never comes
 * through here. But this is the one that matters for a real seller: a trade
 * licence that never leaves the database cannot reach a page by any route.
 */

/** Sections used where a sector has no live template. */
const DEFAULT_SECTION_TYPES = [
  "header",
  "hero",
  "trust_strip",
  "catalogue_grid",
  "reviews",
  "branches",
  "enquiry_form",
] as const;

/**
 * A template's worth of sections for a business with no template.
 *
 * Four sectors out of six have none, and a directory where two thirds of
 * storefronts render nothing would be a worse outcome than one where they
 * render a sensible default. The ids are synthetic and stable per type, so
 * `StorefrontContent` keyed to a real section can never collide with one.
 */
function defaultSections(): SectionRow[] {
  return DEFAULT_SECTION_TYPES.map((type, index) => {
    const definition = sectionType(type)!;
    return {
      id: `default:${type}`,
      type,
      sortOrder: index,
      enabled: true,
      fixed: definition.fixed,
      singleton: definition.singleton,
      // A default template opens nothing: there is no staff decision behind it,
      // and a field opened by nobody is a field nobody chose to open.
      sellerEditableFields: [],
      showOnMobile: true,
      settings: {},
    };
  });
}

export interface StorefrontPlan {
  sections: ResolvedSection[];
  data: SectionData;
  /** Seller-filled values, by section id. */
  content: Record<string, SectionContent>;
  /** The template's theme, or the seller's own where there is no template. */
  theme: string;
  /** Null where the sector has no live template and the default was used. */
  templateId: string | null;
}

interface BusinessRef {
  id: string;
  slug: string;
  sectorId: string | null;
  themePreset: string | null;
  /**
   * Decides which of a template's sections this storefront shows — board
   * `5c-s`. A sector template can carry a scope grid and a catalogue grid at
   * once, and each store renders the half it has something to put in.
   */
  sellsKind: SellsKindValue;
}

/** The words a shared section speaks for this listing. `both` leads with its catalogue. */
export function listingKind(sellsKind: SellsKindValue): ListingKind {
  return sellsKind === "services" ? "services" : "goods";
}

export async function storefrontPlan(business: BusinessRef): Promise<StorefrontPlan> {
  const template = business.sectorId
    ? await prisma.storefrontTemplate.findFirst({
        where: { sectorId: business.sectorId, status: "live" },
        select: {
          id: true,
          defaultTheme: true,
          sections: {
            select: {
              id: true, type: true, sortOrder: true, enabled: true, fixed: true,
              singleton: true, sellerEditableFields: true, showOnMobile: true, settings: true,
            },
            orderBy: { sortOrder: "asc" },
          },
        },
      })
    : null;

  const sections = resolveSections(template ? template.sections : defaultSections()).filter(
    (section) => rendersFor(section.definition, business.sellsKind),
  );

  const [data, content] = await Promise.all([
    sectionData(business.id, business.slug, {
      kind: listingKind(business.sellsKind),
      work: needsWork(sections, business.sellsKind),
    }),
    template ? sellerContent(business.id, sections) : {},
  ]);

  return {
    sections,
    data,
    content,
    /*
     * The template's theme wins over the seller's own.
     *
     * `Business.themePreset` predates the template model and was written only
     * by the seed. Which of the two a seller may choose from is board 5b's
     * per-template offered set — until that form exists, the template decides
     * and a seller with no template keeps whatever they had.
     */
    theme: template?.defaultTheme ?? business.themePreset ?? "default",
    templateId: template?.id ?? null,
  };
}

/** Whether any section here reads a firm's work, and the firm has any to read. */
function needsWork(sections: readonly ResolvedSection[], sellsKind: SellsKindValue): boolean {
  return sellsWork(sellsKind) && sections.some((section) => section.definition.availableFor === "services");
}

/**
 * Seller-filled values, by section id — through `sanitiseContent`, so only a
 * key the template opened, in its declared shape, with no price in it, reaches
 * a renderer.
 */
async function sellerContent(
  businessId: string,
  sections: readonly Pick<ResolvedSection, "id" | "type" | "sellerEditableFields">[],
): Promise<Record<string, SectionContent>> {
  if (sections.length === 0) return {};
  const byId = new Map(sections.map((section) => [section.id, section]));
  const rows = await prisma.storefrontContent.findMany({
    where: { businessId, sectionId: { in: [...byId.keys()] } },
    select: { sectionId: true, values: true },
  });
  return Object.fromEntries(
    rows.map((row) => [row.sectionId, sanitiseContent(byId.get(row.sectionId)!, row.values)]),
  );
}

/**
 * What a firm that sells work brings to a section — board `5c-s`.
 *
 * Every half comes from the loader its own storefront tab already uses, so a
 * section and the tab it mirrors cannot disagree about a firm: services and
 * per-service coverage from `coveragePageFor` (`1f-s`), credentials, sectors and
 * the union from `servicesStorefrontFor` (`1d-s`), and the order from the
 * 90-day volume `1e-s` sorts by (B8). None of them selects a fee amount.
 */
export async function sectionWorkFor(businessId: string): Promise<SectionWork> {
  const [page, storefront] = await Promise.all([
    coveragePageFor(businessId),
    servicesStorefrontFor(businessId),
  ]);
  const volume = await serviceEnquiryVolume(
    businessId,
    page.rows.map((row) => row.service.id),
  );
  const rows = page.rows.map((row) => ({
    ...row,
    id: row.service.id,
    position: row.service.position,
    engagementType: row.service.engagementType,
    feeBasis: row.service.feeBasis,
    feeBasisLabel: null,
  }));

  const value = (row: (typeof rows)[number], key: string) =>
    row.service.rows.find((entry) => entry.key === key)?.value ?? null;

  return {
    services: sortByVolume(rows, volume).map((row) => ({
      id: row.service.id,
      slug: row.service.slug,
      name: row.service.name,
      scope: row.service.scope,
      engagementType: row.service.engagementType,
      turnaround: value(row, "turnaround"),
      feeBasis: value(row, "fee_basis"),
      deliveredWhere: value(row, "delivered_where"),
      places: row.places.map((place) => ({ emirate: place.emirate, areaId: place.areaId, label: place.label })),
    })),
    credentials: storefront.credentials,
    coverage: storefront.coverage.map((place) => ({
      emirate: place.emirate,
      areaId: place.areaId,
      label: place.label,
    })),
    freeZones: page.freeZones,
    sectors: storefront.sectors,
    deliveryModes: storefront.deliveryModes,
  };
}

/** The data a section preview reads for a real store, for the builder's library screen. */
export async function sectionDataFor(business: {
  id: string;
  slug: string;
  sellsKind: SellsKindValue;
}): Promise<SectionData> {
  return sectionData(business.id, business.slug, {
    kind: listingKind(business.sellsKind),
    work: sellsWork(business.sellsKind),
  });
}

/** Everything the section types can read, for one business. */
async function sectionData(
  businessId: string,
  slug: string,
  options: { kind: ListingKind; work: boolean },
): Promise<SectionData> {
  const [business, products, productCount, reviews, documents, media, team, work] = await Promise.all([
    prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: {
        displayName: true, tradeName: true, description: true, verificationTier: true,
        verifiedAt: true, responseTimeMedianMs: true, establishedYear: true,
        locations: {
          where: { published: true },
          // Same order the storefront's own loader uses — see
          // lib/db/queries/business.ts. `id` last so the branch list does not
          // reorder between two loads of one page.
          orderBy: [{ type: "asc" }, { createdAt: "asc" }, { id: "asc" }],
          select: {
            id: true, type: true, emirate: true, addressLine: true, phone: true,
            area: { select: { name: true, lat: true, lng: true } },
          },
        },
      },
    }),
    prisma.product.findMany({
      where: { businessId, status: "live" },
      /*
         `id` last. An imported catalogue shares one `created_at` across every
         row of the file — `CURRENT_TIMESTAMP` is the transaction's start time —
         so without it *which twelve products a buyer sees* is whatever order
         the scan happened to produce, and it can differ between two loads of
         the same storefront.
      */
      orderBy: [{ availability: "asc" }, { createdAt: "desc" }, { id: "desc" }],
      take: 12,
      select: {
        id: true, slug: true, name: true, sku: true, availability: true,
        stockQty: true, leadTimeDays: true, minOrderQty: true,
      },
    }),
    prisma.product.count({ where: { businessId, status: { not: "draft" } } }),
    prisma.review.findMany({
      // Published only: a held review is off every public surface while the
      // hold stands, exactly as a removed one is off it for good.
      where: { businessId, ...PUBLISHED },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      take: 6,
      select: {
        id: true, overall: true, body: true, sellerReply: true, createdAt: true,
        showCompanyName: true,
        buyer: { select: { fullName: true, buyerCompany: { select: { name: true } } } },
      },
    }),
    prisma.document.findMany({
      /*
       * The fence, in the query. A trade licence that never leaves the database
       * cannot reach a page by any route — which is a stronger guarantee than
       * a component that remembers to filter.
       */
      /*
         And `isPublic`, which is the seller's own decision on top of the kind
         fence. A document becomes public because somebody said so, never
         because it was uploaded — the column defaults to false for exactly that
         reason.

         `reviewedAt` is the other half, added by board 3e. The seller's wish to
         publish is not on its own a licence to publish: a certificate reaches
         this block only once a moderator has looked at it, which is what makes
         `In review · 2 working days` on the seller's screen a description of
         where the file actually is rather than a courtesy. Two columns because
         they record two people's decisions — collapsed into one, either the
         seller publishes unreviewed or the moderator publishes something the
         seller asked to hide.
      */
      where: {
        businessId,
        isPublic: true,
        reviewedAt: { not: null },
        kind: { in: [...PUBLISHABLE_DOCUMENT_KINDS] },
      },
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        filename: true,
        displayName: true,
        validUntil: true,
        kind: true,
      },
    }),
    prisma.media.findMany({
      where: { businessId, kind: { in: ["storefront", "cover", "logo"] } },
      orderBy: { sortOrder: "asc" },
      select: { id: true, kind: true, storagePath: true, alt: true },
    }),
    prisma.teamMember.findMany({
      where: { businessId },
      orderBy: { sortOrder: "asc" },
      select: {
        id: true, name: true, role: true, phone: true,
        media: { select: { storagePath: true } },
      },
    }),
    options.work ? sectionWorkFor(businessId) : Promise.resolve(null),
  ]);

  const cover = media.find((entry) => entry.kind === "storefront" || entry.kind === "cover");
  const logo = media.find((entry) => entry.kind === "logo");

  return {
    kind: options.kind,
    work,
    business: {
      slug,
      displayName: business.displayName,
      tradeName: business.tradeName,
      description: business.description,
      verificationTier: business.verificationTier,
      verifiedAt: business.verifiedAt,
      responseTimeMedianMs: business.responseTimeMedianMs,
      establishedYear: business.establishedYear,
      logoUrl: logo ? publicUrl(MEDIA_BUCKET, logo.storagePath) : null,
    },
    locations: business.locations.map((location) => ({
      id: location.id,
      type: location.type,
      emirate: location.emirate,
      areaName: location.area?.name ?? null,
      addressLine: location.addressLine,
      phone: location.phone,
      lat: location.area?.lat ?? null,
      lng: location.area?.lng ?? null,
    })),
    products: products.map((product) => ({
      id: product.id,
      slug: product.slug,
      name: product.name,
      sku: product.sku,
      availability: product.availability as Availability,
      stockQty: product.stockQty,
      leadTimeDays: product.leadTimeDays,
      minOrderQty: product.minOrderQty,
      // Filled by the caller where a spec template is loaded; the storefront
      // does not load one per product just to label a card.
      sizeLabel: null,
      imageUrl: null,
    })),
    productCount,
    categories: [],
    reviews: reviews.map((review) => ({
      id: review.id,
      /*
         The buyer's company, or nothing.

         Never the person. "Show my company name" is consent to publish a
         company; a buyer with none on file did not thereby agree to have their
         own name on a supplier's shop window. The storefront section and
         `/b/:slug/reviews` resolve this identically — the same record must not
         read two ways on two tabs of one storefront.
      */
      author: review.showCompanyName ? (review.buyer.buyerCompany?.name ?? "") : "",
      overall: review.overall,
      body: review.body,
      sellerReply: review.sellerReply,
      createdAt: review.createdAt,
    })),
    reviewSummary: {
      count: reviews.length,
      average:
        reviews.length === 0
          ? null
          : reviews.reduce((sum, review) => sum + review.overall, 0) / reviews.length,
    },
    documents: documents.map((document) => ({
      id: document.id,
      /*
         The name a buyer would use, never the filename.

         This was `document.filename` — whatever came off the seller's desktop,
         rendered onto their shop window. "scan_0043_final.pdf" is the polite
         version; the impolite one is a filename containing their licence
         number. A public document is now required by the database to carry a
         display name, so the fallback here is for rows that predate that and
         should not be public anyway.
      */
      title: document.displayName ?? document.filename,
      validUntil: document.validUntil,
      kind: document.kind,
      // A route, never the storage path. The bucket is private and stays that
      // way; the route signs a link at request time.
      href: `/b/${slug}/d/${document.id}`,
    })),
    brands: media
      .filter((entry) => entry.kind === "logo")
      .map((entry) => ({
        id: entry.id,
        name: entry.alt ?? "",
        logoUrl: publicUrl(MEDIA_BUCKET, entry.storagePath),
      })),
    team: team.map((member) => ({
      id: member.id,
      name: member.name,
      role: member.role,
      phone: member.phone,
      photoUrl: member.media ? publicUrl(MEDIA_BUCKET, member.media.storagePath) : null,
    })),
    specRows: [],
    heroImageUrl: cover ? publicUrl(MEDIA_BUCKET, cover.storagePath) : null,
  };
}
