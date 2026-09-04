import "server-only";
import { prisma } from "@/lib/db/client";
import { Prisma } from "@/lib/db/generated/client";
import type { Actor } from "@/lib/auth/roles";

/**
 * The buyer shortlist — a supplier kept for later.
 *
 * ## Signed in, and that is the whole check
 *
 * There is no capability here and there should not be one. Every named
 * capability in `lib/auth/capabilities.ts` answers "which roles", and the
 * answer for this is "all of them": a supplier sourcing from another supplier
 * is ordinary trade in this market, which is the reason `enquiry.create` lists
 * every seller role beside `buyer`. A capability every signed-in role holds
 * tests nothing and reads as though it does, so the guard is identity — the
 * actor exists — and nothing more.
 *
 * What it is not is anonymous. The schema states the reason and it is worth
 * repeating at the writer: a list that lives in a browser is lost on the next
 * device, and a buyer whose shortlist evaporates trusts the list less than they
 * trusted their memory. So a signed-out click is refused rather than parked in
 * a cookie, and the refusal is what the button turns into a sign-in link.
 *
 * No audit row. This is a buyer bookmarking, not a staff decision, and
 * `AuditEvent.actorId` is NOT NULL because that log holds decisions —
 * `app/(public)/_results/save-actions.ts` says the same about a saved search.
 */

export type ShortlistRefusal =
  /** No account. The only refusal the button can act on. */
  | "signed_out"
  /** No such supplier, or one no buyer could have reached. */
  | "not_found";

export type ToggleShortlistResult =
  | {
      ok: true;
      /** The state the row is now in, read back from what the write did. */
      saved: boolean;
      /** For the caller's `revalidatePath`. The service already looked it up. */
      slug: string;
    }
  | { ok: false; error: ShortlistRefusal };

export type RemoveShortlistResult = { ok: true; slug: string | null } | { ok: false; error: "signed_out" };

/**
 * Save, or unsave. The caller says which.
 *
 * ## Why the direction is a parameter and not inferred
 *
 * The first version of this read the current state and flipped it, deciding the
 * direction from a `deleteMany` count so the read and the write were one
 * statement. That is a correct toggle and the wrong operation. Two presses a
 * few milliseconds apart — a double tap on a phone, a form resubmitted, a
 * button pressed while the first round trip is still out — are one intention,
 * and a flip applied twice cancels itself: its own test caught the interleaving
 * where the second press deleted the row the first had just written, leaving a
 * buyer who tapped twice with nothing saved and no way to tell.
 *
 * The button already knows the answer: it renders `saved` and moves the label
 * optimistically before the request goes out, so it is holding the state it
 * means to reach. Passing it makes the operation idempotent by construction —
 * `save` twice is `save`, `unsave` twice is `unsave` — and both races land on
 * the state the buyer was looking at when they stopped pressing.
 *
 * `deleteMany` and the caught P2002 stay, and they are what make each direction
 * idempotent on its own: a delete of nothing is fine, and a second insert loses
 * to the unique index rather than to a read that went stale between statements.
 */
export async function toggleShortlist(
  actor: Actor | null,
  businessId: string,
  /** The state to reach. Not the state to leave — see above. */
  next: boolean,
): Promise<ToggleShortlistResult> {
  if (!actor) return { ok: false, error: "signed_out" };

  /*
     Visibility is read here but not applied here.

     Removing must work on a listing that has since been unpublished, suspended
     or merged away — a saved supplier that goes dark and takes its own remove
     button with it is a row the buyer cannot get rid of. Saving is the half
     that is gated, below, after the delete has had its chance.
  */
  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { slug: true, publishedAt: true, suspendedAt: true },
  });
  if (!business) return { ok: false, error: "not_found" };

  if (!next) {
    await prisma.shortlist.deleteMany({ where: { userId: actor.id, businessId } });
    return { ok: true, saved: false, slug: business.slug };
  }

  // A save is only allowed for a listing a buyer could have reached in the
  // first place. The id arrives from the client, and a posted id is a value the
  // client chose. Removing is not gated this way — see above.
  if (!business.publishedAt || business.suspendedAt) return { ok: false, error: "not_found" };

  try {
    await prisma.shortlist.create({ data: { userId: actor.id, businessId } });
  } catch (error) {
    const raced =
      error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
    if (!raced) throw error;
    // The other press got there first. Saving twice is saving once — the schema
    // says so on the unique index, and this is the line that makes it true
    // under two presses that overlap.
  }

  return { ok: true, saved: true, slug: business.slug };
}

/**
 * Remove, in one direction only.
 *
 * The saved-suppliers page removes with a plain form so it works without
 * JavaScript, and a form is a thing browsers resubmit. `toggleShortlist` on a
 * double submit would put the supplier back — correct for a toggle, wrong for a
 * button that says "Remove from shortlist". A delete is idempotent by
 * construction, so the second submit does nothing at all.
 *
 * The slug is null where the business is gone entirely, which is a row the
 * cascade has already taken care of.
 */
export async function removeShortlist(
  actor: Actor | null,
  businessId: string,
): Promise<RemoveShortlistResult> {
  if (!actor) return { ok: false, error: "signed_out" };

  await prisma.shortlist.deleteMany({ where: { userId: actor.id, businessId } });

  const business = await prisma.business.findUnique({
    where: { id: businessId },
    select: { slug: true },
  });
  return { ok: true, slug: business?.slug ?? null };
}

/** Is this supplier on this buyer's list? Reads the unique index directly. */
export async function isShortlisted(userId: string, businessId: string): Promise<boolean> {
  const row = await prisma.shortlist.findUnique({
    where: { userId_businessId: { userId, businessId } },
    select: { id: true },
  });
  return row !== null;
}

/** One saved supplier, flattened for a server component to render. */
export interface SavedSupplier {
  businessId: string;
  slug: string;
  displayName: string;
  verificationTier: number;
  verifiedAt: Date | null;
  visitedAt: Date | null;
  /**
   * False where the listing has since been unpublished, suspended or merged.
   *
   * The row still shows. Dropping it would shrink a list the buyer built
   * without saying why, and "you saved this and it is no longer listed" is the
   * fact they are actually using.
   */
  reachable: boolean;
  savedAt: Date;
}

/**
 * The buyer's list, newest first.
 *
 * Ordered on `(user_id, created_at)`, which is one of the two indexes the model
 * carries — the other is the seller's count below. Both were put there for
 * these two reads and nothing else.
 *
 * Seller identity is `displayName`. A shortlist row links to that supplier's
 * storefront, so a trade name here would mean the buyer reads one name and
 * lands on another.
 */
export async function shortlistFor(userId: string): Promise<SavedSupplier[]> {
  const rows = await prisma.shortlist.findMany({
    where: { userId },
    orderBy: { createdAt: "desc" },
    select: {
      createdAt: true,
      business: {
        select: {
          id: true,
          slug: true,
          displayName: true,
          verificationTier: true,
          verifiedAt: true,
          visitedAt: true,
          publishedAt: true,
          suspendedAt: true,
        },
      },
    },
  });

  return rows.map((row) => ({
    businessId: row.business.id,
    slug: row.business.slug,
    displayName: row.business.displayName,
    verificationTier: row.business.verificationTier,
    verifiedAt: row.business.verifiedAt,
    visitedAt: row.business.visitedAt,
    reachable: row.business.publishedAt !== null && row.business.suspendedAt === null,
    savedAt: row.createdAt,
  }));
}

/**
 * How many buyers kept this supplier.
 *
 * The number board 8a's rail states, and the reason the model is a row per pair
 * rather than a saved query: this is a count of named buyers, not an inference
 * off `ContactReveal.actorId`, three quarters of which is null by design.
 */
export async function shortlistCount(businessId: string): Promise<number> {
  return prisma.shortlist.count({ where: { businessId } });
}
