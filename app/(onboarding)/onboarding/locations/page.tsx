import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { formatDate, formatRelative } from "@/lib/format";
import { t } from "@/lib/i18n";
import { locationsStateFor } from "@/lib/onboarding/locations";
import { nextRamadan } from "@/lib/trade/hours";
import { readRamadanCalendar } from "@/lib/trade/ramadan-calendar";
import { OnboardingHeader } from "../_chrome";
import { SavedIndicator, SavedProvider } from "../_saved";
import { requireClaimant } from "../_shell";
import {
  continueToPlan,
  countBranchesWithHours,
  createBranch,
  deleteBranch,
  saveBranchField,
  saveHours,
  savePin,
  saveRadius,
} from "./actions";
import { LocationsWorkspace } from "./LocationsWorkspace";

/**
 * Board 2d — locations and hours.
 *
 * `2c` decided what the seller sounds like. This decides where they are, and it
 * is the only onboarding step whose output a buyer filters on directly: area is
 * the second-most-used facet after category, and a branch with no coordinates is
 * excluded from the results map by a `where` clause rather than ranked below a
 * pinned one. The sub-line states that consequence rather than encouraging.
 *
 * It is also where the listing goes live. The funnel's criterion 3 puts the
 * publish at the end of this step and not at the end of the funnel, so a
 * supplier who closes the tab at the pricing table is listed, findable and
 * receiving enquiries up to the Free cap.
 */
export const metadata: Metadata = {
  title: "Where buyers find you",
  robots: { index: false, follow: true },
};

export const dynamic = "force-dynamic";

export default async function LocationsStepPage() {
  const actor = await requireClaimant("locations");
  if (!actor.businessId) redirect("/onboarding/claim");

  const state = await locationsStateFor(actor.businessId);
  if (!state) redirect("/onboarding/claim");

  /*
     Criterion 15: the Ramadan dates come from the platform setting, never from
     seller input. Resolved here and passed down as formatted strings — the
     window is a fact about the platform's calendar, so it is read once for the
     page rather than by each branch card, and the dates a supplier reads are the
     same dates the storefront switches their hours on.
  */
  const window = nextRamadan(new Date(), await readRamadanCalendar());

  const savedAt = t("onboarding.saved_at", { when: formatRelative(state.savedAt) });

  return (
    <SavedProvider initial={savedAt}>
      <OnboardingHeader step="locations" signedIn trailing={<SavedIndicator />} />

      {/*
        No `OnboardingColumn`. The map is the argument on this step and takes
        the whole right-hand side, so the workspace renders the split itself —
        the heading and the sub-line live inside the left column with the form
        rather than above both.
      */}
      <LocationsWorkspace
        state={state}
        ramadanWindow={
          window
            ? { from: formatDate(window.from), to: formatDate(window.to), active: window.active }
            : null
        }
        actions={{
          saveField: saveBranchField,
          savePin,
          saveRadius,
          saveHours,
          countHours: countBranchesWithHours,
          addBranch: createBranch,
          removeBranch: deleteBranch,
          continueToPlan,
        }}
      />
    </SavedProvider>
  );
}
