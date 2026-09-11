import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db/client";
import { formatRelative } from "@/lib/format";
import { t } from "@/lib/i18n";
import { EMIRATES } from "@/lib/uae";
import { allowanceFor } from "@/lib/onboarding/categories";
import { profileStateFor } from "@/lib/onboarding/profile";
import { TEAM_SIZES } from "@/lib/onboarding/profile-fields";
import { getEnquiryLift } from "@/lib/metrics/enquiry-lift";
import { STRONG_ENOUGH } from "@/lib/metrics/profile-strength";
import { publicUrl, MEDIA_BUCKET } from "@/lib/storage";
import { OnboardingHeader, OnboardingColumn } from "../_chrome";
import { requireClaimant } from "../_shell";
import { addCategory, continueToLocations, removeCategory, saveProfileField } from "./actions";
import { ProfileWorkspace } from "./ProfileWorkspace";
import { SavedIndicator, SavedProvider } from "../_saved";

/**
 * Board 2c — profile basics, with a live preview.
 *
 * The first screen in onboarding where the seller **writes** rather than proves.
 * `2a` and `2b` established that they are entitled to speak for the licence;
 * this is where they decide what they sound like.
 *
 * Two things make it work and both are structural. The preview renders the card
 * `1c` will actually produce, so a seller can see the consequence of every
 * field. The strength meter turns "please fill this in" into a number with named
 * levers that sum to exactly a hundred — the same figure the dashboard shows
 * afterwards, from the same config.
 */
export const metadata: Metadata = {
  title: t("profile_step.meta_title"),
  robots: { index: false, follow: true },
};

export const dynamic = "force-dynamic";

export default async function ProfileStepPage() {
  const actor = await requireClaimant("profile");

  /*
     Board 2b-s AC1: "No seller reaches Profile with `sellsKind = unset`."

     Enforced on the way in rather than trusted to the link that got them here.
     A seller who bookmarked this URL, or was sent one, would otherwise fill in a
     profile shaped for the wrong kind of business and find out at the setup hub.

     **Unpublished only, and the condition is load-bearing.** AC1 is about the
     funnel, and a published business is not in it. Every business that existed
     before this column shipped is published with `sellsKind = unset` — the
     migration adds no backfill, because inferring a kind onto a live listing is
     the `offering_type` mistake board 2b-s was written to avoid. Bouncing on
     `unset` alone therefore sent every existing seller profile → kind →
     settings, because `/onboarding/kind` sends a published seller to Settings,
     and the profile step became unreachable for the whole directory.

     An e2e run found it. The unit of the rule is the funnel, so the condition is
     the same one `afterVerify` uses.
  */
  if (actor.businessId) {
    const answered = await prisma.business.findUnique({
      where: { id: actor.businessId },
      select: { sellsKind: true, publishedAt: true },
    });
    if (answered?.sellsKind === "unset" && answered.publishedAt === null) {
      redirect("/onboarding/kind");
    }
  }
  if (!actor.businessId) redirect("/onboarding/claim");

  const state = await profileStateFor(actor.businessId);
  if (!state) redirect("/onboarding/claim");

  const [addable, plans, lift] = await Promise.all([
    /*
       Leaves only. A parent category is a heading on the taxonomy rather than a
       thing a supplier trades in, and letting one be chosen would put a listing
       in the fan-out for every trade beneath it.
    */
    prisma.category.findMany({
      where: {
        children: { none: {} },
        id: { notIn: [state.primaryCategoryId, ...state.extras.map((extra) => extra.id)] },
      },
      orderBy: { name: "asc" },
      select: { id: true, name: true },
    }),
    prisma.plan.findMany({ orderBy: { sortOrder: "asc" }, select: { id: true, name: true, categoryLimit: true, sortOrder: true } }),
    getEnquiryLift(),
  ]);

  const allowance = allowanceFor(state.categoryLimit, state.planName, state.extras.length);

  /*
     The next plan up that actually adds categories.
     Read from the plans table rather than named in copy: "Growth adds unlimited"
     hardcoded is a sentence that survives the plan being renamed or repriced.
  */
  const current = plans.find((plan) => plan.id === state.planId);
  const upgrade =
    plans.find(
      (plan) =>
        plan.sortOrder > (current?.sortOrder ?? -1) &&
        (plan.categoryLimit === null || plan.categoryLimit > (state.categoryLimit ?? 0)),
    ) ?? null;

  const savedAt = t("onboarding.saved_at", { when: formatRelative(state.savedAt) });

  return (
    <SavedProvider initial={savedAt}>
      <OnboardingHeader step="profile" signedIn trailing={<SavedIndicator />} />

      <OnboardingColumn wide>
        <h1 className="font-serif text-h1-serif text-ink sm:text-[2rem]">
          {t("profile_step.title")}
        </h1>
        <p className="mt-3 max-w-prose text-body-sm text-body">{t("profile_step.intro")}</p>

        <div className="mt-7">
          <ProfileWorkspace
            record={{
              slug: state.businessId,
              displayName: state.displayName,
              categoryName: state.primaryCategoryName,
              categoryCode: state.categoryCode,
              areaName: state.areaName ?? "",
              emirateName: emirateLabel(state.emirateName),
              verificationTier: state.verificationTier,
              description: state.description,
              logoUrl: state.logoUrl ? publicUrl(MEDIA_BUCKET, state.logoUrl) : null,
              coverUrl: state.coverUrl ? publicUrl(MEDIA_BUCKET, state.coverUrl) : null,
              establishedYear: state.establishedYear,
              tradeLine: [state.primaryCategoryName, ...state.extras.map((e) => e.name)].join(" · "),
              verified: state.isVerified,
            }}
            strength={state.strength}
            items={state.items}
            threshold={STRONG_ENOUGH}
            lift={lift ? { multiple: lift.multiple, threshold: lift.threshold } : null}
            form={{
              /*
                 Board 2c is where the split between the two names is created,
                 and this is the field that shows a seller why it exists: the
                 legal name sits locked and grey beside the one they choose,
                 and the preview to the right carries only the chosen one. It
                 reaches the form to be *rendered read-only*, and there is no
                 code path that makes it editable.
              */
              tradeName: state.tradeName, // licence-locked

              displayName: state.displayName,
              description: state.description,
              establishedYear: state.establishedYear,
              teamSize: state.teamSize,
              primaryCategoryLabel: state.primaryParentName
                ? `${state.primaryParentName} → ${state.primaryCategoryName}`
                : state.primaryCategoryName,
              extras: state.extras,
              allowance,
              upgrade: upgrade
                ? {
                    planName: upgrade.name,
                    more:
                      upgrade.categoryLimit === null
                        ? null
                        : Math.max(0, upgrade.categoryLimit - (state.categoryLimit ?? 1)),
                  }
                : null,
              addable: addable.map((category) => ({ value: category.id, label: category.name })),
              teamSizes: TEAM_SIZES.map((band) => ({ value: band, label: bandLabel(band) })),
              saveAction: saveProfileField,
              addAction: addCategory,
              removeAction: removeCategory,
              continueAction: continueToLocations,
            }}
          />
        </div>
      </OnboardingColumn>
    </SavedProvider>
  );
}

function emirateLabel(value: string | null): string {
  return EMIRATES.find((emirate) => emirate.value === value)?.label ?? "";
}

/**
 * `11 – 50`, from the enum the schema already holds.
 *
 * The board draws four bands and the schema carries five. The schema's are the
 * ones already rendered on every storefront, and re-cutting an enum that public
 * surfaces read — to change where a boundary sits, not what the field means —
 * would be a migration and a rewrite of every seller's answer for no gain the
 * buyer can see. Both are bands, which is the property that mattered.
 */
function bandLabel(band: string): string {
  const digits = band.replace(/^b/, "").split("_");
  if (band === "b500_plus") return "500+";
  return `${digits[0]} – ${digits[1]}`;
}

