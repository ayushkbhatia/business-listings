import "server-only";
import { maskPhone } from "@/lib/format/phone";
import { prisma } from "@/lib/db/client";
import { PUBLISHED } from "@/lib/db/queries/reviews";
import { copiesFrom } from "@/lib/i18n/paired";
import { readEntryRows } from "@/lib/strings/store";
import { MEDIA_BUCKET, publicUrl } from "@/lib/storage";
import type { SectionData } from "./render-data";
import type { Availability } from "@/components/domain";
import type { SellsKindValue } from "./tabs";

/**
 * What a goods storefront's overview renders, loaded once.
 *
 * Every section on the overview reads from this bundle, so the page issues one
 * set of queries however many sections it draws. A firm that sells only work
 * never reaches here — `/b/[slug]` hands it to the services storefront first.
 */
export async function storefrontData(business: {
  id: string;
  slug: string;
  sellsKind: SellsKindValue;
}): Promise<SectionData> {
  const businessId = business.id;
  const [row, products, productCount, reviews, cover, copies] = await Promise.all([
    prisma.business.findUniqueOrThrow({
      where: { id: businessId },
      select: {
        displayName: true, description: true, verificationTier: true,
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
        id: true, overall: true, body: true, sellerReply: true, replyRemovedAt: true, createdAt: true,
        showCompanyName: true,
        buyer: { select: { fullName: true, buyerCompany: { select: { name: true } } } },
      },
    }),
    prisma.media.findFirst({
      where: { businessId, kind: { in: ["storefront", "cover"] } },
      orderBy: [{ sortOrder: "asc" }, { id: "asc" }],
      select: { storagePath: true },
    }),
    /*
       Board `12g-s`. Uncached, and on purpose: this loader runs outside a
       request in the storefront suites, where `unstable_cache` has no store,
       and the page that calls it is regenerated at most every five minutes —
       one small read per regeneration, not per visit.
    */
    readEntryRows().then(copiesFrom),
  ]);

  return {
    // A firm that sells both leads with its catalogue, so its shared sections speak goods.
    copy: copies[business.sellsKind === "services" ? "services" : "goods"],
    business: {
      slug: business.slug,
      displayName: row.displayName,
      description: row.description,
      verificationTier: row.verificationTier,
      verifiedAt: row.verifiedAt,
      responseTimeMedianMs: row.responseTimeMedianMs,
      establishedYear: row.establishedYear,
    },
    locations: row.locations.map((location) => ({
      id: location.id,
      type: location.type,
      emirate: location.emirate,
      areaName: location.area?.name ?? null,
      addressLine: location.addressLine,
      maskedPhone: location.phone ? maskPhone(location.phone) : null,
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
      // Board 11c `B4`: a reply staff took down keeps its text on the row as the
      // record, and no public reader renders it. This one did.
      sellerReply: review.replyRemovedAt ? null : review.sellerReply,
      replyRemoved: review.replyRemovedAt !== null,
      createdAt: review.createdAt,
    })),
    reviewSummary: {
      count: reviews.length,
      average:
        reviews.length === 0
          ? null
          : reviews.reduce((sum, review) => sum + review.overall, 0) / reviews.length,
    },
    heroImageUrl: cover ? publicUrl(MEDIA_BUCKET, cover.storagePath) : null,
  };
}
