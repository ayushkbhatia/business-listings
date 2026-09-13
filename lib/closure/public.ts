import "server-only";
import { prisma } from "@/lib/db/client";

/**
 * Board `11i` Q5 — what a closed business's URL serves.
 *
 * Answered by the owner on 14 Sep 2026: a plain notice, not indexed, with the
 * retained reviews readable by anyone who has the link. Not a 404, because the
 * business existed and buyers wrote about it; not the storefront, because it is
 * out of the directory and nobody can send it an enquiry.
 *
 * During the cooling-off window the notice is the same one. The public has no
 * business knowing a closure might be reversed, and "not in the directory any
 * more" is true either way.
 */
export interface ClosedListing {
  id: string;
  slug: string;
  displayName: string;
  /** When it came down. */
  closedOn: Date;
}

export async function closedListing(slug: string): Promise<ClosedListing | null> {
  const business = await prisma.business.findUnique({
    where: { slug },
    select: {
      id: true,
      slug: true,
      displayName: true,
      closureRequestedAt: true,
      mergedIntoId: true,
      suspendedAt: true,
    },
  });
  /*
     A merged listing redirects, and a suspended one is a staff decision with its
     own rules about what the public sees. Neither is a closure, and borrowing
     this notice for them would tell a buyer a supplier closed when it did not.
  */
  if (!business?.closureRequestedAt || business.mergedIntoId || business.suspendedAt) return null;
  return {
    id: business.id,
    slug: business.slug,
    displayName: business.displayName,
    closedOn: business.closureRequestedAt,
  };
}
