import "server-only";
import { prisma } from "@/lib/db/client";
import { t } from "@/lib/i18n";
import type { Reference } from "./state";

/**
 * Everything that points at a seller's files, in one query per surface.
 *
 * This is the query the board did not have, and the spec says so plainly: it is
 * "the difference between a delete button and a broken customer document". The
 * board's rail card offered to delete 41 files by looking at one column — the
 * absence of a product attachment — and a file with no product attachment can
 * still be the datasheet attached to a quote a buyer is reading right now.
 *
 * ## Live means a buyer can reach it
 *
 * Not "exists". A product in `draft`, or one belonging to a business that is
 * unpublished or suspended, is not a surface anybody is reading — so a missing
 * alt text on it is not a public accessibility failure and is not counted. The
 * same gate every public query in this repo applies.
 *
 * ## Two surfaces named in the spec that cannot be queried yet
 *
 * The spec lists a published guide (`6d`) and an area page (`6a`) as things
 * that can hold a file. Neither model has an image column — `Guide` and
 * `AreaPage` carry copy, a category and a scope, and their images come from the
 * businesses they list rather than from the seller's library. So there is
 * nothing to join to, and inventing a count would be exactly the fabrication
 * this board exists to remove. `ReferenceKind` keeps the two members so that
 * adding the column later is a change here and nowhere else.
 */

/** Batched: one pass per surface, not one query per file. */
export async function referencesFor(
  businessId: string,
  fileIds: readonly string[],
): Promise<Map<string, Reference[]>> {
  const out = new Map<string, Reference[]>();
  for (const id of fileIds) out.set(id, []);
  if (fileIds.length === 0) return out;

  const ids = [...fileIds];
  const push = (fileId: string, reference: Reference) => {
    const list = out.get(fileId);
    if (list) list.push(reference);
  };

  const [business, onProducts, onDocuments, teamMembers, enquiryDocs, quoteDocs, claims, imports] =
    await Promise.all([
      prisma.business.findUnique({
        where: { id: businessId },
        select: { slug: true, publishedAt: true, suspendedAt: true },
      }),
      prisma.productMedia.findMany({
        where: { mediaId: { in: ids } },
        orderBy: { sortOrder: "asc" },
        select: {
          mediaId: true,
          sortOrder: true,
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              slug: true,
              status: true,
              business: { select: { slug: true, publishedAt: true, suspendedAt: true } },
            },
          },
        },
      }),
      prisma.productDocument.findMany({
        where: { documentId: { in: ids } },
        select: {
          documentId: true,
          product: {
            select: {
              id: true,
              name: true,
              sku: true,
              slug: true,
              status: true,
              business: { select: { slug: true, publishedAt: true, suspendedAt: true } },
            },
          },
        },
      }),
      prisma.teamMember.findMany({
        where: { mediaId: { in: ids } },
        select: { mediaId: true, name: true },
      }),
      prisma.document.findMany({
        where: { id: { in: ids }, enquiryId: { not: null } },
        select: { id: true, enquiry: { select: { ref: true } } },
      }),
      /*
         The one that refuses a delete. A quote past `draft` has been sent, and
         the buyer holds a link to whatever it cites — so `status: draft` is the
         only state where the file is still the seller's to remove.
      */
      prisma.quoteAttachment.findMany({
        where: { documentId: { in: ids }, quote: { status: { not: "draft" } } },
        select: { documentId: true, quote: { select: { ref: true } } },
      }),
      prisma.claimSubmission.findMany({
        where: { documentId: { in: ids } },
        select: { documentId: true, id: true },
      }),
      prisma.catalogueImportRequest.findMany({
        where: { documentId: { in: ids } },
        select: { documentId: true, id: true },
      }),
    ]);

  const businessLive = Boolean(business?.publishedAt) && !business?.suspendedAt;

  // Which media the *business itself* carries — cover, logo, gallery. These
  // have no join row; the file's own `kind` and `businessId` are the link.
  const own = await prisma.media.findMany({
    where: { id: { in: ids }, businessId, reviewId: null },
    select: { id: true, kind: true },
  });
  for (const file of own) {
    if (file.kind === "product") continue;
    push(file.id, {
      kind: "storefront",
      label: (SURFACE_LABEL[file.kind] ?? SURFACE_LABEL.storefront!)(),
      ...(business?.slug ? { href: `/b/${business.slug}` } : {}),
      live: businessLive,
    });
  }

  const publicCertificates = await prisma.document.findMany({
    where: { id: { in: ids }, businessId, isPublic: true },
    select: { id: true },
  });
  for (const doc of publicCertificates) {
    /*
       The label names **where it is read**, not what the file is called.
       A reference answers "who is using this?", and `WRAS approval` as the
       answer to that about `WRAS approval` tells a seller nothing — the badge
       on the tile is supposed to name the page a buyer sees it on.
    */
    push(doc.id, {
      kind: "certificate",
      label: CERTIFICATE_SURFACE(),
      ...(business?.slug ? { href: `/b/${business.slug}` } : {}),
      live: businessLive,
    });
  }

  for (const row of onProducts) {
    const product = row.product;
    const live =
      product.status !== "draft" &&
      Boolean(product.business.publishedAt) &&
      !product.business.suspendedAt;
    push(row.mediaId, {
      kind: "product",
      label: product.sku ?? product.name,
      href: `/dashboard/products/${product.id}`,
      live,
      // Position zero is the primary. There is no flag to disagree with the
      // order — see `ProductMedia` in the schema.
      ...(row.sortOrder === 0 ? { primary: true } : {}),
    });
  }

  for (const row of onDocuments) {
    const product = row.product;
    const live =
      product.status !== "draft" &&
      Boolean(product.business.publishedAt) &&
      !product.business.suspendedAt;
    push(row.documentId, {
      kind: "product",
      label: product.sku ?? product.name,
      href: `/dashboard/products/${product.id}`,
      live,
    });
  }

  for (const member of teamMembers) {
    if (!member.mediaId) continue;
    push(member.mediaId, { kind: "team_member", label: member.name, live: businessLive });
  }

  for (const doc of enquiryDocs) {
    push(doc.id, {
      kind: "enquiry",
      label: doc.enquiry?.ref ?? "Enquiry",
      // Private to one buyer and one seller. Not a public surface, so it does
      // not make a missing alt text an accessibility failure — but it is very
      // much a reference, which is the distinction the board missed.
      live: false,
    });
  }

  for (const row of quoteDocs) {
    push(row.documentId, { kind: "sent_quote", label: row.quote.ref, live: false });
  }

  for (const row of claims) {
    if (!row.documentId) continue;
    push(row.documentId, { kind: "claim", label: "Claim submission", live: false });
  }

  for (const row of imports) {
    if (!row.documentId) continue;
    push(row.documentId, { kind: "catalogue_import", label: "Catalogue import", live: false });
  }

  return out;
}

/**
 * What the seller calls the surface a file sits on.
 *
 * Through the catalogue, which they were not. These are as user-visible as any
 * label on the media board — they are the badge on a tile answering "who is
 * using this?" — and they sat here as English literals because
 * `check:tokens` reads JSX under `app` and `components` and never looks in
 * `lib`. Non-negotiable 5 has no carve-out for a lookup table.
 *
 * `visit` read "Site visit" until board 3b came past. The kind is vestigial —
 * nothing has written it since site visits were withdrawn on 5 September, and
 * the enum keeps the label only because dropping a Postgres enum value rewrites
 * the table — but a row that predates the cut would still have rendered the
 * name of a programme that no longer exists.
 */
const CERTIFICATE_SURFACE = () => t("media.surface.certificates");

const SURFACE_LABEL: Record<string, () => string> = {
  cover: () => t("media.surface.cover"),
  logo: () => t("media.surface.logo"),
  gallery: () => t("media.surface.gallery"),
  storefront: () => t("media.surface.storefront"),
  library: () => t("media.surface.library"),
  visit: () => t("media.surface.withdrawn"),
};

/** One file's references. The detail panel's `USED IN`. */
export async function referencesForFile(
  businessId: string,
  fileId: string,
): Promise<Reference[]> {
  const map = await referencesFor(businessId, [fileId]);
  return map.get(fileId) ?? [];
}
