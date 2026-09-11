import { redirect } from "next/navigation";
import type { Metadata } from "next";
import { prisma } from "@/lib/db/client";
import { formatDate, formatRelative } from "@/lib/format";
import { t } from "@/lib/i18n";
import { coverageStateFor } from "@/lib/onboarding/coverage";
import { locationsStateFor } from "@/lib/onboarding/locations";
import { nextRamadan } from "@/lib/trade/hours";
import { readRamadanCalendar } from "@/lib/trade/ramadan-calendar";
import { OnboardingHeader, OnboardingSplit } from "../_chrome";
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
import {
  saveAllCoverageAreas,
  saveCoverageArea,
  saveDeliveryModes,
  saveFreeZone,
} from "./coverage-actions";
import { CoverageAside } from "./CoverageAside";
import { CoverageSection } from "./CoverageSection";
import { CoverageWorkspace } from "./CoverageWorkspace";
import { LocationsWorkspace } from "./LocationsWorkspace";

/**
 * Step 4 of the funnel — and the one step whose *model* changes with what the
 * seller sells.
 *
 * Board 2d is locations and hours: a branch list, each row an address with a
 * dropped pin, a type, opening hours, a Ramadan band and a service radius. It is
 * the only onboarding step whose output a buyer filters on directly, and it is
 * where the listing goes live.
 *
 * Board `2d-s` is the same route, the same step number and the same save
 * contract with a different model underneath. A tax practice has one office and
 * it is on the licence we already hold; what a buyer wants to know is which
 * emirates the practice will work in, and whether the work happens remotely at
 * all. So the map, the pin, the radius, the hours, the Ramadan band, the branch
 * type and the plan-metered counter are all gone, and what is collected instead
 * is a delivery mode and a set of areas.
 *
 * **One route, not two** — board `2d-s` B1. The field set is chosen by
 * `Business.sellsKind`, the same way `2c-s` chooses the profile's. A second
 * route would be a second URL to keep in step with the funnel, a second place
 * for `goLive` to be called from, and a bookmark that sends a seller to the
 * wrong one after they change their mind.
 */
export const metadata: Metadata = {
  title: t("onboarding.locations_meta_title"),
  robots: { index: false, follow: true },
};

export const dynamic = "force-dynamic";

export default async function LocationsStepPage() {
  const actor = await requireClaimant("locations");
  if (!actor.businessId) redirect("/onboarding/claim");

  /*
     Board 2b-s AC1: no seller reaches a kind-shaped step with `sellsKind`
     unanswered, and this is one — the whole screen is chosen by it.

     Unpublished only, and the condition is load-bearing for the same reason it
     is on the profile step: every business that existed before the column
     shipped is published with `sellsKind = unset`, and bouncing on `unset`
     alone makes this step unreachable for the whole directory.
  */
  const kindRow = await prisma.business.findUnique({
    where: { id: actor.businessId },
    select: { sellsKind: true, publishedAt: true },
  });
  if (kindRow?.sellsKind === "unset" && kindRow.publishedAt === null) {
    redirect("/onboarding/kind");
  }

  const kind = kindRow?.sellsKind ?? "unset";
  const showsBranches = kind !== "services";
  const showsCoverage = kind === "services" || kind === "both";

  const [locations, coverage] = await Promise.all([
    showsBranches ? locationsStateFor(actor.businessId) : null,
    showsCoverage ? coverageStateFor(actor.businessId) : null,
  ]);

  if (showsBranches && !locations) redirect("/onboarding/claim");
  if (showsCoverage && !coverage) redirect("/onboarding/claim");

  const coverageActions = {
    saveModes: saveDeliveryModes,
    saveArea: saveCoverageArea,
    saveAll: saveAllCoverageAreas,
    saveZone: saveFreeZone,
  };

  /* ── A firm that sells work: coverage, and no branch list at all ───────── */

  if (coverage && !showsBranches) {
    const savedAt = t("onboarding.saved_at", { when: formatRelative(coverage.savedAt) });

    return (
      <SavedProvider initial={savedAt}>
        <OnboardingHeader step="locations" sellsKind={kind} signedIn trailing={<SavedIndicator />} />

        {/*
          `2d`'s map split does not apply: there is no pin, so there is nothing
          for the right-hand half to hold. `OnboardingSplit` — a column of work
          and a column of reassurance — is the shape this screen actually is.
        */}
        <OnboardingSplit aside={<CoverageAside office={coverage.registeredOffice} />}>
          <CoverageWorkspace
            state={coverage}
            actions={{ ...coverageActions, continueToPlan }}
          />
        </OnboardingSplit>
      </SavedProvider>
    );
  }

  if (!locations) redirect("/onboarding/claim");

  /*
     Criterion 15: the Ramadan dates come from the platform setting, never from
     seller input. Resolved here and passed down as formatted strings — the
     window is a fact about the platform's calendar, so it is read once for the
     page rather than by each branch card, and the dates a supplier reads are the
     same dates the storefront switches their hours on.
  */
  const window = nextRamadan(new Date(), await readRamadanCalendar());

  const savedAt = t("onboarding.saved_at", {
    when: formatRelative(
      coverage && coverage.savedAt > locations.savedAt ? coverage.savedAt : locations.savedAt,
    ),
  });

  return (
    <SavedProvider initial={savedAt}>
      <OnboardingHeader step="locations" sellsKind={kind} signedIn trailing={<SavedIndicator />} />

      {/*
        No `OnboardingColumn`. The map is the argument on this step and takes
        the whole right-hand side, so the workspace renders the split itself —
        the heading and the sub-line live inside the left column with the form
        rather than above both.
      */}
      <LocationsWorkspace
        state={locations}
        ramadanWindow={
          window
            ? { from: formatDate(window.from), to: formatDate(window.to), active: window.active }
            : null
        }
        /* B7. A seller who sells both gets both sets on one step, grouped and
           labelled, and neither is behind a toggle — AC8. */
        coverage={
          coverage ? (
            <CoverageSection
              modes={coverage.deliveryModes}
              chips={coverage.chips}
              otherScopes={coverage.otherScopes}
              freeZones={coverage.freeZones}
              registrations={coverage.registrations}
              actions={coverageActions}
              grouped
            />
          ) : undefined
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
