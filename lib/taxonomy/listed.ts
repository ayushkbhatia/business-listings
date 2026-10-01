import type { Prisma } from "@/lib/db/generated/client";

/**
 * Who counts as a listing: published and not suspended.
 *
 * The population `1a`'s hero counts (`readHomeStats`), `6c` counts
 * (`categoryIndex`) and board `4d`'s tree adds up. A merged listing is
 * unpublished by the merge, so they agree on it without saying so.
 *
 * Its own module, and a pure one, because three boards read it now: the tree,
 * `4f`'s `status=live` filter and `4a`'s *Listings live* tile. A second copy of
 * the predicate in any of them is how the platform's size would come to read
 * two ways on two screens.
 *
 * Type-only Prisma import: this builds an object, it does not touch a client.
 */
export const LISTED = { publishedAt: { not: null }, suspendedAt: null } as const satisfies Prisma.BusinessWhereInput;
