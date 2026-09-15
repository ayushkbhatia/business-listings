import { notFound } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { fieldSetFor } from "@/lib/onboarding/service-profile";
import { pairedCopyFor } from "@/lib/strings/store";
import { sectorChipsFor } from "@/lib/onboarding/sector-index";
import { getTradeKinds } from "@/lib/taxonomy/service";
import { resolveTradeKind } from "@/lib/taxonomy/trade-kind";
import { getListing } from "@/lib/db/queries/listing";
import { unpickedPhotos } from "@/lib/listing/photos";
import { mayEditListing } from "@/lib/auth/guards";
import { t } from "@/lib/i18n";
import { documentRequestsFor } from "@/lib/moderation/seller";
import { DocumentRequests } from "../_moderation";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";
import {
  findListingSectors,
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

  const [view, badges, library, profile, kinds] = await Promise.all([
    getListing(seat.businessId),
    getNavBadges(seat.businessId),
    unpickedPhotos(seat.businessId),
    /*
       Board `3b-s` — the services field set, read here beside the goods view
       rather than folded into `getListing`, which every goods seller's page
       reads and none of whom needs these columns.
    */
    prisma.business.findUnique({
      where: { id: seat.businessId },
      select: {
        headline: true,
        sectorsServed: true,
        qualifiedCount: true,
        typicalClient: true,
        primaryCategoryId: true,
        categories: { select: { categoryId: true } },
        sectorEngagements: { select: { sectorSlug: true, engagements: true } },
      },
    }),
    getTradeKinds(),
  ]);
  if (!view || !profile) notFound();

  /*
     `3b-s` B1 — one screen, the field set chosen by what the seller sells.
     `fieldSetFor` is the function the onboarding step uses, so the two
     screens cannot disagree about which fields a seller is shown (B8).
  */
  const fieldSet = fieldSetFor(seat.sellsKind);
  const copy = await pairedCopyFor(seat.sellsKind);
  const categoryIds = [
    ...new Set([profile.primaryCategoryId, ...profile.categories.map((row) => row.categoryId)]),
  ];
  const chips = fieldSet.services ? await sectorChipsFor(categoryIds) : [];

  /*
     The mechanism, counted. `3b-s` asks the categories block to say *why* the
     dashboard looks the way it does; the honest way to say it is to resolve
     each category's trade kind the way every other reader does and count.
  */
  const resolved = categoryIds.map((id) => resolveTradeKind(kinds, id));
  const kindCounts = {
    services: resolved.filter((kind) => kind === "services").length,
    goods: resolved.filter((kind) => kind === "goods").length,
    total: resolved.length,
  };

  /*
     Criterion 11. A staff seat looking through board 12f's view-as holds no
     seller capability, so every action here would be refused at the service
     layer anyway — this renders the form disabled and says who can edit rather
     than letting somebody discover it by pressing Save.
  */
  const editable = mayEditListing(seat.actor);
  // Board 4b: a document our team asked for about a pending edit.
  const requests = await documentRequestsFor(seat.businessId);

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/listing"
      eyebrow={t("listing.eyebrow")}
      title={t("listing.title")}
    >
      {requests.length > 0 && (
        <div className="mb-[var(--gutter)]">
          <DocumentRequests requests={requests} uploadHref="/dashboard/verification" />
        </div>
      )}
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
        fieldSet={fieldSet}
        descriptionLabel={copy["listing.description"]}
        services={
          fieldSet.services
            ? {
                initial: {
                  headline: profile.headline ?? "",
                  servicesOffered: [],
                  sectorsServed: profile.sectorsServed,
                  sectorEngagements: Object.fromEntries(
                    profile.sectorEngagements.map((row) => [row.sectorSlug, row.engagements]),
                  ),
                  languages: view.languages,
                  qualifiedCount: profile.qualifiedCount?.toString() ?? "",
                  typicalClient: profile.typicalClient ?? "",
                },
                chips,
              }
            : null
        }
        kinds={kindCounts}
        searchSectors={findListingSectors}
      />
    </SellerPage>
  );
}
