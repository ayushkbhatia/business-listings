import { prisma } from "@/lib/db/client";
import { pendingChanges } from "@/lib/listing/service";
import { t } from "@/lib/i18n";
import { getNavBadges, requireSellerSeat, SellerPage } from "../_shell";
import { saveListingProfile, submitModeratedChange, withdrawModeratedChange } from "./actions";
import { ListingForm } from "./ListingForm";

/**
 * Board 3b — the listing profile, with both moderation states on one screen.
 *
 * Criterion 8 is what this page is for. A seller who has only ever seen the
 * moderated half assumes everything waits and stops editing, so the instant
 * half is above it and says so in a heading.
 */
export const metadata = { title: "Listing profile" };
export const dynamic = "force-dynamic";

export default async function ListingPage() {
  const seat = await requireSellerSeat();

  const [business, categories, badges, pending] = await Promise.all([
    prisma.business.findUniqueOrThrow({
      where: { id: seat.businessId },
      select: {
        displayName: true,
        description: true,
        establishedYear: true,
        teamSize: true,
        languages: true,
        tradeName: true,
        licenceNumber: true,
        primaryCategoryId: true,
        primaryCategory: { select: { name: true } },
      },
    }),
    // Leaf categories only. A supplier sells gate valves, not "valves and
    // fittings", and offering the parent as a choice is how a listing ends up
    // filed one level too shallow to be found on a filter.
    prisma.category.findMany({
      where: { children: { none: {} } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    getNavBadges(seat.businessId),
    pendingChanges(seat.businessId),
  ]);

  return (
    <SellerPage
      seat={seat}
      badges={badges}
      activeHref="/dashboard/listing"
      eyebrow={t("listing.eyebrow")}
      title={t("listing.title")}
    >
      <ListingForm
        displayName={business.displayName}
        description={business.description ?? ""}
        establishedYear={business.establishedYear}
        teamSize={business.teamSize}
        languages={business.languages}
        tradeName={business.tradeName}
        licenceNumber={business.licenceNumber}
        categoryName={business.primaryCategory.name}
        primaryCategoryId={business.primaryCategoryId}
        categories={categories.map((c) => ({ value: c.id, label: c.name }))}
        pending={pending.map((p) => ({
          id: p.id,
          field: p.field,
          afterValue: p.afterValue,
          createdAt: p.createdAt.toISOString(),
        }))}
        saveAction={saveListingProfile}
        submitAction={submitModeratedChange}
        withdrawAction={withdrawModeratedChange}
      />
    </SellerPage>
  );
}
