import "server-only";
import { redirect } from "next/navigation";
import { getActor } from "@/lib/auth/session";
import { signInHref } from "@/lib/auth/next-path";
import type { Actor } from "@/lib/auth/roles";

/**
 * Who is acting on a buyer's own pages.
 *
 * The third seat. `requireSellerSeat()` has existed since handoff 2 and
 * `requireStaff()` since handoff 4; the buyer surface had neither, so its three
 * pages each resolved an actor and built a redirect inline. Three is the number
 * at which that still looks like a coincidence — docs/routes.md names seven.
 *
 * ## It redirects where the other two 404
 *
 * A seller who guesses `/dashboard/leads` and a signed-out visitor who guesses
 * `/admin/queue` both get `notFound()`, because on those surfaces the existence
 * of the URL is itself information — the console is undiscoverable only while
 * nothing advertises it.
 *
 * `/account/*` is the opposite: it is linked from the directory nav, its
 * existence is public, and the person reaching it signed out is almost always
 * the account holder on a new device. Sending them to a 404 would be a lie
 * about a page they own. So this redirects to sign-in and carries them back.
 *
 * ## The company is carried, and scoped where it binds
 *
 * `buyerCompanyId` rides along because `Actor` carries it. Since board 7b it is
 * the mirror of the person's active `buyer_company_member` row, and the
 * company's own rules are enforced in `lib/buyer-company/` — under the
 * company's lock, from the membership record — rather than here, because a
 * seat read at the top of a page is not the answer at the moment of a write.
 */
export interface BuyerSeat {
  actor: Actor;
  /**
   * The buyer company this person sends enquiries for, when they have one.
   *
   * Absent rather than null for the same reason as `Actor.branchId` — a
   * scoping check reads the absence, and null is a different answer from
   * "unscoped".
   */
  buyerCompanyId?: string;
}

/** The seat, or null. For a page with something to show a signed-out visitor. */
export async function getBuyerSeat(): Promise<BuyerSeat | null> {
  const actor = await getActor();
  if (!actor) return null;

  return {
    actor,
    ...(actor.buyerCompanyId ? { buyerCompanyId: actor.buyerCompanyId } : {}),
  };
}

/**
 * The seat, or a redirect to sign-in that comes back here.
 *
 * `next` is the page's own path. A server component cannot ask the router what
 * it is and this project has no middleware header carrying it, so the caller
 * passes it — but it passes a path, not a URL, and the encoding is not its
 * problem. That split is the point: the two spellings that had drifted were
 * both in the encoding, not in the path.
 */
export async function requireBuyerSeat(next: string): Promise<BuyerSeat> {
  const seat = await getBuyerSeat();
  if (!seat) redirect(signInHref(next));
  return seat;
}
