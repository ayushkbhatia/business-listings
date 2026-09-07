import { notFound } from "next/navigation";
import { getListing } from "@/lib/db/queries/listing";
import { unpickedPhotos } from "@/lib/listing/photos";
import { mayEditListing } from "@/lib/auth/guards";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";
import {
  makeCover,
  pickPhoto,
  saveListingProfile,
  unpickPhoto,
  withdrawModeratedChange,
} from "./actions";
import { ListingWorkspace } from "./ListingWorkspace";

/**
 * Board 3b — the listing profile.
 *
 * The steady state of `2a`–`2c`. Onboarding asked for these fields once; this
 * is where a seller changes them for the next several years, and that makes it
 * a different problem. The question it answers on every edit is **did that go
 * live, or is someone looking at it** — and the screen it replaces answered
 * with one button and one header count for two different behaviours.
 *
 * Three things the seller controls: the prose and facts buyers read, which
 * categories the listing appears under, and which photographs the storefront
 * leads with. Two they do not: the trade name, which is licence-locked, and the
 * badge, which is `3e`'s.
 *
 * There is no certificate upload here. `3e` owns documents, with the visibility
 * and expiry state that deliberately does not claim we checked them; two upload
 * points on one collection is how the same ISO 9001 PDF ends up on file twice
 * with two expiry dates. The rail links there instead — criterion 6.
 */
export const metadata = { title: t("listing.title") };
export const dynamic = "force-dynamic";

export default async function ListingPage() {
  const seat = await requireSellerSeat();

  const [view, badges, library] = await Promise.all([
    getListing(seat.businessId),
    getNavBadges(seat.businessId),
    unpickedPhotos(seat.businessId),
  ]);
  if (!view) notFound();

  /*
     Criterion 11. A staff seat looking through board 12f's view-as holds no
     seller capability, so every action here would be refused at the service
     layer anyway — this renders the form disabled and says who can edit rather
     than letting somebody discover it by pressing Save.
  */
  const editable = mayEditListing(seat.actor);

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/listing"
      eyebrow={t("listing.eyebrow")}
      title={t("listing.title")}
    >
      <ListingWorkspace
        view={{
          ...view,
          held: view.held.map((row) => ({ ...row, submittedAt: row.submittedAt.toISOString() })),
          rejected: view.rejected.map((row) => ({
            ...row,
            decidedAt: row.decidedAt?.toISOString() ?? null,
          })),
          revisions: view.revisions.map((row) => ({ ...row, at: row.at.toISOString() })),
          lastSavedAt: view.lastSavedAt?.toISOString() ?? null,
        }}
        library={library}
        editable={editable}
        saveAction={saveListingProfile}
        withdrawAction={withdrawModeratedChange}
        unpickAction={unpickPhoto}
        pickAction={pickPhoto}
        coverAction={makeCover}
      />
    </SellerPage>
  );
}
