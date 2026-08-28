import Link from "next/link";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db/client";
import { CompletenessMeter } from "@/components/domain";
import { STRONG_ENOUGH } from "@/lib/metrics/profile-strength";
import { t } from "@/lib/i18n";
import { OnboardingPage, requireClaimant } from "../_shell";
import { saveListingProfile } from "../../../(dashboard)/dashboard/listing/actions";
import { ListingForm } from "../../../(dashboard)/dashboard/listing/ListingForm";
import { submitModeratedChange, withdrawModeratedChange } from "../../../(dashboard)/dashboard/listing/actions";

/**
 * Board 2c — the profile.
 *
 * The same form as `/dashboard/listing`, deliberately. A supplier who fills
 * this in during onboarding and comes back a month later should find the same
 * screen, and a second implementation is a second place for the moderated /
 * instant split to drift.
 *
 * The live preview the board draws is the strength meter plus the 80% marker:
 * a supplier filling in a description wants to know whether it was worth doing,
 * and a card mock-up that cannot show their own photographs — they have none
 * yet — would answer that less honestly than a number.
 */
export const metadata = { title: "Your profile" };
export const dynamic = "force-dynamic";

export default async function ProfileStepPage() {
  const actor = await requireClaimant("profile");
  if (!actor.businessId) redirect("/onboarding/claim");

  const [business, categories] = await Promise.all([
    prisma.business.findUniqueOrThrow({
      where: { id: actor.businessId },
      select: {
        displayName: true,
        description: true,
        establishedYear: true,
        teamSize: true,
        languages: true,
        tradeName: true,
        licenceNumber: true,
        primaryCategoryId: true,
        profileStrength: true,
        primaryCategory: { select: { name: true } },
      },
    }),
    prisma.category.findMany({
      where: { children: { none: {} } },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
  ]);

  return (
    <OnboardingPage step="profile" title={t("profile_step.title")} intro={t("profile_step.intro")}>
      <div className="rounded-card border border-line bg-paper-sunk p-3">
        <CompletenessMeter
          filled={business.profileStrength ?? 0}
          total={100}
          valueLabel={`${business.profileStrength ?? 0}%`}
          label={t("profile_step.strength")}
        />
        <p className="mt-1.5 text-caption text-muted">{t("profile_step.threshold")}</p>
      </div>

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
        pending={[]}
        saveAction={saveListingProfile}
        submitAction={submitModeratedChange}
        withdrawAction={withdrawModeratedChange}
      />

      <div className="flex justify-end border-t border-line pt-4">
        <Link
          href="/onboarding/locations"
          className="inline-flex items-center rounded-ctl border border-moss bg-moss px-3.5 py-1.5 text-body-sm font-medium text-on-ink hover:bg-moss-hover focus-visible:shadow-focus focus-visible:outline-none"
        >
          {t("onboarding.next")}
        </Link>
      </div>
    </OnboardingPage>
  );
}

export { STRONG_ENOUGH };
