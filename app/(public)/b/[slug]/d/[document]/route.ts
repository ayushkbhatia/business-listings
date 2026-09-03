import { notFound, redirect } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { PUBLISHABLE_DOCUMENT_KINDS } from "@/lib/storefront/section-types";
import { signedReadUrl } from "@/lib/storage";

/**
 * A seller's published document, fetched through a link that expires.
 *
 * `business-documents` is a private bucket and stays private. The storefront's
 * Certifications and Downloads sections link here rather than to storage, and
 * this mints a signed URL at request time — which is the only way a link can
 * appear on a page cached for five minutes without outliving its own expiry.
 *
 * Three things are checked, and each of them is the whole point:
 *
 *   1. The document's kind is one a seller chose to publish. A trade licence or
 *      a VAT certificate 404s here even if somebody has its id, because the
 *      seller was told on the upload screen that those are never public.
 *   2. It belongs to the business in the address. Otherwise this is an oracle
 *      for reading any seller's files by guessing ids.
 *   3. That business is publicly visible. An unpublished, merged or suspended
 *      listing has no public surface, and its documents are part of it.
 */

export const dynamic = "force-dynamic";

interface Params {
  params: Promise<{ slug: string; document: string }>;
}

export async function GET(_request: Request, { params }: Params) {
  const { slug, document: documentId } = await params;

  /*
     A document belongs to the seller directly, or to one of their products.

     `Document` carries `businessId` and `productId` independently, and a
     datasheet uploaded against a product has only the second. Board 1g's
     Documents card links here, so matching on `business` alone 404'd every
     product datasheet — the criterion is that a datasheet downloads without an
     enquiry or a login, and it could not download at all.

     Both branches run the same three checks. The product branch reaches the
     business through the product rather than relaxing anything: an unpublished
     product's datasheet is as private as an unpublished listing's, and a draft
     product is not a public surface.
  */
  const visibleBusiness = {
    slug,
    publishedAt: { not: null },
    suspendedAt: null,
    mergedIntoId: null,
  } as const;

  const document = await prisma.document.findFirst({
    where: {
      id: documentId,
      kind: { in: [...PUBLISHABLE_DOCUMENT_KINDS] },
      OR: [
        { business: visibleBusiness },
        { product: { status: { not: "draft" }, business: visibleBusiness } },
      ],
    },
    select: { storagePath: true },
  });

  // 404 rather than 403, for every one of the three refusals. A 403 tells
  // somebody guessing ids which guesses were close.
  if (!document) notFound();

  const url = await signedReadUrl(document.storagePath);
  if (!url) notFound();

  redirect(url);
}
