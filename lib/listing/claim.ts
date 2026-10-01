import { publiclyClaimed } from "@/lib/claims/status";
import { licenceExpired } from "@/lib/verification";

/*
   The claim controls on an unclaimed listing — board 10g.

   Whether a listing reads as claimed at all is `publiclyClaimed`, board 4c's
   one test (`lib/claims/status.ts`): `disputed` reads as unclaimed on every
   public surface. What follows is what a surface does about it.

   Pure and client-safe: `ListingCard` renders inside board 2c's client preview.
*/

/**
 * Where every claim control on an unclaimed listing goes.
 *
 * Board 10g `B10`: both controls on the page, and the card's, land on `2a` with
 * the licence prefilled, which `2a` answers with the single `EXACT LICENCE
 * MATCH` row. It used to prefill the display name, which put the claimant in a
 * list of lookalikes — the one screen whose whole job is telling three similar
 * trade names apart, entered by the field that cannot.
 *
 * `rel` is the caller's, through `crawlRel`: this is one distinct URL per
 * listing into a `noindex` funnel step, roughly 30,000 of them.
 */
export function claimHref(licenceNumber: string): string {
  return `/onboarding/claim?licence=${encodeURIComponent(licenceNumber)}`;
}

/**
 * Whether a listing offers a claim control at all.
 *
 * Not once it is claimed, and not on a licence the register says has lapsed:
 * board 10g `B4`, which takes 13d's rule — a lapsed or cancelled licence is not
 * one we invite a claim on, because the listing may be gone for the reason the
 * register gives. The page and the card both ask here, so a card in search
 * results cannot offer the claim its own listing page withholds.
 *
 * `now` is a parameter for the reason `licenceExpired` gives: a render that
 * reads the clock renders two different pages.
 */
export function invitesClaim(
  listing: { claimStatus: string; licenceExpiry?: Date | string },
  now: Date,
): boolean {
  if (publiclyClaimed(listing.claimStatus) || listing.licenceExpiry === undefined) return false;
  return !licenceExpired(new Date(listing.licenceExpiry), now);
}
